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

// Fadiga de criativo: frequência subiu E CTR caiu → criativo saturado
const FADIGA_FREQ_DELTA_MIN = 0.3;       // frequência subiu ao menos +0.3x
const FADIGA_CTR_QUEDA_MIN_PCT = 15;     // CTR caiu ao menos 15% relativo
const FADIGA_FREQ_MINIMA = 1.8;          // só alerta acima de freq 1.8 (ruído em freq baixa)
const FADIGA_RENOTIFICACAO_HORAS = 48;   // sinal mais lento — renotifica a cada 48h

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
 * Detecta fadiga de criativo: frequência subiu E CTR caiu entre hoje e ontem.
 * Compara o último snapshot de 24h de hoje vs. o último de ontem para a entidade.
 * Ambas as condições precisam ocorrer simultaneamente — uma isolada não basta.
 */
async function verificarFadigaCriativo(conta, entidade, destinatarios) {
  const frescorCutoff = new Date(Date.now() - FRESCOR_MAX_HORAS * 60 * 60 * 1000);
  const ontemInicio = new Date(); ontemInicio.setDate(ontemInicio.getDate() - 1); ontemInicio.setHours(0, 0, 0, 0);
  const hojeInicio = new Date(); hojeInicio.setHours(0, 0, 0, 0);

  // Leitura de HOJE (recente)
  const resHoje = await query(
    `SELECT DISTINCT ON (metrica) metrica, valor::float
     FROM metricas_serie_temporal
     WHERE entidade_id = $1 AND janela_horas = 24 AND metrica IN ('frequency', 'ctr')
       AND coletada_em >= $2
     ORDER BY metrica, coletada_em DESC`,
    [String(entidade._id), frescorCutoff]
  );

  // Leitura de ONTEM (último snapshot do dia anterior)
  const resOntem = await query(
    `SELECT DISTINCT ON (metrica) metrica, valor::float
     FROM metricas_serie_temporal
     WHERE entidade_id = $1 AND janela_horas = 24 AND metrica IN ('frequency', 'ctr')
       AND coletada_em >= $2 AND coletada_em < $3
     ORDER BY metrica, coletada_em DESC`,
    [String(entidade._id), ontemInicio, hojeInicio]
  );

  const hoje = Object.fromEntries(resHoje.rows.map((r) => [r.metrica, Number(r.valor)]));
  const ontem = Object.fromEntries(resOntem.rows.map((r) => [r.metrica, Number(r.valor)]));

  if (hoje.frequency == null || ontem.frequency == null) return;
  if (hoje.ctr == null || ontem.ctr == null) return;

  const freqHoje = hoje.frequency;
  const freqOntem = ontem.frequency;
  const ctrHoje = hoje.ctr;
  const ctrOntem = ontem.ctr;

  // Condições: frequência mínima atingida + subiu + CTR caiu
  if (freqHoje < FADIGA_FREQ_MINIMA) return;
  if (freqHoje - freqOntem < FADIGA_FREQ_DELTA_MIN) return;
  if (ctrOntem <= 0) return;
  const quedaCtrPct = ((ctrOntem - ctrHoje) / ctrOntem) * 100;
  if (quedaCtrPct < FADIGA_CTR_QUEDA_MIN_PCT) return;

  // Throttle
  const desde = new Date(Date.now() - FADIGA_RENOTIFICACAO_HORAS * 60 * 60 * 1000);
  const chaveAlerta = `fadiga_criativo_${String(entidade._id)}`;
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
    `Frequência: *${freqOntem.toFixed(2)}×* → *${freqHoje.toFixed(2)}×* (+${(freqHoje - freqOntem).toFixed(2)})`,
    `CTR: *${ctrOntem.toFixed(2)}%* → *${ctrHoje.toFixed(2)}%* (−${quedaCtrPct.toFixed(0)}%)`,
    ``,
    `Frequência subindo enquanto CTR cai indica que a audiência está saturada com o criativo atual.`,
    `Ações sugeridas: criar novas variações de anúncio ou expandir a audiência.`,
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

  logger.info({ msg: 'Alerta de fadiga de criativo', conta: conta.nome, entidade: entidade.nome, freqHoje, ctrHoje, quedaCtrPct: quedaCtrPct.toFixed(1), status: envioStatus });
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
