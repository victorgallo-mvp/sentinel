/**
 * Verificações de performance que não dependem de baseline estatístico:
 *
 * 1. Frequência de saturação: quando `frequency` (24h) >= threshold configurado (padrão 3.0×)
 *    indica que a audiência está vendo o mesmo criativo repetidamente — sinal para renovar.
 *
 * 2. Zero conversões com gasto ativo: campanhas de conversão (OUTCOME_SALES / OUTCOME_LEADS /
 *    OUTCOME_APP_PROMOTION) que gastaram > limiar configurado (padrão R$30) mas registraram
 *    0 conversões no período de 24h.
 *
 * Throttle: 24h por entidade — ambos os alertas são estados persistentes.
 */
import { Conta } from '../../dominio/conta.modelo.js';
import { Entidade } from '../../dominio/entidade.modelo.js';
import { Notificacao } from '../../dominio/notificacao.modelo.js';
import { query } from '../../infra/postgres.js';
import { enviarMensagemWhatsapp, resolverDestinatarios } from '../notificacao/enviador-whatsapp.servico.js';
import { logger } from '../../infra/logger.js';
import { metricaResultado } from '../../config/metricas.config.js';

const THRESHOLD_FREQUENCIA = 3.0;
const LIMIAR_GASTO_ZERO_CONVERSOES = 30; // R$
const JANELA_RENOTIFICACAO_HORAS = 24;

// Fadiga de criativo: frequência acumulada 30d alta E CTR 7d caindo vs 7d anterior
const FADIGA_FREQ_30D_MINIMA = 3.0;      // frequência acumulada 30d >= 3x → audiência saturou
const FADIGA_CTR_QUEDA_MIN_PCT = 15;     // CTR 7d caiu >= 15% relativo vs 7d anterior
const FADIGA_RENOTIFICACAO_HORAS = 48;   // sinal lento — renotifica a cada 48h

// A métrica de 24h é o acumulado de HOJE (date_preset 'today') e zera à meia-noite.
// Só alertamos com base na coleta mais recente — a coleta roda de hora em hora, então
// uma janela de 2h cobre um eventual tick perdido. Sem isso, uma leitura velha (ex.: a
// frequência acumulada do fim de ontem) dispararia alerta falso enquanto o valor real
// de hoje já zerou/está baixo. Espelha o filtro por dia que o dashboard usa.
const FRESCOR_MAX_HORAS = 2;

// Métricas de resultado que fazem sentido ter alerta de "zero resultados com gasto".
// Cliques e alcance não entram — são métricas de entrega, não de resultado de negócio.
const METRICAS_ALERTAVEIS_ZERO = new Set(['conversions', 'leads', 'messaging_conversations_started']);

export async function verificarPerformance() {
  const contas = await Conta.find({ ativo: true });

  for (const conta of contas) {
    try {
      await verificarPerformanceConta(conta);
    } catch (erro) {
      logger.error({ msg: 'Falha ao verificar performance da conta', contaId: String(conta._id), erro: erro.message });
    }
  }
}

async function verificarPerformanceConta(conta) {
  const destinatarios = resolverDestinatarios(conta);
  if (!destinatarios.length) return;

  const entidades = await Entidade.find({
    contaId: conta._id,
    tipo: { $in: ['campaign', 'adset'] },
    status: 'ACTIVE',
    'configuracoes.monitorada': true,
  });

  for (const entidade of entidades) {
    try {
      await verificarFrequenciaSaturacao(conta, entidade, destinatarios);
      await verificarFadigaCriativo(conta, entidade, destinatarios);

      // Resolve a métrica-resultado pelo objetivo da campanha e só alerta
      // se for uma métrica de negócio rastreável (conversão, lead, mensagem).
      const metricaAlvo = metricaResultado(entidade.objetivo);
      if (METRICAS_ALERTAVEIS_ZERO.has(metricaAlvo)) {
        await verificarZeroResultados(conta, entidade, destinatarios, metricaAlvo);
      }
    } catch (erro) {
      logger.warn({ msg: 'Falha ao verificar performance da entidade', entidadeId: String(entidade._id), nome: entidade.nome, erro: erro.message });
    }
  }

  // Metas personalizadas são verificadas no nível da conta (não por entidade),
  // usando IDs de campanhas ativas como escopo para agregar as métricas.
  const campanhaIds = entidades
    .filter((e) => e.tipo === 'campaign')
    .map((e) => String(e._id));
  await verificarMetasPersonalizadas(conta, campanhaIds);
}

async function verificarFrequenciaSaturacao(conta, entidade, destinatarios) {
  const frescorCutoff = new Date(Date.now() - FRESCOR_MAX_HORAS * 60 * 60 * 1000);
  const res = await query(
    `SELECT valor FROM metricas_serie_temporal
     WHERE entidade_id = $1 AND metrica = 'frequency' AND janela_horas = 24
       AND coletada_em >= $2
     ORDER BY coletada_em DESC LIMIT 2`,
    [String(entidade._id), frescorCutoff]
  );

  // Persistência: só alerta se as DUAS últimas coletas recentes estiverem acima do
  // limite. Saturação real é sustentada; picos transitórios da Meta (ex.: campanha
  // recém-reativada com alcance minúsculo devolvendo freq alta numa única coleta,
  // que se corrige na coleta seguinte) não devem disparar.
  if (res.rows.length < 2) return;
  const [atual, anterior] = res.rows.map((r) => Number(r.valor));
  const threshold = entidade.configuracoes?.thresholdFrequenciaSaturacao ?? THRESHOLD_FREQUENCIA;
  if (atual < threshold || anterior < threshold) return;

  const frequencia = atual;

  const desde = new Date(Date.now() - JANELA_RENOTIFICACAO_HORAS * 60 * 60 * 1000);
  const chaveAlerta = `frequencia_saturacao_${String(entidade._id)}`;
  const jaAvisou = await Notificacao.exists({
    contaId: conta._id,
    tipo: 'alerta_performance',
    canal: 'whatsapp',
    conteudo: new RegExp(chaveAlerta),
    enviadaEm: { $gte: desde },
  });
  if (jaAvisou) return;

  const tipoLabel = entidade.tipo === 'campaign' ? 'Campanha' : 'Conjunto';
  const mensagem = [
    `🔄 *Frequência elevada — considere renovar o criativo*`,
    ``,
    `Conta: *${conta.nome}*`,
    `${tipoLabel}: *${entidade.nome}*`,
    `Frequência hoje: *${frequencia.toFixed(2)}×* (limite: ${threshold.toFixed(1)}×)`,
    ``,
    `Alta frequência indica que a mesma pessoa está vendo o mesmo anúncio repetidamente.`,
    `Ações sugeridas: criar variações de criativo, expandir a audiência ou pausar temporariamente.`,
    `<!-- ${chaveAlerta} -->`,
  ].join('\n');

  let envioStatus = 'enviada';
  try {
    await enviarMensagemWhatsapp(destinatarios, mensagem);
  } catch (e) {
    envioStatus = 'erro';
    logger.error({ msg: 'Falha ao enviar alerta de frequência', conta: conta.nome, entidade: entidade.nome, destinatario: destinatarios.join(','), erro: e.message });
  }

  await Notificacao.create({
    contaId: conta._id,
    tipo: 'alerta_performance',
    entidadeId: entidade._id,
    canal: 'whatsapp',
    destinatario: destinatarios.join(','),
    conteudo: mensagem,
    enviadaEm: new Date(),
    status: envioStatus,
  });

  logger.info({ msg: 'Alerta de frequência elevada', conta: conta.nome, entidade: entidade.nome, frequencia: frequencia.toFixed(2), status: envioStatus });
}

/**
 * Detecta fadiga de criativo usando métricas acumuladas:
 * - Frequência 30d (janela 720h) >= threshold: audiência viu o anúncio muitas vezes
 * - CTR 7d (cliques/impressões dos últimos 7 dias) caiu >= 15% vs 7d anterior
 * Ambas as condições precisam ocorrer simultaneamente.
 */
async function verificarFadigaCriativo(conta, entidade, destinatarios) {
  const entidadeId = String(entidade._id);

  // 1. Frequência acumulada 30d (snapshot nativo da Meta — deduplica por usuário)
  const resFreq = await query(
    `SELECT valor::float FROM metricas_serie_temporal
     WHERE entidade_id = $1 AND janela_horas = 720 AND metrica = 'frequency'
     ORDER BY coletada_em DESC LIMIT 1`,
    [entidadeId]
  );
  if (!resFreq.rows.length) return;
  const freq30d = Number(resFreq.rows[0].valor);
  if (freq30d < FADIGA_FREQ_30D_MINIMA) return;

  // 2. CTR 7d atual vs 7d anterior — calcula via soma de snapshots diários (24h)
  //    CTR ponderado: cliques_totais / impressões_totais × 100
  const agora = new Date();
  const ini7 = new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000);
  const ini14 = new Date(agora.getTime() - 14 * 24 * 60 * 60 * 1000);

  const ctrPeriodo = async (de, ate) => {
    const r = await query(
      `WITH dias AS (
         SELECT date_trunc('day', coletada_em) AS d, MAX(coletada_em) AS ts
         FROM metricas_serie_temporal
         WHERE entidade_id = $1 AND janela_horas = 24 AND metrica IN ('clicks', 'impressions')
           AND coletada_em >= $2 AND coletada_em < $3
         GROUP BY date_trunc('day', coletada_em)
       )
       SELECT m.metrica, SUM(m.valor)::float AS total
       FROM dias
       JOIN metricas_serie_temporal m
         ON m.entidade_id = $1 AND m.coletada_em = dias.ts
         AND m.metrica IN ('clicks', 'impressions') AND m.janela_horas = 24
       GROUP BY m.metrica`,
      [entidadeId, de, ate]
    );
    const vals = Object.fromEntries(r.rows.map((row) => [row.metrica, Number(row.total)]));
    if (!vals.impressions || vals.impressions === 0) return null;
    return (vals.clicks / vals.impressions) * 100;
  };

  const [ctrAtual, ctrAnterior] = await Promise.all([
    ctrPeriodo(ini7, agora),
    ctrPeriodo(ini14, ini7),
  ]);

  if (ctrAtual == null || ctrAnterior == null || ctrAnterior === 0) return;
  const quedaCtrPct = ((ctrAnterior - ctrAtual) / ctrAnterior) * 100;
  if (quedaCtrPct < FADIGA_CTR_QUEDA_MIN_PCT) return;

  // 3. Throttle
  const desde = new Date(Date.now() - FADIGA_RENOTIFICACAO_HORAS * 60 * 60 * 1000);
  const chaveAlerta = `fadiga_criativo_${entidadeId}`;
  const jaAvisou = await Notificacao.exists({
    contaId: conta._id,
    tipo: 'alerta_performance',
    canal: 'whatsapp',
    conteudo: new RegExp(chaveAlerta),
    enviadaEm: { $gte: desde },
  });
  if (jaAvisou) return;

  const tipoLabel = entidade.tipo === 'campaign' ? 'Campanha' : 'Conjunto';
  const mensagem = [
    `🎨 *Fadiga de criativo detectada*`,
    ``,
    `Conta: *${conta.nome}*`,
    `${tipoLabel}: *${entidade.nome}*`,
    ``,
    `Frequência 30d: *${freq30d.toFixed(2)}×* (audiência viu o anúncio ${freq30d.toFixed(1)} vezes em média)`,
    `CTR 7d: *${ctrAnterior.toFixed(2)}%* → *${ctrAtual.toFixed(2)}%* (−${quedaCtrPct.toFixed(0)}%)`,
    ``,
    `Audiência saturada: quem já viu o anúncio muitas vezes está deixando de clicar.`,
    `Ações sugeridas: criar variações de criativo, expandir audiência ou renovar o anúncio.`,
    `<!-- ${chaveAlerta} -->`,
  ].join('\n');

  let envioStatus = 'enviada';
  try {
    await enviarMensagemWhatsapp(destinatarios, mensagem);
  } catch (e) {
    envioStatus = 'erro';
    logger.error({ msg: 'Falha ao enviar alerta de fadiga de criativo', conta: conta.nome, entidade: entidade.nome, erro: e.message });
  }

  await Notificacao.create({
    contaId: conta._id,
    tipo: 'alerta_performance',
    entidadeId: entidade._id,
    canal: 'whatsapp',
    destinatario: destinatarios.join(','),
    conteudo: mensagem,
    enviadaEm: new Date(),
    status: envioStatus,
  });

  logger.info({ msg: 'Alerta de fadiga de criativo', conta: conta.nome, entidade: entidade.nome, freq30d, ctrAtual, ctrAnterior, quedaCtrPct: quedaCtrPct.toFixed(1), status: envioStatus });
}

// ── Metas personalizadas ────────────────────────────────────────────────────

const JANELA_META_HORAS = { '1d': 24, '7d': 168, '30d': 720 };
const JANELA_META_LABEL = { '1d': 'hoje', '7d': '7 dias', '30d': '30 dias' };
const THROTTLE_META_HORAS = 24;

async function somarSnapshot(entidadeIds, metrica, janelaHoras) {
  const r = await query(
    `SELECT COALESCE(SUM(s), 0)::float AS total FROM (
       SELECT DISTINCT ON (entidade_id) valor::float AS s
       FROM metricas_serie_temporal
       WHERE entidade_id = ANY($1) AND metrica = $2 AND janela_horas = $3
       ORDER BY entidade_id, coletada_em DESC
     ) x`,
    [entidadeIds, metrica, janelaHoras]
  );
  return Number(r.rows[0]?.total ?? 0);
}

async function calcularValorMetrica(campanhaIds, metrica, janelaHoras) {
  if (metrica === 'purchase_roas' || metrica === 'website_purchase_roas') {
    const revKey = metrica === 'purchase_roas' ? 'purchase_revenue' : 'website_purchase_revenue';
    const [rev, spend] = await Promise.all([
      somarSnapshot(campanhaIds, revKey, janelaHoras),
      somarSnapshot(campanhaIds, 'spend', janelaHoras),
    ]);
    return spend > 0 ? rev / spend : null;
  }
  if (metrica === 'ctr') {
    const [clicks, impressions] = await Promise.all([
      somarSnapshot(campanhaIds, 'clicks', janelaHoras),
      somarSnapshot(campanhaIds, 'impressions', janelaHoras),
    ]);
    return impressions > 0 ? (clicks / impressions) * 100 : null;
  }
  if (metrica === 'cpm') {
    const [spend, impressions] = await Promise.all([
      somarSnapshot(campanhaIds, 'spend', janelaHoras),
      somarSnapshot(campanhaIds, 'impressions', janelaHoras),
    ]);
    return impressions > 0 ? (spend / impressions) * 1000 : null;
  }
  if (metrica === 'cpc') {
    const [spend, clicks] = await Promise.all([
      somarSnapshot(campanhaIds, 'spend', janelaHoras),
      somarSnapshot(campanhaIds, 'clicks', janelaHoras),
    ]);
    return clicks > 0 ? spend / clicks : null;
  }
  return somarSnapshot(campanhaIds, metrica, janelaHoras);
}

function formatarValorMeta(valor, metrica) {
  if (metrica === 'purchase_roas' || metrica === 'website_purchase_roas') return `${valor.toFixed(2)}x`;
  if (metrica === 'ctr') return `${valor.toFixed(2)}%`;
  if (metrica === 'cpm' || metrica === 'cpc') return `R$ ${valor.toFixed(2)}`;
  if (metrica === 'frequency') return `${valor.toFixed(2)}×`;
  return valor.toFixed(0);
}

const NOME_METRICA_META = {
  purchase_roas: 'ROAS de compra',
  website_purchase_roas: 'ROAS de compra (site)',
  ctr: 'CTR',
  cpm: 'CPM',
  cpc: 'CPC',
  frequency: 'Frequência 30d',
  leads: 'Leads',
  conversions: 'Conversões',
  messaging_conversations_started: 'Conversas WPP',
};

export async function verificarMetasPersonalizadas(conta, campanhaIds) {
  const metas = (conta.perfil?.metasPersonalizadas ?? []).filter((m) => m.ativo);
  if (!metas.length || !campanhaIds?.length) return;

  const destinatarios = resolverDestinatarios(conta);
  if (!destinatarios.length) return;

  for (const meta of metas) {
    try {
      const janelaHoras = JANELA_META_HORAS[meta.janela] ?? 168;
      const valor = await calcularValorMetrica(campanhaIds.map(String), meta.metrica, janelaHoras);
      if (valor == null || valor === 0) continue;

      const violou = meta.operador === 'abaixo_de' ? valor > meta.valor : valor < meta.valor;
      if (!violou) continue;

      const chaveAlerta = `meta_personalizada_${meta.metrica}_${meta.operador}_${String(conta._id)}`;
      const desde = new Date(Date.now() - THROTTLE_META_HORAS * 60 * 60 * 1000);
      const jaAvisou = await Notificacao.exists({
        contaId: conta._id,
        tipo: 'alerta_performance',
        canal: 'whatsapp',
        conteudo: new RegExp(chaveAlerta),
        enviadaEm: { $gte: desde },
      });
      if (jaAvisou) continue;

      const nomeMetrica = NOME_METRICA_META[meta.metrica] ?? meta.metrica;
      const valorFmt = formatarValorMeta(valor, meta.metrica);
      const metaFmt = formatarValorMeta(meta.valor, meta.metrica);
      const direcao = meta.operador === 'abaixo_de' ? 'acima de' : 'abaixo de';
      const emoji = meta.operador === 'abaixo_de' ? '📈' : '📉';
      const periodo = JANELA_META_LABEL[meta.janela] ?? meta.janela;

      const mensagem = [
        `${emoji} *Meta não atingida — ${nomeMetrica}*`,
        ``,
        `Conta: *${conta.nome}*`,
        `Período: *${periodo}*`,
        ``,
        `${nomeMetrica}: *${valorFmt}* (está ${direcao} da meta de *${metaFmt}*)`,
        ``,
        `<!-- ${chaveAlerta} -->`,
      ].join('\n');

      let envioStatus = 'enviada';
      try {
        await enviarMensagemWhatsapp(destinatarios, mensagem);
      } catch (e) {
        envioStatus = 'erro';
        logger.error({ msg: 'Falha ao enviar alerta de meta personalizada', conta: conta.nome, metrica: meta.metrica, erro: e.message });
      }

      await Notificacao.create({
        contaId: conta._id,
        tipo: 'alerta_performance',
        canal: 'whatsapp',
        destinatario: destinatarios.join(','),
        conteudo: mensagem,
        enviadaEm: new Date(),
        status: envioStatus,
      });

      logger.info({ msg: 'Alerta de meta personalizada', conta: conta.nome, metrica: meta.metrica, valor, meta: meta.valor, status: envioStatus });
    } catch (erro) {
      logger.warn({ msg: 'Falha ao verificar meta personalizada', conta: conta.nome, metrica: meta.metrica, erro: erro.message });
    }
  }
}

async function verificarZeroResultados(conta, entidade, destinatarios, metricaAlvo) {
  const limiarGasto = conta.configuracoes?.limiarGastoZeroConversoes ?? LIMIAR_GASTO_ZERO_CONVERSOES;

  const frescorCutoff = new Date(Date.now() - FRESCOR_MAX_HORAS * 60 * 60 * 1000);
  const res = await query(
    `SELECT DISTINCT ON (metrica) metrica, valor
     FROM metricas_serie_temporal
     WHERE entidade_id = $1 AND metrica IN ('spend', $2) AND janela_horas = 24
       AND coletada_em >= $3
     ORDER BY metrica, coletada_em DESC`,
    [String(entidade._id), metricaAlvo, frescorCutoff]
  );

  const metricas = Object.fromEntries(res.rows.map((r) => [r.metrica, Number(r.valor)]));
  const spend = metricas.spend ?? 0;

  if (spend < limiarGasto) return;
  // A métrica de resultado precisa estar explicitamente no Postgres (=0) — se não houver
  // linha, não há dado suficiente para alertar (campanha sem rastreamento configurado).
  if (!(metricaAlvo in metricas) || metricas[metricaAlvo] > 0) return;

  const desde = new Date(Date.now() - JANELA_RENOTIFICACAO_HORAS * 60 * 60 * 1000);
  const chaveAlerta = `zero_resultado_${String(entidade._id)}`;
  const jaAvisou = await Notificacao.exists({
    contaId: conta._id,
    tipo: 'alerta_performance',
    canal: 'whatsapp',
    conteudo: new RegExp(chaveAlerta),
    enviadaEm: { $gte: desde },
  });
  if (jaAvisou) return;

  const ROTULO_METRICA = {
    conversions: 'Conversões', leads: 'Leads', messaging_conversations_started: 'Conversas WPP',
  };
  const rotulo = ROTULO_METRICA[metricaAlvo] ?? metricaAlvo;
  const tipoLabel = entidade.tipo === 'campaign' ? 'Campanha' : 'Conjunto';
  const mensagem = [
    `⚠️ *Zero ${rotulo.toLowerCase()} com gasto ativo*`,
    ``,
    `Conta: *${conta.nome}*`,
    `${tipoLabel}: *${entidade.nome}*`,
    `Gasto hoje: *R$ ${spend.toFixed(2)}*`,
    `${rotulo}: *0*`,
    ``,
    `Verifique: rastreamento configurado, evento correto e audiência não saturada.`,
    `<!-- ${chaveAlerta} -->`,
  ].join('\n');

  let envioStatus = 'enviada';
  try {
    await enviarMensagemWhatsapp(destinatarios, mensagem);
  } catch (e) {
    envioStatus = 'erro';
    logger.error({ msg: 'Falha ao enviar alerta de zero resultado', conta: conta.nome, entidade: entidade.nome, metrica: metricaAlvo, erro: e.message });
  }

  await Notificacao.create({
    contaId: conta._id,
    tipo: 'alerta_performance',
    entidadeId: entidade._id,
    canal: 'whatsapp',
    destinatario: destinatarios.join(','),
    conteudo: mensagem,
    enviadaEm: new Date(),
    status: envioStatus,
  });

  logger.info({ msg: 'Alerta de zero resultado', conta: conta.nome, entidade: entidade.nome, metrica: metricaAlvo, spend, status: envioStatus });
}
