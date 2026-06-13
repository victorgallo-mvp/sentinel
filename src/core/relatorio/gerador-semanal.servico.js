/**
 * Compila o relatório semanal de uma conta: agrega métricas da semana por
 * entidade, conta anomalias/investigações/notificações, chama o agente
 * analisador de portfólio e persiste o resultado (`Relatorio`).
 */
import { Conta } from '../../dominio/conta.modelo.js';
import { Entidade } from '../../dominio/entidade.modelo.js';
import { Anomalia } from '../../dominio/anomalia.modelo.js';
import { Investigacao } from '../../dominio/investigacao.modelo.js';
import { Notificacao } from '../../dominio/notificacao.modelo.js';
import { Relatorio } from '../../dominio/relatorio.modelo.js';
import { query } from '../../infra/postgres.js';
import { analisarPortfolio } from './analisador-portfolio.agente.js';
import { renderizarRelatorioHtml } from './templates/index.js';
import { atualizarPlanilhaSemanal } from './google-sheets.servico.js';
import { enviarMensagemWhatsapp } from '../notificacao/enviador-whatsapp.servico.js';
import { arredondar } from '../../shared/utils.js';
import { config } from '../../config/index.js';
import { logger } from '../../infra/logger.js';
import { ErroNaoEncontrado } from '../../shared/erros.js';

const METRICAS_RESUMO = ['spend', 'impressions', 'clicks', 'ctr', 'cpm', 'conversions', 'cost_per_conversion', 'purchase_roas'];

/**
 * Gera e persiste o relatório semanal de uma conta.
 * @param {string} contaId
 * @param {{inicio: Date, fim: Date}} [periodo] - default: últimos 7 dias
 */
export async function gerarRelatorioSemanal(contaId, periodo = null) {
  const conta = await Conta.findById(contaId);
  if (!conta) throw new ErroNaoEncontrado(`Conta ${contaId} não encontrada`);

  const periodoFim = periodo?.fim ?? new Date();
  const periodoInicio = periodo?.inicio ?? new Date(periodoFim.getTime() - 7 * 24 * 60 * 60 * 1000);

  const entidades = await Entidade.find({ contaId, 'configuracoes.monitorada': true });
  const dadosPortfolio = await compilarDadosPortfolio(entidades, periodoInicio, periodoFim);
  const resumoOperacional = await compilarResumoOperacional(contaId, entidades, periodoInicio, periodoFim);

  const { resumoTexto, custoUsd, modelo } = await analisarPortfolio(conta, dadosPortfolio, resumoOperacional, periodoInicio, periodoFim);

  const html = renderizarRelatorioHtml({ conta, periodoInicio, periodoFim, dadosPortfolio, resumoOperacional, resumoTexto });

  const relatorio = await Relatorio.create({
    contaId,
    periodoInicio,
    periodoFim,
    resumoTexto,
    conteudoHtml: html,
    custoTokensUsd: custoUsd,
    modeloUsado: modelo,
    geradoEm: new Date(),
  });

  if (conta.configuracoes?.googleSheetsId) {
    try {
      await atualizarPlanilhaSemanal(conta.configuracoes.googleSheetsId, dadosPortfolio, { periodoInicio, periodoFim });
      relatorio.googleSheetsAtualizado = true;
      await relatorio.save();
    } catch (erro) {
      logger.error({ msg: 'Falha ao atualizar Google Sheets — relatório segue válido', contaId: String(contaId), erro: erro.message });
    }
  }

  logger.info({ msg: 'Relatório semanal gerado', contaId: String(contaId), relatorioId: String(relatorio._id), custoUsd: custoUsd.toFixed(4) });
  return relatorio;
}

/**
 * Envia o relatório semanal já gerado via WhatsApp, com um resumo curto e
 * (se `URL_BASE` estiver configurado) um link pro relatório completo.
 * @param {Object} relatorio - documento Relatorio
 * @param {Object} conta - documento Conta
 */
export async function enviarRelatorioWhatsapp(relatorio, conta) {
  const destinatario = conta.notificacao?.whatsappJid || config.evolution.whatsappJidPadrao;
  if (!destinatario) {
    logger.warn({ msg: 'Sem destinatário configurado para envio do relatório semanal', contaId: String(conta._id) });
    return;
  }

  const link = config.urlBase ? `${config.urlBase.replace(/\/$/, '')}/relatorios/${relatorio._id}` : null;
  const texto = construirMensagemRelatorio(relatorio, conta, link);

  await enviarMensagemWhatsapp(destinatario, texto);

  relatorio.enviadoWhatsapp = true;
  await relatorio.save();
}

/** Monta a mensagem de WhatsApp com o resumo curto + link do relatório. */
function construirMensagemRelatorio(relatorio, conta, link) {
  const periodo = `${formatarData(relatorio.periodoInicio)} a ${formatarData(relatorio.periodoFim)}`;
  let texto = `📊 *Relatório semanal — ${conta.nome}*\n${periodo}\n\n${resumirTexto(relatorio.resumoTexto)}`;

  if (link) {
    texto += `\n\n🔗 Relatório completo: ${link}`;
  }

  return texto;
}

/** Remove marcações markdown e trunca o resumo pra exibição no WhatsApp. */
function resumirTexto(markdown, tamanhoMaximo = 600) {
  const textoLimpo = (markdown ?? '')
    .replaceAll(/^##\s*/gm, '')
    .replaceAll(/\*\*(.+?)\*\*/g, '$1')
    .trim();

  if (textoLimpo.length <= tamanhoMaximo) return textoLimpo;
  return `${textoLimpo.slice(0, tamanhoMaximo)}...`;
}

function formatarData(data) {
  return new Date(data).toLocaleDateString('pt-BR');
}

/** Agrega métricas da semana por entidade (janela 24h, somadas/médias). */
async function compilarDadosPortfolio(entidades, periodoInicio, periodoFim) {
  const dados = [];

  for (const entidade of entidades) {
    const resultado = await query(
      `
      SELECT metrica,
             AVG(valor) AS media,
             SUM(valor) AS soma,
             COUNT(*) AS n
      FROM metricas_serie_temporal
      WHERE entidade_id = $1 AND janela_horas = 24
        AND coletada_em BETWEEN $2 AND $3
        AND metrica = ANY($4)
      GROUP BY metrica
      `,
      [String(entidade._id), periodoInicio, periodoFim, METRICAS_RESUMO]
    );

    if (resultado.rows.length === 0) continue;

    const metricas = {};
    for (const linha of resultado.rows) {
      metricas[linha.metrica] = {
        media: arredondar(Number(linha.media), 4),
        soma: arredondar(Number(linha.soma), 4),
        observacoes: Number(linha.n),
      };
    }

    dados.push({
      entidadeId: String(entidade._id),
      nome: entidade.nome,
      tipo: entidade.tipo,
      objetivo: entidade.objetivo,
      metricas,
    });
  }

  return dados;
}

/** Conta anomalias, investigações e notificações no período. */
async function compilarResumoOperacional(contaId, entidades, periodoInicio, periodoFim) {
  const idsEntidades = entidades.map((e) => e._id);
  const filtroPeriodo = { detectadaEm: { $gte: periodoInicio, $lte: periodoFim } };

  const [totalAnomalias, totalInvestigacoes, totalNotificacoes, feedbackUtil, feedbackRuido] = await Promise.all([
    Anomalia.countDocuments({ entidadeId: { $in: idsEntidades }, ...filtroPeriodo }),
    Investigacao.countDocuments({ contaId, inicioEm: { $gte: periodoInicio, $lte: periodoFim } }),
    Notificacao.countDocuments({ contaId, enviadaEm: { $gte: periodoInicio, $lte: periodoFim } }),
    Investigacao.countDocuments({ contaId, inicioEm: { $gte: periodoInicio, $lte: periodoFim }, decidiuNotificar: true }),
    Investigacao.countDocuments({ contaId, inicioEm: { $gte: periodoInicio, $lte: periodoFim }, decidiuNotificar: false }),
  ]);

  return {
    totalAnomalias,
    totalInvestigacoes,
    totalNotificacoes,
    investigacoesQueNotificaram: feedbackUtil,
    investigacoesQueNaoNotificaram: feedbackRuido,
  };
}
