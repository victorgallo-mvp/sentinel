/**
 * Processa um job da fila `notificar`: carrega a investigação concluída,
 * verifica throttling, monta a mensagem e envia via WhatsApp, registrando
 * o resultado em `Notificacao`.
 */
import { Investigacao } from '../../dominio/investigacao.modelo.js';
import { Anomalia } from '../../dominio/anomalia.modelo.js';
import { Entidade } from '../../dominio/entidade.modelo.js';
import { Conta } from '../../dominio/conta.modelo.js';
import { Notificacao } from '../../dominio/notificacao.modelo.js';
import { podeNotificar, msAteProximaAberturaJanela } from './throttling.js';
import { construirMensagem, construirMensagemConsolidada } from './construtor-mensagem.js';
import { enviarMensagemWhatsapp, resolverDestinatarios } from './enviador-whatsapp.servico.js';
import { adicionarJob, FILAS } from '../../infra/fila.js';
import { config } from '../../config/index.js';
import { logger } from '../../infra/logger.js';
import { ErroAplicacao, ErroNaoEncontrado } from '../../shared/erros.js';

// Janela de agrupamento: anomalias da mesma conta que chegam dentro deste
// intervalo entram numa única mensagem consolidada por BM.
const JANELA_AGRUPAMENTO_MS = 3 * 60 * 1000; // 3 min
// Só considera investigações recentes ao varrer pendências — evita reenviar
// investigações antigas (anteriores à introdução do digest) que não têm
// `notificadoEm` preenchido.
const JANELA_VARREDURA_MS = 6 * 60 * 60 * 1000; // 6h

/**
 * Agenda (ou reforça) o digest da conta. Usa jobId fixo por conta para
 * deduplicar: enquanto o job está pendente na janela, novas anomalias da mesma
 * conta não criam jobs extras — o digest, ao rodar, varre todas as pendentes.
 * @param {string|ObjectId} contaId
 * @param {number} [delay] - atraso em ms (default: janela de agrupamento)
 */
export async function agendarDigest(contaId, delay = JANELA_AGRUPAMENTO_MS) {
  await adicionarJob(
    FILAS.NOTIFICAR,
    'digest',
    { contaId: String(contaId) },
    { delay, jobId: `digest:${contaId}`, removeOnComplete: true, removeOnFail: true }
  );
}

/**
 * Processa o digest de uma conta: varre as investigações pendentes
 * (decidiram notificar e ainda não notificadas), aplica throttling/horário,
 * e envia UMA mensagem consolidada por BM.
 * @param {string} contaId
 */
export async function processarDigestConta(contaId) {
  const conta = await Conta.findById(contaId);
  if (!conta) throw new ErroNaoEncontrado(`Conta ${contaId} não encontrada`);

  const limiteRecente = new Date(Date.now() - JANELA_VARREDURA_MS);
  const investigacoes = await Investigacao.find({
    contaId,
    decidiuNotificar: true,
    notificadoEm: null,
    fimEm: { $gte: limiteRecente },
  }).sort({ fimEm: 1 });

  if (investigacoes.length === 0) return { enviada: false, motivo: 'Nenhuma investigação pendente.' };

  const itens = [];
  const idsSuprimidos = [];
  const vistos = new Set(); // dedupe entidade+métrica dentro do mesmo digest

  for (const inv of investigacoes) {
    const anomalia = await Anomalia.findById(inv.anomaliaId);
    if (!anomalia) { idsSuprimidos.push(inv._id); continue; }
    const entidade = await Entidade.findById(anomalia.entidadeId);
    if (!entidade) { idsSuprimidos.push(inv._id); continue; }

    const { podeEnviar, codigo, motivo } = await podeNotificar(conta, entidade, anomalia);
    if (!podeEnviar) {
      // Horário é nível-conta: se a primeira já está fora, todas estão →
      // adia o digest inteiro para a próxima abertura da janela.
      if (codigo === 'fora_horario') {
        const delay = msAteProximaAberturaJanela(conta);
        await agendarDigest(contaId, delay);
        logger.info({ msg: 'Digest adiado para a próxima janela permitida', contaId: String(contaId), delayMs: delay, motivo });
        return { enviada: false, adiada: true, motivo };
      }
      // silenciada/repetição → descarta esta do digest e marca como tratada
      idsSuprimidos.push(inv._id);
      continue;
    }

    const chave = `${entidade._id}:${anomalia.metrica}`;
    if (vistos.has(chave)) { idsSuprimidos.push(inv._id); continue; }
    vistos.add(chave);

    let campanha = null;
    if (entidade.tipo !== 'campaign' && entidade.hierarquia?.campanhaId) {
      campanha = await Entidade.findOne({
        contaId: conta._id,
        metaId: entidade.hierarquia.campanhaId,
        tipo: 'campaign',
      }).lean();
    }

    itens.push({ investigacao: inv, anomalia, entidade, campanha });
  }

  if (idsSuprimidos.length > 0) {
    await Investigacao.updateMany({ _id: { $in: idsSuprimidos } }, { notificadoEm: new Date() });
  }

  if (itens.length === 0) return { enviada: false, motivo: 'Todas as pendências foram suprimidas (throttling).' };

  const destinatarios = resolverDestinatarios(conta);
  if (!destinatarios.length) {
    logger.warn({ msg: 'Digest não enviado — destinatário não configurado', contaId: String(conta._id) });
    await Investigacao.updateMany({ _id: { $in: itens.map((i) => i.investigacao._id) } }, { notificadoEm: new Date() });
    return { enviada: false, motivo: 'Destinatário WhatsApp não configurado para a conta.' };
  }

  const mensagem = construirMensagemConsolidada(conta, itens);
  const investigacaoIds = itens.map((i) => i.investigacao._id);

  let idMensagemEnviada = null;
  try {
    const resultado = await enviarMensagemWhatsapp(destinatarios, mensagem);
    idMensagemEnviada = resultado.idMensagemEnviada;
  } catch (erro) {
    // Não marca como notificada → o digest é reprocessado (BullMQ retry / próxima anomalia)
    logger.error({ msg: 'Falha ao enviar digest WhatsApp', contaId: String(conta._id), erro: erro.message });
    throw new ErroAplicacao(`Falha ao enviar digest da conta ${conta.nome}: ${erro.message}`, 'ERRO_DIGEST_ENVIO');
  }

  const notificacao = await Notificacao.create({
    contaId: conta._id,
    tipo: 'investigacao',
    investigacaoId: investigacaoIds[0],
    investigacaoIds,
    canal: 'whatsapp',
    destinatario: destinatarios.join(','),
    conteudo: mensagem,
    idMensagemEnviada,
    enviadaEm: new Date(),
    status: 'enviada',
  });

  await Investigacao.updateMany({ _id: { $in: investigacaoIds } }, { notificadoEm: new Date() });

  // Cobre a corrida em que novas anomalias chegaram enquanto este digest rodava
  // (o add foi ignorado pelo jobId): se sobrou pendência, reagenda.
  const restantes = await Investigacao.countDocuments({
    contaId,
    decidiuNotificar: true,
    notificadoEm: null,
    fimEm: { $gte: limiteRecente },
  });
  if (restantes > 0) await agendarDigest(contaId);

  logger.info({ msg: 'Digest enviado', conta: conta.nome, anomalias: itens.length, notificacaoId: String(notificacao._id) });
  return { enviada: true, notificacaoId: String(notificacao._id), anomalias: itens.length };
}

/**
 * @param {string} investigacaoId - ObjectId da Investigacao
 * @returns {Promise<{enviada: boolean, motivo?: string, notificacaoId?: string}>}
 */
export async function processarNotificacao(investigacaoId) {
  const investigacao = await Investigacao.findById(investigacaoId);
  if (!investigacao) throw new ErroNaoEncontrado(`Investigação ${investigacaoId} não encontrada`);

  const anomalia = await Anomalia.findById(investigacao.anomaliaId);
  if (!anomalia) throw new ErroNaoEncontrado(`Anomalia ${investigacao.anomaliaId} não encontrada`);
  const entidade = await Entidade.findById(anomalia.entidadeId);
  if (!entidade) throw new ErroNaoEncontrado(`Entidade ${anomalia.entidadeId} não encontrada`);
  const conta = await Conta.findById(investigacao.contaId);
  if (!conta) throw new ErroNaoEncontrado(`Conta ${investigacao.contaId} não encontrada`);

  const { podeEnviar, motivo, codigo } = await podeNotificar(conta, entidade, anomalia);
  if (!podeEnviar) {
    // Fora do horário permitido: não descarta — reenfileira para a próxima
    // abertura da janela. O job roda uma vez no delay e aí passa no horário.
    if (codigo === 'fora_horario') {
      const delay = msAteProximaAberturaJanela(conta);
      await adicionarJob(FILAS.NOTIFICAR, 'notificar', { investigacaoId: String(investigacao._id) }, { delay });
      logger.info({ msg: 'Notificação adiada para a próxima janela permitida', investigacaoId, delayMs: delay, motivo });
      return { enviada: false, adiada: true, motivo };
    }
    logger.info({ msg: 'Notificação suprimida por throttling', investigacaoId, motivo });
    return { enviada: false, motivo };
  }

  const destinatarios = resolverDestinatarios(conta);
  if (!destinatarios.length) {
    logger.warn({ msg: 'Notificação não enviada — destinatário não configurado', investigacaoId, contaId: String(conta._id) });
    return { enviada: false, motivo: 'Destinatário WhatsApp não configurado para a conta.' };
  }

  // Resolve a campanha pai para ancorar a mensagem na campanha (não no adset/ad)
  let campanha = null;
  if (entidade.tipo !== 'campaign' && entidade.hierarquia?.campanhaId) {
    campanha = await Entidade.findOne({
      contaId: conta._id,
      metaId: entidade.hierarquia.campanhaId,
      tipo: 'campaign',
    }).lean();
  }

  const mensagem = construirMensagem(investigacao, anomalia, entidade, campanha);

  let idMensagemEnviada = null;
  let status = 'enviada';
  try {
    const resultado = await enviarMensagemWhatsapp(destinatarios, mensagem);
    idMensagemEnviada = resultado.idMensagemEnviada;
  } catch (erro) {
    status = 'erro';
    logger.error({ msg: 'Falha ao enviar notificação WhatsApp', investigacaoId, erro: erro.message });
  }

  const notificacao = await Notificacao.create({
    contaId: conta._id,
    investigacaoId: investigacao._id,
    canal: 'whatsapp',
    destinatario: destinatarios.join(','),
    conteudo: mensagem,
    idMensagemEnviada,
    enviadaEm: new Date(),
    status,
  });

  return { enviada: status === 'enviada', notificacaoId: String(notificacao._id) };
}
