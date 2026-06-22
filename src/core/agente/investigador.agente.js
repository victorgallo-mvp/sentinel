/**
 * Agente investigador — coração do sistema.
 *
 * Recebe uma anomalia já triada, e roda um loop de tool use real com
 * Claude Sonnet: o agente decide quais ferramentas chamar, em qual ordem,
 * até formar um diagnóstico (`registrar_diagnostico`) e decidir sobre
 * notificação (`decidir_notificar`).
 *
 * O agente NÃO tem acesso a tools que alteram campanhas no Meta —
 * apenas leitura + as duas tools finalizadoras que gravam na própria
 * Investigacao.
 */
import { anthropic, calcularCusto, verificarLimiteCusto } from '../ia/cliente.claude.js';
import { TOOLS_REGISTRADAS, TOOLS_FINALIZADORAS } from '../tools/registro.tools.js';
import { construirPromptInicial, carregarPromptSystem } from './construtor-prompt.js';
import { executarToolComLog, resumirResultado } from './executor-tools.js';
import { limiteAtingido } from './limitador-iteracoes.js';
import { Anomalia } from '../../dominio/anomalia.modelo.js';
import { Entidade } from '../../dominio/entidade.modelo.js';
import { Conta } from '../../dominio/conta.modelo.js';
import { Investigacao } from '../../dominio/investigacao.modelo.js';
import { config } from '../../config/index.js';
import { adicionarJob, FILAS } from '../../infra/fila.js';
import { logger } from '../../infra/logger.js';
import { ErroNaoEncontrado, ErroLimiteCustoExcedido } from '../../shared/erros.js';

const MAX_TOKENS_RESPOSTA = 2048;

/**
 * Executa a investigação completa de uma anomalia.
 * @param {string} anomaliaId - ObjectId da Anomalia
 * @returns {Promise<string>} ObjectId da Investigacao criada
 */
export async function investigarAnomalia(anomaliaId) {
  const anomalia = await Anomalia.findById(anomaliaId);
  if (!anomalia) throw new ErroNaoEncontrado(`Anomalia ${anomaliaId} não encontrada`);

  const entidade = await Entidade.findById(anomalia.entidadeId);
  if (!entidade) throw new ErroNaoEncontrado(`Entidade ${anomalia.entidadeId} não encontrada`);

  const conta = await Conta.findById(anomalia.contaId);
  if (!conta) throw new ErroNaoEncontrado(`Conta ${anomalia.contaId} não encontrada`);

  const limiteCustoDiarioUsd = conta.configuracoes?.limiteCustoDiarioUsd ?? config.limites.custoDiarioUsd;

  // Verifica limite ANTES de criar o documento — evita poluir a lista de investigações
  // com entradas inúteis de "limite atingido" toda vez que uma anomalia chega à fila.
  try {
    await verificarLimiteCusto(anomalia.contaId, limiteCustoDiarioUsd);
  } catch (erro) {
    if (erro instanceof ErroLimiteCustoExcedido) {
      logger.warn({ msg: 'Investigação não iniciada — limite de custo diário atingido', anomaliaId, contaId: String(anomalia.contaId) });
      await Anomalia.findByIdAndUpdate(anomalia._id, { statusProcessamento: 'ignorada' });
      return null;
    }
    throw erro;
  }

  const investigacao = await Investigacao.create({
    contaId: anomalia.contaId,
    anomaliaId: anomalia._id,
    inicioEm: new Date(),
    iteracoes: 0,
    toolsChamadas: [],
    raciocinio: [],
  });

  const systemPrompt = await carregarPromptSystem();
  const promptInicial = construirPromptInicial(anomalia, entidade);

  const contexto = {
    contaId: String(anomalia.contaId),
    anomaliaId: String(anomalia._id),
    entidadeId: String(anomalia.entidadeId),
    investigacaoId: String(investigacao._id),
  };

  let mensagens = [{ role: 'user', content: promptInicial }];
  let iteracao = 0;
  let custoTotal = 0;
  let finalizadoPorFerramenta = false;

  while (iteracao < config.limites.maxIteracoesAgente) {
    iteracao++;
    logger.info({ msg: 'Agente iterando', investigacaoId: String(investigacao._id), iteracao });

    let resposta;
    try {
      resposta = await anthropic.messages.create({
        model: config.anthropic.modeloAgente,
        max_tokens: MAX_TOKENS_RESPOSTA,
        system: systemPrompt,
        tools: TOOLS_REGISTRADAS,
        messages: mensagens,
      });
    } catch (erro) {
      logger.error({ msg: 'Erro na chamada ao agente — interrompendo investigação', investigacaoId: String(investigacao._id), iteracao, erro: erro.message });
      investigacao.raciocinio.push(`[erro na iteração ${iteracao}]: ${erro.message}`);
      break;
    }

    custoTotal += calcularCusto(resposta.usage, config.anthropic.modeloAgente);

    mensagens.push({ role: 'assistant', content: resposta.content });

    const textoRaciocinio = resposta.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n')
      .trim();

    if (textoRaciocinio) {
      investigacao.raciocinio.push(textoRaciocinio);
    }

    const toolUses = resposta.content.filter((c) => c.type === 'tool_use');

    if (toolUses.length === 0) {
      logger.info({ msg: 'Agente concluiu sem chamar tools', investigacaoId: String(investigacao._id), iteracao, stopReason: resposta.stop_reason });
      break;
    }

    const toolResults = [];
    for (const toolUse of toolUses) {
      const { resultado, duracaoMs } = await executarToolComLog(toolUse.name, toolUse.input, contexto, iteracao);

      investigacao.toolsChamadas.push({
        nome: toolUse.name,
        parametros: toolUse.input,
        resultado: resumirResultado(resultado),
        duracaoMs,
        iteracao,
      });

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(resultado),
      });

      if (toolUse.name === 'decidir_notificar') {
        finalizadoPorFerramenta = true;
      }
    }

    mensagens.push({ role: 'user', content: toolResults });

    // Salva progresso incrementalmente — permite observar investigações em andamento
    investigacao.iteracoes = iteracao;
    await investigacao.save();

    if (finalizadoPorFerramenta) {
      logger.info({ msg: 'Agente finalizou via decidir_notificar', investigacaoId: String(investigacao._id), iteracao });
      break;
    }
  }

  if (limiteAtingido(iteracao) && !finalizadoPorFerramenta) {
    logger.warn({ msg: 'Agente atingiu limite de iterações sem finalizar via decidir_notificar', investigacaoId: String(investigacao._id), iteracao });
  }

  await finalizarInvestigacao(investigacao, iteracao, custoTotal);

  if (investigacao.decidiuNotificar) {
    await adicionarJob(FILAS.NOTIFICAR, 'notificar', { investigacaoId: String(investigacao._id) });
  }

  await Anomalia.findByIdAndUpdate(anomalia._id, {
    statusProcessamento: 'investigada',
    investigacaoId: investigacao._id,
  });

  logger.info({
    msg: 'Investigação concluída',
    investigacaoId: String(investigacao._id),
    iteracoes: iteracao,
    custoUsd: custoTotal.toFixed(4),
    notificou: investigacao.decidiuNotificar,
  });

  return String(investigacao._id);
}

/** Persiste duração, iterações e custo final da investigação. */
async function finalizarInvestigacao(investigacao, iteracoes, custoTotal) {
  investigacao.fimEm = new Date();
  investigacao.duracaoSegundos = (investigacao.fimEm - investigacao.inicioEm) / 1000;
  investigacao.iteracoes = iteracoes;
  investigacao.custoTokensUsd = custoTotal;
  investigacao.modeloUsado = config.anthropic.modeloAgente;
  await investigacao.save();
}

/** Caso o limite de custo diário já tenha sido atingido antes de começar. */
async function finalizarSemInvestigar(investigacao, anomalia, motivo) {
  investigacao.fimEm = new Date();
  investigacao.duracaoSegundos = 0;
  investigacao.iteracoes = 0;
  investigacao.custoTokensUsd = 0;
  investigacao.modeloUsado = config.anthropic.modeloAgente;
  investigacao.decidiuNotificar = false;
  investigacao.motivoNaoNotificar = motivo;
  investigacao.diagnostico = {
    causaProvavel: 'Investigação não executada — limite de custo diário atingido.',
    confianca: 0,
    severidade: 'info',
    contextoRelevante: [motivo],
  };
  await investigacao.save();

  await Anomalia.findByIdAndUpdate(anomalia._id, {
    statusProcessamento: 'investigada',
    investigacaoId: investigacao._id,
  });

  logger.warn({ msg: 'Investigação não executada — limite de custo diário', investigacaoId: String(investigacao._id), anomaliaId: String(anomalia._id) });
}
