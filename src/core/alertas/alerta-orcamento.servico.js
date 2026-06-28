/**
 * Verificador de saldo de orçamento — roda a cada hora, sem depender de
 * baseline. Consulta `budget_remaining` diretamente na Meta API e envia
 * alerta WhatsApp quando o saldo está abaixo do limiar configurado.
 *
 * Throttle: não reavisa o mesmo adset em menos de 4h.
 */
import { Conta } from '../../dominio/conta.modelo.js';
import { Entidade } from '../../dominio/entidade.modelo.js';
import { Notificacao } from '../../dominio/notificacao.modelo.js';
import { obterConfiguracaoAdset, obterConfiguracaoCampanha, obterDetalhesContaAnuncio } from '../coleta/meta-api.cliente.js';
import { query } from '../../infra/postgres.js';
// `balance` da Meta API é não-confiável (flutua com créditos/estornos em contas pós-pagas).
// Para problemas de pagamento, usamos exclusivamente account_status.
import { enviarMensagemWhatsapp, resolverDestinatarios } from '../notificacao/enviador-whatsapp.servico.js';
import { config } from '../../config/index.js';
import { logger } from '../../infra/logger.js';

const LIMIAR_PCT_PADRAO = 0.20;   // 20% restante do orçamento diário
const LIMIAR_REAIS_PADRAO = 30;   // R$30 restante (em qualquer cenário)
const JANELA_RENOTIFICACAO_HORAS = 4;        // alertas transitórios (saldo baixo)
const JANELA_RENOTIFICACAO_PERSISTENTE = 24; // alertas persistentes (zerado, bloqueado)

// Aviso preventivo de esgotamento de saldo pré-pago por tempo de autonomia (runway),
// não por valor fixo em R$ — assim a antecedência é consistente entre contas que
// gastam pouco ou muito.
const RUNWAY_CRITICO_HORAS = 6;            // saldo acaba em < 6h → alerta urgente
const RUNWAY_ACABANDO_HORAS = 24;          // saldo acaba em < 24h → alerta preventivo
const JANELA_RENOTIFICACAO_CRITICO = 4;    // renotifica "crítico" a cada 4h
const JANELA_RENOTIFICACAO_ACABANDO = 12;  // renotifica "vai acabar" a cada 12h

// Guarda anti-falso-positivo de runway: só alerta "vai acabar/crítico" se o saldo
// realmente caiu desde a última leitura. Se ficou parado (campanha ACTIVE mas sem
// entrega — ex.: agendada para não rodar no fim de semana), o dinheiro não está
// saindo e não há por que avisar, mesmo que a projeção pelo orçamento diga o contrário.
const LEITURA_RECENTE_MAX_HORAS = 3;  // só compara saldo se a leitura anterior é recente
const QUEDA_MINIMA_REAIS = 0.50;      // abaixo disso considera-se "saldo parado" (ruído)

// account_status da Meta API que indicam problema de pagamento/bloqueio
const STATUS_PROBLEMA = {
  2: 'desativada',
  3: 'inadimplente (pagamento pendente)',
  7: 'em revisão pela Meta',
  8: 'em processo de encerramento',
  9: 'em período de carência (pagamento atrasado)',
  100: 'em revisão de risco',
  101: 'encerrada',
};

export async function verificarOrcamentosContas() {
  const contas = await Conta.find({ ativo: true });

  for (const conta of contas) {
    try {
      await verificarOrcamentosConta(conta);
    } catch (erro) {
      logger.error({ msg: 'Falha ao verificar orçamentos da conta', contaId: String(conta._id), erro: erro.message });
    }
  }
}

async function verificarOrcamentosConta(conta) {
  const token = conta.metaConfig?.systemUserToken || undefined;

  // 1. Verifica status e saldo pré-pago de cada conta de anúncio
  for (const contaAnuncioId of (conta.metaConfig?.contasAnuncioIds ?? [])) {
    try {
      await avaliarStatusContaAnuncio(conta, contaAnuncioId, token);
    } catch (erro) {
      logger.warn({ msg: 'Falha ao verificar status da conta de anúncio', contaAnuncioId, erro: erro.message });
    }
  }

  // 2. Verifica orçamento restante de cada adset ativo
  // Contas pré-pagas: o saldo relevante é o da conta (spend_cap), não o orçamento
  // diário do adset — que vai a zero todo dia de forma normal e esperada.
  if (conta.configuracoes?.prepago) return;

  const adsets = await Entidade.find({
    contaId: conta._id,
    tipo: 'adset',
    status: 'ACTIVE',
    'configuracoes.monitorada': true,
  });

  for (const adset of adsets) {
    try {
      await avaliarSaldoAdset(conta, adset, token);
    } catch (erro) {
      logger.warn({ msg: 'Falha ao verificar saldo do adset', adsetId: String(adset._id), nome: adset.nome, erro: erro.message });
    }
  }
}

async function avaliarStatusContaAnuncio(conta, contaAnuncioId, token) {
  const detalhes = await obterDetalhesContaAnuncio(contaAnuncioId, token);
  const status = Number(detalhes.account_status);
  const labelProblema = STATUS_PROBLEMA[status];
  const destinatarios = resolverDestinatarios(conta);
  if (!destinatarios.length) return;

  // Conta com status problemático
  if (labelProblema) {
    const desde = new Date(Date.now() - JANELA_RENOTIFICACAO_PERSISTENTE * 60 * 60 * 1000);
    const chaveAlerta = `alerta_conta_status_${contaAnuncioId}`;
    const jaAvisou = await Notificacao.exists({
      contaId: conta._id, tipo: 'alerta_orcamento', canal: 'whatsapp',
      conteudo: new RegExp(chaveAlerta), enviadaEm: { $gte: desde },
    });
    if (!jaAvisou) {
      const mensagem = [
        `🚨 *Conta de anúncio bloqueada — ${conta.nome}*`,
        ``, `Conta: \`${contaAnuncioId}\``, `Status: *${labelProblema}*`, ``,
        `Verifique o gerenciador de anúncios — as campanhas podem ter parado de entregar.`,
        `<!-- ${chaveAlerta} -->`,
      ].join('\n');
      let envioStatus = 'enviada';
      try { await enviarMensagemWhatsapp(destinatarios, mensagem); } catch (e) { envioStatus = 'erro'; logger.error({ msg: 'Falha ao enviar alerta de conta bloqueada', conta: conta.nome, erro: e.message }); }
      await Notificacao.create({ contaId: conta._id, tipo: 'alerta_orcamento', canal: 'whatsapp', destinatario: destinatarios.join(','), conteudo: mensagem, enviadaEm: new Date(), status: envioStatus });
      logger.info({ msg: 'Alerta de conta bloqueada enviado', conta: conta.nome, contaAnuncioId, status: labelProblema });
    }
    // Reflete o bloqueio no dashboard (conta pré-paga), com o motivo (status) legível
    if (conta.configuracoes?.prepago) {
      await persistirSnapshotSaldo(conta._id, contaAnuncioId, { nivel: 'bloqueado', motivoBloqueio: labelProblema });
    }
    return;
  }

  // Saldo pré-pago via funding_source_details (valor REAL carregado na conta),
  // com fallback para spend_cap - amount_spent. (só para contas marcadas como prepago)
  if (conta.configuracoes?.prepago) {
    const snap = await computarSaldoPrepago(conta, contaAnuncioId, detalhes, token);
    if (!snap) return; // saldo indeterminável — não é pré-pago real
    const { saldoReais: saldoEstimadoReais, ritmoHora, runwayHoras, nivel } = snap;

    // Persiste o snapshot para o dashboard ler sem chamar a Meta API
    await persistirSnapshotSaldo(conta._id, contaAnuncioId, snap);

    // 1. Saldo zerado — entrega interrompida (chave própria, 24h)
    if (nivel === 'zerado') {
      const janelaSaldo = new Date(Date.now() - JANELA_RENOTIFICACAO_PERSISTENTE * 60 * 60 * 1000);
      const chaveZerado = `saldo_prepago_zerado_${contaAnuncioId}`;
      const jaAvisouZerado = await Notificacao.exists({
        contaId: conta._id, tipo: 'alerta_orcamento', canal: 'whatsapp',
        conteudo: new RegExp(chaveZerado), enviadaEm: { $gte: janelaSaldo },
      });
      if (!jaAvisouZerado) {
        const mensagem = [
          `🔴 *Saldo zerado — entrega interrompida — ${conta.nome}*`,
          ``, `Conta: \`${contaAnuncioId}\``,
          `Saldo estimado: *R$ 0,00*`,
          ``,
          `As campanhas pararam de entregar por falta de saldo pré-pago. Recarregue para retomar.`,
          `<!-- ${chaveZerado} -->`,
        ].join('\n');
        let envioStatus = 'enviada';
        try { await enviarMensagemWhatsapp(destinatarios, mensagem); } catch (e) { envioStatus = 'erro'; logger.error({ msg: 'Falha ao enviar alerta de saldo zerado', conta: conta.nome, destinatario: destinatarios.join(','), erro: e.message }); }
        await Notificacao.create({ contaId: conta._id, tipo: 'alerta_orcamento', canal: 'whatsapp', destinatario: destinatarios.join(','), conteudo: mensagem, enviadaEm: new Date(), status: envioStatus });
        logger.info({ msg: 'Alerta de saldo zerado enviado', conta: conta.nome, contaAnuncioId, status: envioStatus });
      }
      return;
    }

    // 2. Saldo confortável — snapshot já persistido, nada a alertar
    if (nivel === 'ok') return;

    // 2b. Saldo parado — não está caindo desde a última leitura. Suprime o alerta
    // de runway (mantém o snapshot do dashboard com a projeção real). Evita o
    // falso positivo de campanha agendada para não rodar no fim de semana.
    if (!saldoEstaCaindo(conta, contaAnuncioId, saldoEstimadoReais)) {
      logger.info({ msg: 'Alerta de saldo suprimido — saldo estável (não está caindo)', conta: conta.nome, contaAnuncioId, nivel, saldoEstimadoReais });
      return;
    }

    // 3. Projeção de esgotamento (runway): avisa com antecedência por tempo de autonomia
    const janelaHoras = nivel === 'critico' ? JANELA_RENOTIFICACAO_CRITICO : JANELA_RENOTIFICACAO_ACABANDO;
    const chaveAlerta = `saldo_prepago_${nivel}_${contaAnuncioId}`;
    const desde = new Date(Date.now() - janelaHoras * 60 * 60 * 1000);
    const jaAvisou = await Notificacao.exists({
      contaId: conta._id, tipo: 'alerta_orcamento', canal: 'whatsapp',
      conteudo: new RegExp(chaveAlerta), enviadaEm: { $gte: desde },
    });
    if (jaAvisou) return;

    const linhaRitmo = (ritmoHora && runwayHoras != null)
      ? `\nRitmo atual: *R$ ${ritmoHora.toFixed(2)}/h* → acaba em ~*${formatarRunway(runwayHoras)}*`
      : '';
    const titulo = nivel === 'critico'
      ? `🟠 *Saldo crítico — ${conta.nome}*`
      : `🟡 *Saldo vai acabar — ${conta.nome}*`;
    const rodape = nivel === 'critico'
      ? `Recarregue agora para não interromper as campanhas.`
      : `Programe a recarga para evitar interrupção das campanhas.`;

    const mensagem = [
      titulo,
      ``, `Conta: \`${contaAnuncioId}\``,
      `Saldo estimado: *R$ ${saldoEstimadoReais.toFixed(2)}*${linhaRitmo}`,
      ``,
      rodape,
      `<!-- ${chaveAlerta} -->`,
    ].join('\n');
    let envioStatus = 'enviada';
    try { await enviarMensagemWhatsapp(destinatarios, mensagem); } catch (e) { envioStatus = 'erro'; logger.error({ msg: 'Falha ao enviar alerta de saldo pré-pago', conta: conta.nome, destinatario: destinatarios.join(','), erro: e.message }); }
    await Notificacao.create({ contaId: conta._id, tipo: 'alerta_orcamento', canal: 'whatsapp', destinatario: destinatarios.join(','), conteudo: mensagem, enviadaEm: new Date(), status: envioStatus });
    logger.info({ msg: 'Alerta de saldo pré-pago enviado', conta: conta.nome, contaAnuncioId, nivel, saldoEstimadoReais, runwayHoras, status: envioStatus });
  }
}

/**
 * Estima o gasto diário médio da conta (ontem) para calcular horas restantes de saldo.
 * Usa o valor máximo de `spend` (24h) coletado ontem para cada CAMPANHA da conta.
 * IMPORTANTE: agrega apenas no nível de campanha — somar campaign+adset+ad contaria
 * o mesmo gasto 2-3x (cada nível já totaliza o mesmo dinheiro).
 * Retorna null se não houver dados suficientes.
 */
async function calcularGastoDiarioOntem(contaId, contaAnuncioId) {
  const filtro = { contaId, tipo: 'campaign' };
  if (contaAnuncioId) filtro['hierarquia.contaAnuncioId'] = contaAnuncioId;
  const entidades = await Entidade.find(filtro).select('_id').lean();
  if (!entidades.length) return null;

  const entidadeIds = entidades.map((e) => String(e._id));
  const ontemFim = new Date();
  ontemFim.setUTCHours(0, 0, 0, 0);
  const ontemInicio = new Date(ontemFim);
  ontemInicio.setDate(ontemInicio.getDate() - 1);

  const res = await query(
    `SELECT COALESCE(SUM(max_gasto), 0)::float AS gasto_total
     FROM (
       SELECT entidade_id, MAX(valor) AS max_gasto
       FROM metricas_serie_temporal
       WHERE entidade_id = ANY($1) AND metrica = 'spend' AND janela_horas = 24
         AND coletada_em >= $2 AND coletada_em < $3
       GROUP BY entidade_id
     ) e`,
    [entidadeIds, ontemInicio, ontemFim]
  );

  const gasto = Number(res.rows[0]?.gasto_total ?? 0);
  return gasto > 0 ? gasto : null;
}

/**
 * Estima o ritmo de gasto por hora (R$/h) de uma conta pré-paga, usado para
 * projetar o tempo de autonomia (runway) do saldo.
 * Usa a média do gasto diário dos últimos 3 dias completos (mais estável que
 * só ontem); se não houver histórico, cai para o gasto de ontem.
 * Retorna null se não houver dados suficientes.
 */
async function estimarRitmoHoraPrepago(contaId, contaAnuncioId) {
  const filtro = { contaId, tipo: 'campaign' };
  if (contaAnuncioId) filtro['hierarquia.contaAnuncioId'] = contaAnuncioId;
  const entidades = await Entidade.find(filtro).select('_id').lean();
  if (!entidades.length) return null;

  const entidadeIds = entidades.map((e) => String(e._id));
  const hojeInicio = new Date();
  hojeInicio.setUTCHours(0, 0, 0, 0);
  const tresDiasAtras = new Date(hojeInicio);
  tresDiasAtras.setDate(tresDiasAtras.getDate() - 3);

  // Média do gasto diário (soma do máximo por entidade em cada dia, depois média entre dias)
  const res = await query(
    `SELECT AVG(dia_total)::float AS media_diaria
       FROM (
         SELECT dia, SUM(max_gasto) AS dia_total
         FROM (
           SELECT date_trunc('day', coletada_em) AS dia, entidade_id, MAX(valor) AS max_gasto
           FROM metricas_serie_temporal
           WHERE entidade_id = ANY($1) AND metrica = 'spend' AND janela_horas = 24
             AND coletada_em >= $2 AND coletada_em < $3
           GROUP BY dia, entidade_id
         ) por_entidade
         GROUP BY dia
       ) por_dia`,
    [entidadeIds, tresDiasAtras, hojeInicio]
  );

  const mediaDiaria = Number(res.rows[0]?.media_diaria ?? 0);
  if (mediaDiaria > 0) return mediaDiaria / 24;

  // Fallback: gasto de ontem
  const gastoOntem = await calcularGastoDiarioOntem(contaId, contaAnuncioId);
  return gastoOntem ? gastoOntem / 24 : null;
}

/**
 * Extrai o saldo pré-pago disponível (em reais) de `funding_source_details`.
 * Esse é o valor REAL carregado na conta — diferente de `spend_cap`, que é um
 * limite de gasto e não o saldo. `display_string` vem no formato pt-BR, ex.:
 * "Saldo disponível (R$158,46 BRL)". Faz parse do número pt-BR ("1.234,56").
 * Fallback: spend_cap - amount_spent (em centavos). Retorna null se indeterminável.
 */
function extrairSaldoPrepago(detalhes) {
  const displayString = detalhes?.funding_source_details?.display_string;
  if (displayString) {
    const m = String(displayString).match(/(\d[\d.]*,\d{2})/);
    if (m) {
      const valor = Number(m[1].replace(/\./g, '').replace(',', '.'));
      if (Number.isFinite(valor)) return valor;
    }
  }
  // Fallback legado: spend_cap - amount_spent (centavos → reais)
  const spendCap = Number(detalhes?.spend_cap ?? 0);
  const amountSpent = Number(detalhes?.amount_spent ?? 0);
  if (spendCap > 0) return (spendCap - amountSpent) / 100;
  return null;
}

/**
 * Estima o gasto diário PREVISTO (R$/dia) de uma conta pré-paga somando os
 * orçamentos diários das entidades ATIVAS — base mais estável e previsível que o
 * gasto medido para projetar o runway. Campanhas CBO: usa o daily_budget da
 * campanha; ABO: soma o daily_budget dos adsets ativos da campanha.
 * Considera apenas entidades da conta de anúncio informada.
 * Retorna null se não conseguir determinar (cai para o gasto medido).
 */
async function estimarOrcamentoDiarioPrevisto(contaId, contaAnuncioId, token) {
  const campanhas = await Entidade.find({
    contaId, tipo: 'campaign', status: 'ACTIVE',
    'hierarquia.contaAnuncioId': contaAnuncioId,
  }).select('metaId').lean();
  if (!campanhas.length) return null;

  let totalCentavos = 0;
  let temDado = false;

  for (const campanha of campanhas) {
    try {
      const cfg = await obterConfiguracaoCampanha(campanha.metaId, token);
      if (cfg.daily_budget) { // CBO — orçamento mora na campanha
        totalCentavos += Number(cfg.daily_budget);
        temDado = true;
        continue;
      }
      // ABO — soma o orçamento diário dos adsets ativos da campanha
      const adsets = await Entidade.find({
        contaId, tipo: 'adset', status: 'ACTIVE',
        'hierarquia.campanhaId': campanha.metaId,
      }).select('metaId').lean();
      for (const adset of adsets) {
        const cfgAd = await obterConfiguracaoAdset(adset.metaId, token);
        if (cfgAd.daily_budget) { totalCentavos += Number(cfgAd.daily_budget); temDado = true; }
      }
    } catch (e) {
      logger.warn({ msg: 'Falha ao obter orçamento diário previsto', campanhaId: campanha.metaId, erro: e.message });
    }
  }

  if (!temDado || totalCentavos <= 0) return null;
  return totalCentavos / 100; // centavos → reais/dia
}

/**
 * Calcula (SEM notificar) o snapshot de saldo pré-pago de uma conta de anúncio
 * a partir dos detalhes já lidos da Meta. Fonte única da matemática de saldo/runway,
 * usada tanto pelo alerta horário quanto pelo backfill do dashboard.
 * @returns {Promise<{saldoReais, ritmoHora, runwayHoras, nivel}|null>} ou null se não for pré-pago real
 */
async function computarSaldoPrepago(conta, contaAnuncioId, detalhes, token) {
  const saldoReais = extrairSaldoPrepago(detalhes);
  if (saldoReais == null) return null;

  // Ritmo de gasto (R$/h): prioriza o orçamento diário previsto das campanhas/adsets
  // ativos (base estável e previsível); cai para o gasto medido (nível campanha) se
  // não houver orçamento determinável.
  const orcamentoDiarioPrevisto = await estimarOrcamentoDiarioPrevisto(conta._id, contaAnuncioId, token);
  const ritmoHora = orcamentoDiarioPrevisto != null
    ? orcamentoDiarioPrevisto / 24
    : await estimarRitmoHoraPrepago(conta._id, contaAnuncioId);
  const limiarReais = conta.configuracoes?.limiarAlertaSaldoReais ?? 50;
  const runwayHoras = (ritmoHora && ritmoHora > 0 && saldoReais > 0)
    ? saldoReais / ritmoHora
    : null;

  let nivel;
  if (saldoReais <= 0) nivel = 'zerado';
  else if (runwayHoras != null && runwayHoras < RUNWAY_CRITICO_HORAS) nivel = 'critico';
  else if (runwayHoras != null && runwayHoras < RUNWAY_ACABANDO_HORAS) nivel = 'acabando';
  else if (runwayHoras == null && saldoReais < limiarReais) nivel = 'acabando';
  else nivel = 'ok';

  return { saldoReais, ritmoHora: ritmoHora ?? null, runwayHoras, nivel };
}

/**
 * Recalcula e persiste o snapshot de saldo de TODAS as contas pré-pagas SEM enviar
 * nenhuma notificação. Usado para corrigir/atualizar os valores exibidos no dashboard
 * após mudanças na lógica de saldo/runway. Retorna um resumo por conta de anúncio.
 */
export async function recalcularSnapshotsSaldoPrepago() {
  const contas = await Conta.find({ ativo: true, 'configuracoes.prepago': true });
  const resultado = [];

  for (const conta of contas) {
    const token = conta.metaConfig?.systemUserToken || undefined;
    for (const contaAnuncioId of (conta.metaConfig?.contasAnuncioIds ?? [])) {
      try {
        const detalhes = await obterDetalhesContaAnuncio(contaAnuncioId, token);
        const labelProblema = STATUS_PROBLEMA[Number(detalhes.account_status)];

        const snap = labelProblema
          ? { nivel: 'bloqueado', motivoBloqueio: labelProblema }
          : await computarSaldoPrepago(conta, contaAnuncioId, detalhes, token);

        if (!snap) {
          resultado.push({ conta: conta.nome, contaAnuncioId, ignorado: 'saldo indeterminável' });
          continue;
        }
        await persistirSnapshotSaldo(conta._id, contaAnuncioId, snap);
        resultado.push({ conta: conta.nome, contaAnuncioId, ...snap });
      } catch (e) {
        logger.warn({ msg: 'Falha ao recalcular snapshot de saldo', conta: conta.nome, contaAnuncioId, erro: e.message });
        resultado.push({ conta: conta.nome, contaAnuncioId, erro: e.message });
      }
    }
  }

  return resultado;
}

/**
 * Persiste/atualiza o snapshot de saldo pré-pago de uma conta de anúncio no
 * documento da Conta, para o dashboard ler sem chamar a Meta API.
 */
async function persistirSnapshotSaldo(contaId, contaAnuncioId, dados) {
  const snapshot = { contaAnuncioId, atualizadoEm: new Date(), saldoReais: null, ritmoHora: null, runwayHoras: null, nivel: null, motivoBloqueio: null, ...dados };
  const r = await Conta.updateOne(
    { _id: contaId, 'saldoPrepago.contaAnuncioId': contaAnuncioId },
    { $set: { 'saldoPrepago.$': snapshot } }
  );
  if (r.matchedCount === 0) {
    await Conta.updateOne({ _id: contaId }, { $push: { saldoPrepago: snapshot } });
  }
}

/** Formata horas de autonomia em string amigável ("5h" ou "1d 4h"). */
function formatarRunway(horas) {
  const h = Math.max(0, Math.round(horas));
  if (h < 24) return `${h}h`;
  const dias = Math.floor(h / 24);
  const resto = h % 24;
  return resto > 0 ? `${dias}d ${resto}h` : `${dias}d`;
}

/**
 * Decide se o saldo pré-pago está de fato caindo entre leituras consecutivas.
 * Compara o saldo atual com o último snapshot persistido em `conta.saldoPrepago`
 * (ainda não atualizado em memória neste ponto do ciclo). Retorna false quando o
 * saldo ficou estável ou subiu — caso típico de campanha ACTIVE que não entrega
 * (agendada para não rodar no fim de semana): a projeção de runway diz que "vai
 * acabar", mas o dinheiro está parado e não há por que alertar.
 * Em caso de dúvida (sem leitura anterior recente) retorna true — não suprime.
 */
function saldoEstaCaindo(conta, contaAnuncioId, saldoAtual) {
  const anterior = (conta.saldoPrepago ?? []).find(
    (s) => s.contaAnuncioId === contaAnuncioId && s.saldoReais != null && s.atualizadoEm
  );
  if (!anterior) return true; // sem histórico — não dá pra afirmar que está parado
  const horasDesde = (Date.now() - new Date(anterior.atualizadoEm).getTime()) / 36e5;
  if (!(horasDesde > 0 && horasDesde <= LEITURA_RECENTE_MAX_HORAS)) return true; // leitura velha — cadência não confiável
  const queda = Number(anterior.saldoReais) - Number(saldoAtual);
  return queda > QUEDA_MINIMA_REAIS;
}

async function avaliarSaldoAdset(conta, adset, token) {
  const { budgetRemaining, budgetTotal, origemOrcamento } = await obterSaldo(adset, token);

  if (budgetRemaining === null || budgetTotal === null || budgetTotal === 0) return;

  const limiarPct = conta.configuracoes?.limiarAlertaOrcamentoPct ?? LIMIAR_PCT_PADRAO;
  const limiarReais = conta.configuracoes?.limiarAlertaOrcamentoReais ?? LIMIAR_REAIS_PADRAO;
  const pctRestante = budgetRemaining / budgetTotal;

  // Alerta apenas quando AMBOS estão abaixo do limiar — evita falso positivo
  // em orçamentos pequenos onde o absoluto em R$ é sempre menor que o limiar.
  if (pctRestante >= limiarPct || budgetRemaining >= limiarReais) return;

  // Throttle — não reavisa em menos de JANELA_RENOTIFICACAO_HORAS
  const desde = new Date(Date.now() - JANELA_RENOTIFICACAO_HORAS * 60 * 60 * 1000);
  const jaAvisou = await Notificacao.exists({
    contaId: conta._id,
    tipo: 'alerta_orcamento',
    entidadeId: adset._id,
    enviadaEm: { $gte: desde },
    status: 'enviada',
  });
  if (jaAvisou) return;

  const destinatarios = resolverDestinatarios(conta);
  if (!destinatarios.length) {
    logger.warn({ msg: 'Alerta de saldo sem destinatário configurado', contaId: String(conta._id) });
    return;
  }

  const pctStr = (pctRestante * 100).toFixed(0);
  const restanteStr = `R$ ${budgetRemaining.toFixed(2)}`;
  const totalStr = `R$ ${budgetTotal.toFixed(2)}`;

  const mensagem = [
    `⚠️ *Saldo baixo — ${conta.nome}*`,
    ``,
    `Adset: *${adset.nome}*`,
    `Saldo restante: *${restanteStr}* de ${totalStr} (${pctStr}%)`,
    `Orçamento: ${origemOrcamento}`,
    ``,
    `Recarregue o orçamento para evitar interrupção da entrega.`,
  ].join('\n');

  let status = 'enviada';
  try {
    await enviarMensagemWhatsapp(destinatarios, mensagem);
  } catch (erro) {
    status = 'erro';
    logger.error({ msg: 'Falha ao enviar alerta de saldo WhatsApp', adsetId: String(adset._id), erro: erro.message });
  }

  await Notificacao.create({
    contaId: conta._id,
    tipo: 'alerta_orcamento',
    entidadeId: adset._id,
    canal: 'whatsapp',
    destinatario: destinatarios.join(','),
    conteudo: mensagem,
    enviadaEm: new Date(),
    status,
  });

  logger.info({
    msg: 'Alerta de saldo enviado',
    conta: conta.nome,
    adset: adset.nome,
    budgetRemaining,
    pctRestante: pctStr + '%',
    status,
  });
}

async function obterSaldo(adset, token) {
  // Tenta orçamento próprio do adset
  const cfgAdset = await obterConfiguracaoAdset(adset.metaId, token);
  const temOrcamentoAdset = cfgAdset.daily_budget || cfgAdset.lifetime_budget;

  if (temOrcamentoAdset && cfgAdset.budget_remaining != null) {
    return {
      budgetRemaining: Number(cfgAdset.budget_remaining) / 100,
      budgetTotal: Number(cfgAdset.daily_budget || cfgAdset.lifetime_budget) / 100,
      origemOrcamento: cfgAdset.daily_budget ? 'diário (adset)' : 'total (adset)',
    };
  }

  // CBO — orçamento está na campanha
  const campanhaId = adset.hierarquia?.campanhaId;
  if (!campanhaId) return { budgetRemaining: null, budgetTotal: null, origemOrcamento: null };

  const cfgCampanha = await obterConfiguracaoCampanha(campanhaId, token);
  if (cfgCampanha.budget_remaining == null) return { budgetRemaining: null, budgetTotal: null, origemOrcamento: null };

  return {
    budgetRemaining: Number(cfgCampanha.budget_remaining) / 100,
    budgetTotal: Number(cfgCampanha.daily_budget || cfgCampanha.lifetime_budget) / 100,
    origemOrcamento: cfgCampanha.daily_budget ? 'diário (campanha CBO)' : 'total (campanha CBO)',
  };
}
