/**
 * Resumo diário via WhatsApp — enviado às 08h com o panorama do dia anterior.
 * Agrega no nível da BM (consolida todas as contas ativas que compartilham a mesma
 * BM), não por campanha/adset. O texto é redigido pela IA (Haiku) com destaque para
 * os pontos de atenção; se a IA estiver desligada ou falhar, cai para um resumo
 * determinístico compacto — a notificação nunca depende só da IA.
 */
import { Conta } from '../../dominio/conta.modelo.js';
import { Entidade } from '../../dominio/entidade.modelo.js';
import { Notificacao } from '../../dominio/notificacao.modelo.js';
import { query } from '../../infra/postgres.js';
import { enviarMensagemWhatsapp, resolverDestinatarios } from '../notificacao/enviador-whatsapp.servico.js';
import { redigirResumoDiario } from './resumo-diario.agente.js';
import { config } from '../../config/index.js';
import { logger } from '../../infra/logger.js';

const JANELA_30D_HORAS = 720;
const LIMIAR_GASTO_SEM_CONVERSAO = 30; // R$ — só destaca "gastou sem converter" acima disso
const METRICAS = ['spend', 'impressions', 'clicks', 'conversions', 'messaging_conversations_started'];
const SALDO_ORDEM = { zerado: 0, bloqueado: 1, critico: 2, acabando: 3, ok: 4 };

export async function enviarResumoDiarioContas() {
  const contas = await Conta.find({ ativo: true });

  // Consolida por BM: contas que compartilham metaConfig.bmId viram um único resumo.
  const porBm = new Map();
  for (const conta of contas) {
    const bm = conta.metaConfig?.bmId || `sem-bm-${conta._id}`;
    if (!porBm.has(bm)) porBm.set(bm, []);
    porBm.get(bm).push(conta);
  }

  for (const [bmId, contasBm] of porBm) {
    try {
      await enviarResumoDiarioBm(bmId, contasBm);
    } catch (erro) {
      logger.error({ msg: 'Falha ao enviar resumo diário da BM', bmId, erro: erro.message });
    }
  }
}

async function enviarResumoDiarioBm(bmId, contasBm) {
  // Destinatários = união dos das contas da BM (dedup)
  const destinatarios = [...new Set(contasBm.flatMap((c) => resolverDestinatarios(c)))];
  if (!destinatarios.length) return;

  const dados = await montarDadosResumoBm(contasBm);
  if (!dados) return;

  // Texto: IA (com fallback) ou determinístico
  let mensagem;
  if (config.iaResumoDiarioAtivo) {
    try {
      const { texto } = await redigirResumoDiario(dados);
      mensagem = texto || montarResumoFallback(dados);
    } catch (erro) {
      logger.warn({ msg: 'IA do resumo diário falhou — usando fallback determinístico', bm: dados.bm, erro: erro.message });
      mensagem = montarResumoFallback(dados);
    }
  } else {
    mensagem = montarResumoFallback(dados);
  }

  let status = 'enviada';
  try {
    await enviarMensagemWhatsapp(destinatarios, mensagem);
  } catch (erro) {
    status = 'erro';
    logger.error({ msg: 'Falha ao enviar resumo diário WhatsApp', bm: dados.bm, erro: erro.message });
  }

  await Notificacao.create({
    contaId: contasBm[0]._id,
    tipo: 'resumo_diario',
    canal: 'whatsapp',
    destinatario: destinatarios.join(','),
    conteudo: mensagem,
    enviadaEm: new Date(),
    status,
  });

  logger.info({ msg: 'Resumo diário enviado', bm: dados.bm, status });
}

/**
 * Agrega os dados do dia anterior para uma BM (conjunto de contas que compartilham
 * o mesmo bmId). Retorna o objeto `dados` para o agente/fallback, ou null se não
 * houver campanhas ou gasto ontem. Exportada para permitir dry-run/testes.
 */
export async function montarDadosResumoBm(contasBm) {
  const contaIds = contasBm.map((c) => c._id);
  const campanhas = await Entidade.find({
    contaId: { $in: contaIds },
    tipo: 'campaign',
    'configuracoes.monitorada': true,
  }).select('_id nome status').lean();

  const campanhasAtivas = campanhas.filter((c) => c.status === 'ACTIVE');
  if (campanhas.length === 0) return null;

  const nomeBm = [...new Set(contasBm.map((c) => c.nome))].join(' + ');
  const ontem = new Date();
  ontem.setDate(ontem.getDate() - 1);
  const dataStr = ontem.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const ids = campanhas.map((c) => String(c._id));
  const nomePorId = Object.fromEntries(campanhas.map((c) => [String(c._id), c.nome]));

  // Métricas de ONTEM por campanha (última leitura da janela 24h daquele dia)
  const inicioOntem = new Date(); inicioOntem.setDate(inicioOntem.getDate() - 1); inicioOntem.setHours(0, 0, 0, 0);
  const inicioHoje = new Date(); inicioHoje.setHours(0, 0, 0, 0);

  const res = await query(
    `SELECT DISTINCT ON (entidade_id, metrica) entidade_id, metrica, valor
     FROM metricas_serie_temporal
     WHERE entidade_id = ANY($1) AND janela_horas = 24 AND metrica = ANY($2)
       AND coletada_em >= $3 AND coletada_em < $4
     ORDER BY entidade_id, metrica, coletada_em DESC`,
    [ids, METRICAS, inicioOntem, inicioHoje]
  );

  const porCampanha = {};
  for (const { entidade_id, metrica, valor } of res.rows) {
    (porCampanha[entidade_id] ??= {})[metrica] = Number(valor);
  }

  const totais = { gasto: 0, impressoes: 0, cliques: 0, conversoes: 0, conversasWpp: 0 };
  const semConversao = [];
  for (const [id, m] of Object.entries(porCampanha)) {
    totais.gasto += m.spend ?? 0;
    totais.impressoes += m.impressions ?? 0;
    totais.cliques += m.clicks ?? 0;
    totais.conversoes += m.conversions ?? 0;
    totais.conversasWpp += m.messaging_conversations_started ?? 0;
    const gasto = m.spend ?? 0;
    const resultados = (m.conversions ?? 0) + (m.messaging_conversations_started ?? 0);
    if (gasto >= LIMIAR_GASTO_SEM_CONVERSAO && resultados === 0) {
      semConversao.push({ nome: nomePorId[id] ?? id, gasto: Number(gasto.toFixed(2)) });
    }
  }

  // Se ninguém gastou ontem, não manda nada.
  if (totais.gasto === 0) {
    logger.info({ msg: 'Resumo diário sem gasto ontem — não enviado', bm: nomeBm });
    return;
  }

  const ctr = totais.impressoes > 0 ? (totais.cliques / totais.impressoes) * 100 : null;
  const cpm = totais.impressoes > 0 ? (totais.gasto / totais.impressoes) * 1000 : null;
  const custoPorConversao = totais.conversoes > 0 ? totais.gasto / totais.conversoes : null;

  // Gasto real de 30d (janela 720, nível campanha)
  const r30 = await query(
    `SELECT COALESCE(SUM(s), 0)::float AS total FROM (
       SELECT DISTINCT ON (entidade_id) valor AS s
       FROM metricas_serie_temporal
       WHERE entidade_id = ANY($1) AND metrica = 'spend' AND janela_horas = $2
       ORDER BY entidade_id, coletada_em DESC
     ) x`,
    [ids, JANELA_30D_HORAS]
  );
  const gasto30d = Number(r30.rows[0]?.total ?? 0);

  // Saldo pré-pago (pior snapshot por conta pré-paga)
  const saldo = [];
  for (const c of contasBm) {
    if (!c.configuracoes?.prepago) continue;
    const pior = [...(c.saldoPrepago ?? [])].sort((a, b) => (SALDO_ORDEM[a.nivel] ?? 9) - (SALDO_ORDEM[b.nivel] ?? 9))[0];
    if (pior?.nivel) saldo.push({ conta: c.nome, nivel: pior.nivel, saldoReais: pior.saldoReais ?? null, runwayHoras: pior.runwayHoras ?? null });
  }

  // Alertas enviados nas últimas 24h para as contas da BM
  const desde24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const alertas24h = await Notificacao.countDocuments({
    contaId: { $in: contaIds },
    tipo: { $in: ['alerta_orcamento', 'alerta_entrega', 'alerta_performance'] },
    status: 'enviada',
    enviadaEm: { $gte: desde24h },
  });

  return {
    bm: nomeBm,
    data: dataStr,
    totais: {
      gasto: Number(totais.gasto.toFixed(2)),
      impressoes: totais.impressoes,
      cliques: totais.cliques,
      ctr: ctr != null ? Number(ctr.toFixed(2)) : null,
      cpm: cpm != null ? Number(cpm.toFixed(2)) : null,
      conversoes: totais.conversoes,
      custoPorConversao: custoPorConversao != null ? Number(custoPorConversao.toFixed(2)) : null,
      conversasWpp: totais.conversasWpp,
    },
    campanhasAtivas: campanhasAtivas.length,
    campanhasTotal: campanhas.length,
    semConversao,
    saldo,
    alertas24h,
    gasto30d: Number(gasto30d.toFixed(2)),
  };
}

/** Resumo determinístico compacto — usado quando a IA está off ou falha. */
function montarResumoFallback(d) {
  const t = d.totais;
  const linhas = [
    `📊 *Resumo diário — ${d.bm}*`,
    `${d.data}`,
    ``,
    `• Gasto: ${fmt(t.gasto, 'currency')}` + (t.conversoes > 0 ? ` · Conversões: ${fmt(t.conversoes, 'integer')}` : '') + (t.conversasWpp > 0 ? ` · Conversas WPP: ${fmt(t.conversasWpp, 'integer')}` : ''),
    `• Impressões: ${fmt(t.impressoes, 'integer')} · CTR: ${t.ctr != null ? fmt(t.ctr, 'percent') : '—'} · CPM: ${t.cpm != null ? fmt(t.cpm, 'currency') : '—'}`,
    `• Campanhas ativas: ${d.campanhasAtivas}/${d.campanhasTotal}`,
  ];

  const atencao = [];
  for (const s of d.saldo) {
    if (s.nivel === 'ok') continue;
    const rw = s.runwayHoras != null ? ` (~${Math.round(s.runwayHoras)}h)` : '';
    atencao.push(`⚠️ Saldo ${s.nivel}${rw} — ${s.conta}`);
  }
  if (d.semConversao.length) {
    atencao.push(`⚠️ Gastando sem converter: ${d.semConversao.map((c) => `${c.nome} (${fmt(c.gasto, 'currency')})`).join(', ')}`);
  }
  if (d.alertas24h > 0) atencao.push(`⚠️ ${d.alertas24h} alerta(s) nas últimas 24h`);

  if (atencao.length) {
    linhas.push(``, `*Pontos de atenção:*`, ...atencao);
  } else {
    linhas.push(``, `✅ Sem pontos de atenção.`);
  }
  return linhas.join('\n');
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
