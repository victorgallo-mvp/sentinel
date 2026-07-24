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
import { computarVeredito, buscarGastoMes } from '../analise/veredito.servico.js';
import { metricaResultadoEntidade } from '../../config/metricas.config.js';
import { config } from '../../config/index.js';
import { logger } from '../../infra/logger.js';

const JANELA_30D_HORAS = 720;
const LIMIAR_GASTO_SEM_CONVERSAO = 30; // R$ — só destaca "gastou sem converter" acima disso
const METRICAS = ['spend', 'impressions', 'clicks', 'conversions', 'messaging_conversations_started', 'leads'];
const SALDO_ORDEM = { zerado: 0, bloqueado: 1, critico: 2, acabando: 3, ok: 4 };

/**
 * Determina quantos dias o resumo deve cobrir conforme o dia da semana:
 *  - Segunda (1): cobre quinta a domingo → 4 dias
 *  - Quinta  (4): cobre segunda a quarta → 3 dias
 * Retorna null em outros dias (não envia resumo).
 */
function diasAtrasParaResumo() {
  const dia = new Date().getDay(); // 0=dom … 6=sab
  if (dia === 1) return 4; // segunda: cobre qui-dom
  if (dia === 4) return 3; // quinta: cobre seg-qua
  return null;
}

export async function enviarResumoDiarioContas() {
  const diasAtras = diasAtrasParaResumo();
  if (diasAtras === null) {
    logger.info({ msg: 'Resumo de período — dia não é segunda nem quinta, pulando' });
    return;
  }

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
      await enviarResumoDiarioBm(bmId, contasBm, diasAtras);
    } catch (erro) {
      logger.error({ msg: 'Falha ao enviar resumo da BM', bmId, erro: erro.message });
    }
  }
}

async function enviarResumoDiarioBm(bmId, contasBm, diasAtras = 1) {
  // Destinatários = união dos das contas da BM (dedup)
  const destinatarios = [...new Set(contasBm.flatMap((c) => resolverDestinatarios(c)))];
  if (!destinatarios.length) return;

  const dados = await montarDadosResumoBm(contasBm, { diasAtras });
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
 * Agrega os dados do período para uma BM. `diasAtras` define quantos dias cobrir:
 * 1 = só ontem (padrão/mini-resumo), 3 = seg-qua, 4 = qui-dom.
 * Exportada para dry-run/testes e para o mini-resumo do dashboard.
 */
export async function montarDadosResumoBm(contasBm, { diasAtras = 1 } = {}) {
  const contaIds = contasBm.map((c) => c._id);
  const campanhas = await Entidade.find({
    contaId: { $in: contaIds },
    tipo: 'campaign',
    'configuracoes.monitorada': true,
  }).select('_id nome status objetivo optimizationGoal').lean();

  const campanhasAtivas = campanhas.filter((c) => c.status === 'ACTIVE');
  if (campanhas.length === 0) return null;

  const nomeBm = [...new Set(contasBm.map((c) => c.nome))].join(' + ');

  // Período: de `diasAtras` dias atrás (00:00) até hoje (00:00 = exclusive)
  const inicioPeriodo = new Date(); inicioPeriodo.setDate(inicioPeriodo.getDate() - diasAtras); inicioPeriodo.setHours(0, 0, 0, 0);
  const inicioHoje = new Date(); inicioHoje.setHours(0, 0, 0, 0);
  const fimPeriodo = new Date(inicioHoje.getTime() - 1); // último ms de ontem

  const fmtData = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const dataStr = diasAtras <= 1
    ? fmtData(new Date(fimPeriodo))
    : `${fmtData(inicioPeriodo)} a ${fmtData(fimPeriodo)}`;

  const ids = campanhas.map((c) => String(c._id));
  const nomePorId    = Object.fromEntries(campanhas.map((c) => [String(c._id), c.nome]));
  const objetivoPorId = Object.fromEntries(campanhas.map((c) => [String(c._id), c.objetivo]));

  // Para cada campanha+métrica: soma o último snapshot de 24h de cada dia no período.
  // Todas as METRICAS do resumo são counters (spend, clicks, conversions…), então
  // somar os snapshots diários dá o total correto do período.
  const res = await query(
    `WITH ultimas AS (
       SELECT entidade_id, metrica, date_trunc('day', coletada_em) AS dia, MAX(coletada_em) AS ts
       FROM metricas_serie_temporal
       WHERE entidade_id = ANY($1) AND janela_horas = 24 AND metrica = ANY($2)
         AND coletada_em >= $3 AND coletada_em < $4
       GROUP BY entidade_id, metrica, date_trunc('day', coletada_em)
     )
     SELECT u.entidade_id, u.metrica, SUM(m.valor)::float AS valor
     FROM ultimas u
     JOIN metricas_serie_temporal m
       ON m.entidade_id = u.entidade_id AND m.coletada_em = u.ts
       AND m.metrica = u.metrica AND m.janela_horas = 24
     GROUP BY u.entidade_id, u.metrica`,
    [ids, METRICAS, inicioPeriodo, inicioHoje]
  );

  const porCampanha = {};
  for (const { entidade_id, metrica, valor } of res.rows) {
    (porCampanha[entidade_id] ??= {})[metrica] = Number(valor);
  }

  const totais = { gasto: 0, impressoes: 0, cliques: 0, conversoes: 0, conversasWpp: 0, leads: 0 };
  const semResultado = [];
  for (const [id, m] of Object.entries(porCampanha)) {
    totais.gasto += m.spend ?? 0;
    totais.impressoes += m.impressions ?? 0;
    totais.cliques += m.clicks ?? 0;
    totais.conversoes += m.conversions ?? 0;
    totais.conversasWpp += m.messaging_conversations_started ?? 0;
    totais.leads += m.leads ?? 0;
    const gasto = m.spend ?? 0;
    // Prefere optimizationGoal do adset quando disponível (mais específico).
    const metricaAlvo = metricaResultadoEntidade(campanhas.find((c) => String(c._id) === id));
    const ALERTAVEIS = new Set(['conversions', 'leads', 'messaging_conversations_started']);
    if (gasto >= LIMIAR_GASTO_SEM_CONVERSAO && ALERTAVEIS.has(metricaAlvo) && (m[metricaAlvo] ?? 0) === 0) {
      semResultado.push({ nome: nomePorId[id] ?? id, gasto: Number(gasto.toFixed(2)) });
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
  const custoPorLead = totais.leads > 0 ? totais.gasto / totais.leads : null;

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

  // Perfil (gerente/investimento/objetivos) — usa a conta da BM que tiver objetivos.
  const contaPerfil = contasBm.find((c) => (c.perfil?.objetivos ?? []).length > 0) ?? contasBm[0];
  const [gastoMes, veredito] = await Promise.all([
    buscarGastoMes(ids),
    computarVeredito(ids, contaPerfil?.perfil),
  ]);
  const investimentoMensal = contaPerfil?.perfil?.investimentoMensalPlanejado ?? null;

  return {
    bm: nomeBm,
    data: dataStr,
    gerente: contaPerfil?.perfil?.gerenteResponsavel || null,
    totais: {
      gasto: Number(totais.gasto.toFixed(2)),
      impressoes: totais.impressoes,
      cliques: totais.cliques,
      ctr: ctr != null ? Number(ctr.toFixed(2)) : null,
      cpm: cpm != null ? Number(cpm.toFixed(2)) : null,
      conversoes: totais.conversoes,
      custoPorConversao: custoPorConversao != null ? Number(custoPorConversao.toFixed(2)) : null,
      conversasWpp: totais.conversasWpp,
      leads: totais.leads,
      custoPorLead: custoPorLead != null ? Number(custoPorLead.toFixed(2)) : null,
    },
    campanhasAtivas: campanhasAtivas.length,
    campanhasTotal: campanhas.length,
    semConversao: semResultado,
    saldo,
    alertas24h,
    gasto30d: Number(gasto30d.toFixed(2)),
    gastoMes: Number(gastoMes.toFixed(2)),
    investimentoMensal,
    veredito, // { direcao: 'melhorou'|'estavel'|'piorou', scorePct, detalhes[] } | null
  };
}

/** Resumo determinístico compacto — usado quando a IA está off ou falha. */
function montarResumoFallback(d) {
  const t = d.totais;
  const SETA = { melhorou: '📈', estavel: '➖', piorou: '📉' };
  const linhas = [
    `📊 *Resumo — ${d.bm}*`,
    `${d.data}` + (d.gerente ? ` · resp.: ${d.gerente}` : ''),
    ``,
    `• Gasto: ${fmt(t.gasto, 'currency')}` + (t.conversoes > 0 ? ` · Conversões: ${fmt(t.conversoes, 'integer')}` : '') + (t.leads > 0 ? ` · Leads: ${fmt(t.leads, 'integer')}` : '') + (t.conversasWpp > 0 ? ` · Conversas WPP: ${fmt(t.conversasWpp, 'integer')}` : ''),
    `• Impressões: ${fmt(t.impressoes, 'integer')} · CTR: ${t.ctr != null ? fmt(t.ctr, 'percent') : '—'} · CPM: ${t.cpm != null ? fmt(t.cpm, 'currency') : '—'}`,
    `• Campanhas ativas: ${d.campanhasAtivas}/${d.campanhasTotal}`,
  ];

  if (d.investimentoMensal > 0) {
    const pct = Math.round((d.gastoMes / d.investimentoMensal) * 100);
    linhas.push(`• Mês: ${fmt(d.gastoMes, 'currency')} de ${fmt(d.investimentoMensal, 'currency')} (${pct}%)`);
  }
  if (d.veredito) {
    const dir = { melhorou: 'melhorou', estavel: 'estável', piorou: 'piorou' }[d.veredito.direcao];
    linhas.push(`• Tendência (7d vs 7d): ${SETA[d.veredito.direcao]} *${dir}* (${d.veredito.scorePct > 0 ? '+' : ''}${d.veredito.scorePct}%)`);
  }

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
