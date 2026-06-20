/**
 * Resumo diário via WhatsApp — enviado às 08h com as métricas do dia anterior.
 * Busca os valores mais recentes de cada métrica relevante no Postgres
 * (janela=24h) e formata uma mensagem clara por conta e entidade.
 * Sem IA — apenas consulta + formatação.
 */
import { Conta } from '../../dominio/conta.modelo.js';
import { Entidade } from '../../dominio/entidade.modelo.js';
import { Notificacao } from '../../dominio/notificacao.modelo.js';
import { query } from '../../infra/postgres.js';
import { enviarMensagemWhatsapp } from '../notificacao/enviador-whatsapp.servico.js';
import { config } from '../../config/index.js';
import { logger } from '../../infra/logger.js';

const METRICAS_RESUMO = ['spend', 'impressions', 'reach', 'clicks', 'ctr', 'cpm', 'conversions', 'cost_per_conversion', 'purchase_roas'];

export async function enviarResumoDiarioContas() {
  const contas = await Conta.find({ ativo: true });

  for (const conta of contas) {
    try {
      await enviarResumoDiarioConta(conta);
    } catch (erro) {
      logger.error({ msg: 'Falha ao enviar resumo diário', contaId: String(conta._id), erro: erro.message });
    }
  }
}

async function enviarResumoDiarioConta(conta) {
  const destinatario = conta.notificacao?.whatsappJid || config.evolution.whatsappJidPadrao;
  if (!destinatario) return;

  const entidades = await Entidade.find({
    contaId: conta._id,
    'configuracoes.monitorada': true,
    tipo: { $in: ['campaign', 'adset'] }, // exibe apenas campaign e adset
  }).sort({ tipo: 1, nome: 1 });

  if (entidades.length === 0) return;

  const ontem = new Date();
  ontem.setDate(ontem.getDate() - 1);
  const dataStr = ontem.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const blocos = [];

  for (const entidade of entidades) {
    const metricas = await obterMetricasRecentes(String(entidade._id));
    if (Object.keys(metricas).length === 0) continue;

    const linhas = [`*${entidade.nome}* (${entidade.tipo})`];

    if (metricas.spend != null)               linhas.push(`• Gasto: ${fmt(metricas.spend, 'currency')}`);
    if (metricas.impressions != null)          linhas.push(`• Impressões: ${fmt(metricas.impressions, 'integer')}`);
    if (metricas.reach != null)                linhas.push(`• Alcance: ${fmt(metricas.reach, 'integer')}`);
    if (metricas.clicks != null)               linhas.push(`• Cliques: ${fmt(metricas.clicks, 'integer')}`);
    if (metricas.ctr != null)                  linhas.push(`• CTR: ${fmt(metricas.ctr, 'percent')}`);
    if (metricas.cpm != null)                  linhas.push(`• CPM: ${fmt(metricas.cpm, 'currency')}`);
    if (metricas.conversions > 0)              linhas.push(`• Conversões: ${fmt(metricas.conversions, 'integer')}`);
    if (metricas.cost_per_conversion > 0)      linhas.push(`• Custo/conv: ${fmt(metricas.cost_per_conversion, 'currency')}`);
    if (metricas.purchase_roas > 0)            linhas.push(`• ROAS: ${fmt(metricas.purchase_roas, 'multiplier')}`);

    blocos.push(linhas.join('\n'));
  }

  if (blocos.length === 0) {
    logger.info({ msg: 'Resumo diário sem dados para enviar', contaId: String(conta._id) });
    return;
  }

  const mensagem = [
    `📊 *Resumo diário — ${conta.nome}*`,
    `${dataStr}`,
    ``,
    blocos.join('\n\n'),
  ].join('\n');

  let status = 'enviada';
  try {
    await enviarMensagemWhatsapp(destinatario, mensagem);
  } catch (erro) {
    status = 'erro';
    logger.error({ msg: 'Falha ao enviar resumo diário WhatsApp', contaId: String(conta._id), erro: erro.message });
  }

  await Notificacao.create({
    contaId: conta._id,
    tipo: 'resumo_diario',
    canal: 'whatsapp',
    destinatario,
    conteudo: mensagem,
    enviadaEm: new Date(),
    status,
  });

  logger.info({ msg: 'Resumo diário enviado', conta: conta.nome, status });
}

async function obterMetricasRecentes(entidadeId) {
  const desde48h = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const resultado = await query(
    `SELECT DISTINCT ON (metrica)
       metrica, valor
     FROM metricas_serie_temporal
     WHERE entidade_id = $1
       AND janela_horas = 24
       AND coletada_em >= $2
     ORDER BY metrica, coletada_em DESC`,
    [entidadeId, desde48h]
  );

  return Object.fromEntries(resultado.rows.map((r) => [r.metrica, Number(r.valor)]));
}

function fmt(v, unidade) {
  if (v == null) return '—';
  const n = Number(v);
  switch (unidade) {
    case 'currency':   return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case 'percent':    return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
    case 'multiplier': return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x`;
    default:           return n.toLocaleString('pt-BR');
  }
}
