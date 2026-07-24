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
import { buscarGastoMes } from '../analise/veredito.servico.js';
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
    try {
      await verificarMetaMensalConta(conta);
    } catch (erro) {
      logger.error({ msg: 'Falha ao verificar meta mensal da conta', contaId: String(conta._id), erro: erro.message });
    }
    try {
      await verificarSpikeDiarioConta(conta);
    } catch (erro) {
      logger.error({ msg: 'Falha ao verificar spike de gasto', contaId: String(conta._id), erro: erro.message });
    }
    try {
      await verificarRitmoMensalBaixo(conta);
    } catch (erro) {
      logger.error({ msg: 'Falha ao verificar ritmo mensal baixo', contaId: String(conta._id), erro: erro.message });
    }
  }
}

const THRESHOLD_META_MENSAL = 0.10;       // alerta quando projeção > meta + 10%
const JANELA_RENOTIFICACAO_META = 24;     // renotifica no máximo 1× por dia

// ── Spike e sub-utilização de gasto ─────────────────────────────────────────
const SPIKE_MULTIPLO_ALTO  = 2.5;   // hoje > 2.5× a média → spike de gasto
const SPIKE_MULTIPLO_BAIXO = 0.30;  // hoje < 30% da média → gasto muito abaixo
const SPIKE_DIAS_MINIMOS   = 3;     // mínimo de dias com gasto na janela de 7d
const SPIKE_DIAS_ATIVOS_3D = 2;     // mínimo de dias ativos nos últimos 3 (evita falso após pausa)
const SPIKE_HORA_BRT_MIN   = 18;    // só alerta spike baixo após 18h BRT
const SPIKE_THROTTLE_HORAS = 24;    // uma notificação por direção por dia
const RITMO_LIMIAR_PCT     = 0.50;  // ritmo < 50% do esperado → sub-utilização
const RITMO_DIA_MINIMO     = 8;     // só verifica após o 8º dia do mês

/**
 * Detecta spikes de gasto diário: acima (>2.5×) ou abaixo (<30%) da média 7d.
 * Só dispara se a conta estava ativa nos últimos 3 dias (≥2 dias com gasto),
 * evitando falso positivo ao reativar uma campanha pausada.
 */
async function verificarSpikeDiarioConta(conta) {
  const meta = conta.perfil?.investimentoMensalPlanejado;
  // Sem meta cadastrada não temos referência de "normal" para sub-utilização,
  // mas ainda verificamos spike alto (pode gastar demais sem meta também).
  const destinatarios = resolverDestinatarios(conta);
  if (!destinatarios.length) return;

  const campanhas = await Entidade.find({
    contaId: conta._id, tipo: 'campaign', 'configuracoes.monitorada': true,
  }).select('_id').lean();
  if (!campanhas.length) return;
  const ids = campanhas.map((c) => String(c._id));

  // 1. Verificar atividade recente: quantos dos últimos 3 dias (excl. hoje) tiveram gasto > R$1
  const hoje0h = new Date(); hoje0h.setHours(0, 0, 0, 0);
  const ha3dias = new Date(hoje0h); ha3dias.setDate(ha3dias.getDate() - 3);

  const res3d = await query(
    `SELECT COUNT(DISTINCT date_trunc('day', coletada_em))::int AS dias_ativos
     FROM metricas_serie_temporal
     WHERE entidade_id = ANY($1) AND metrica = 'spend' AND janela_horas = 24
       AND valor::float > 1 AND coletada_em >= $2 AND coletada_em < $3`,
    [ids, ha3dias, hoje0h]
  );
  const diasAtivos3d = Number(res3d.rows[0]?.dias_ativos ?? 0);
  if (diasAtivos3d < SPIKE_DIAS_ATIVOS_3D) return; // foi pausada recentemente — pula

  // 2. Média diária dos últimos 7 dias (excl. hoje), usando só dias com gasto
  const ha7dias = new Date(hoje0h); ha7dias.setDate(ha7dias.getDate() - 7);

  const res7d = await query(
    `SELECT AVG(dia_total)::float AS media_diaria, COUNT(*)::int AS dias_com_gasto
     FROM (
       SELECT dia, SUM(max_por_entidade) AS dia_total
       FROM (
         SELECT date_trunc('day', coletada_em) AS dia,
                entidade_id,
                MAX(valor::float) AS max_por_entidade
         FROM metricas_serie_temporal
         WHERE entidade_id = ANY($1) AND metrica = 'spend' AND janela_horas = 24
           AND coletada_em >= $2 AND coletada_em < $3
         GROUP BY date_trunc('day', coletada_em), entidade_id
       ) por_entidade
       WHERE max_por_entidade > 0
       GROUP BY dia
     ) diarios`,
    [ids, ha7dias, hoje0h]
  );

  const mediaDiaria = Number(res7d.rows[0]?.media_diaria ?? 0);
  const diasComGasto = Number(res7d.rows[0]?.dias_com_gasto ?? 0);
  if (mediaDiaria <= 0 || diasComGasto < SPIKE_DIAS_MINIMOS) return;

  // 3. Gasto de hoje (último snapshot 24h frescos)
  const frescorCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const resHoje = await query(
    `SELECT COALESCE(SUM(s), 0)::float AS gasto FROM (
       SELECT DISTINCT ON (entidade_id) valor::float AS s
       FROM metricas_serie_temporal
       WHERE entidade_id = ANY($1) AND metrica = 'spend' AND janela_horas = 24
         AND coletada_em >= $2
       ORDER BY entidade_id, coletada_em DESC
     ) x`,
    [ids, frescorCutoff]
  );
  const gastoHoje = Number(resHoje.rows[0]?.gasto ?? 0);
  if (gastoHoje === 0) return; // sem dados do dia ainda

  const fmtR = (v) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // 4. Spike ALTO
  if (gastoHoje > mediaDiaria * SPIKE_MULTIPLO_ALTO) {
    const chave = `spike_alto_${conta._id}`;
    const desde = new Date(Date.now() - SPIKE_THROTTLE_HORAS * 60 * 60 * 1000);
    const jaAvisou = await Notificacao.exists({
      contaId: conta._id, tipo: 'alerta_orcamento', canal: 'whatsapp',
      conteudo: new RegExp(chave.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      enviadaEm: { $gte: desde },
    });
    if (!jaAvisou) {
      const multiplo = (gastoHoje / mediaDiaria).toFixed(1);
      const mensagem = [
        `📈 *Gasto acima do normal — ${conta.nome}*`,
        ``,
        `Gasto hoje: *${fmtR(gastoHoje)}*`,
        `Média diária (7d): *${fmtR(mediaDiaria)}* → hoje é *${multiplo}×* acima`,
        ``,
        `Verifique se houve expansão de orçamento não planejada ou leilão anômalo.`,
        `<!-- ${chave} -->`,
      ].join('\n');
      let status = 'enviada';
      try { await enviarMensagemWhatsapp(destinatarios, mensagem); } catch (e) { status = 'erro'; logger.error({ msg: 'Falha ao enviar spike alto', conta: conta.nome, erro: e.message }); }
      await Notificacao.create({ contaId: conta._id, tipo: 'alerta_orcamento', canal: 'whatsapp', destinatario: destinatarios.join(','), conteudo: mensagem, enviadaEm: new Date(), status });
      logger.info({ msg: 'Alerta spike alto', conta: conta.nome, gastoHoje, mediaDiaria, multiplo, status });
    }
  }

  // 5. Spike BAIXO — só após 18h BRT para dar tempo ao dia
  const horaBRT = (new Date().getUTCHours() - 3 + 24) % 24;
  if (gastoHoje < mediaDiaria * SPIKE_MULTIPLO_BAIXO && horaBRT >= SPIKE_HORA_BRT_MIN) {
    const chave = `spike_baixo_${conta._id}`;
    const desde = new Date(Date.now() - SPIKE_THROTTLE_HORAS * 60 * 60 * 1000);
    const jaAvisou = await Notificacao.exists({
      contaId: conta._id, tipo: 'alerta_orcamento', canal: 'whatsapp',
      conteudo: new RegExp(chave.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      enviadaEm: { $gte: desde },
    });
    if (!jaAvisou) {
      const pct = Math.round((gastoHoje / mediaDiaria) * 100);
      const mensagem = [
        `📉 *Gasto muito abaixo do normal — ${conta.nome}*`,
        ``,
        `Gasto hoje: *${fmtR(gastoHoje)}* (${pct}% da média)`,
        `Média diária (7d): *${fmtR(mediaDiaria)}*`,
        ``,
        `Verifique se campanhas estão ativas e sem problemas de entrega.`,
        `<!-- ${chave} -->`,
      ].join('\n');
      let status = 'enviada';
      try { await enviarMensagemWhatsapp(destinatarios, mensagem); } catch (e) { status = 'erro'; logger.error({ msg: 'Falha ao enviar spike baixo', conta: conta.nome, erro: e.message }); }
      await Notificacao.create({ contaId: conta._id, tipo: 'alerta_orcamento', canal: 'whatsapp', destinatario: destinatarios.join(','), conteudo: mensagem, enviadaEm: new Date(), status });
      logger.info({ msg: 'Alerta spike baixo', conta: conta.nome, gastoHoje, mediaDiaria, pct, status });
    }
  }
}

/**
 * Verifica se o ritmo mensal de gasto está muito abaixo do previsto.
 * Só dispara após o 8º dia do mês (evitar ruído na primeira semana).
 * Alerta quando ritmo atual < 50% do ritmo esperado (meta/diasNoMes).
 */
async function verificarRitmoMensalBaixo(conta) {
  const meta = conta.perfil?.investimentoMensalPlanejado;
  if (!meta || meta <= 0) return;

  const destinatarios = resolverDestinatarios(conta);
  if (!destinatarios.length) return;

  const agora = new Date();
  const diaAtual = agora.getDate();
  if (diaAtual < RITMO_DIA_MINIMO) return;

  const campanhas = await Entidade.find({
    contaId: conta._id, tipo: 'campaign', 'configuracoes.monitorada': true,
  }).select('_id').lean();
  if (!campanhas.length) return;

  const campanhaIds = campanhas.map((c) => String(c._id));
  const gastoMes = await buscarGastoMes(campanhaIds);
  if (gastoMes === 0) return;

  const diasNoMes = new Date(agora.getFullYear(), agora.getMonth() + 1, 0).getDate();
  const metaDiaria = meta / diasNoMes;
  const ritmoAtual = gastoMes / diaAtual;

  if (ritmoAtual >= metaDiaria * RITMO_LIMIAR_PCT) return;

  const chave = `ritmo_baixo_${conta._id}_${agora.getFullYear()}_${agora.getMonth()}`;
  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const jaAvisou = await Notificacao.exists({
    contaId: conta._id, tipo: 'alerta_orcamento', canal: 'whatsapp',
    conteudo: new RegExp(chave.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    enviadaEm: { $gte: desde },
  });
  if (jaAvisou) return;

  const fmtR = (v) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const projecao = ritmoAtual * diasNoMes;
  const pctMeta = Math.round((projecao / meta) * 100);
  const mesAtual = agora.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  const mensagem = [
    `⚠️ *Investimento abaixo do previsto — ${conta.nome}*`,
    ``,
    `Mês: *${mesAtual}* · Dia ${diaAtual} de ${diasNoMes}`,
    `Meta mensal: *${fmtR(meta)}*`,
    `Gasto até agora: *${fmtR(gastoMes)}* (ritmo: ${fmtR(ritmoAtual)}/dia)`,
    `Projeção para o mês: *${fmtR(projecao)}* (${pctMeta}% da meta)`,
    ``,
    `Verifique se o orçamento das campanhas está adequado ao objetivo do cliente.`,
    `<!-- ${chave} -->`,
  ].join('\n');

  let status = 'enviada';
  try { await enviarMensagemWhatsapp(destinatarios, mensagem); } catch (e) { status = 'erro'; logger.error({ msg: 'Falha ao enviar ritmo mensal baixo', conta: conta.nome, erro: e.message }); }
  await Notificacao.create({ contaId: conta._id, tipo: 'alerta_orcamento', canal: 'whatsapp', destinatario: destinatarios.join(','), conteudo: mensagem, enviadaEm: new Date(), status });
  logger.info({ msg: 'Alerta ritmo mensal baixo', conta: conta.nome, gastoMes, meta, ritmoAtual, metaDiaria, pctMeta, status });
}

/**
 * Verifica se o gasto do mês corrente está no ritmo de ultrapassar a meta mensal
 * declarada em `conta.perfil.investimentoMensalPlanejado`. Dispara dois cenários:
 *   1. Já ultrapassou — urgente.
 *   2. Projeção até fim do mês supera a meta + threshold — preventivo.
 * Throttle: 24h. Só funciona para contas com meta cadastrada.
 */
async function verificarMetaMensalConta(conta) {
  const meta = conta.perfil?.investimentoMensalPlanejado;
  if (!meta || meta <= 0) return;

  const destinatarios = resolverDestinatarios(conta);
  if (!destinatarios.length) return;

  const campanhas = await Entidade.find({
    contaId: conta._id, tipo: 'campaign', 'configuracoes.monitorada': true,
  }).select('_id').lean();
  if (!campanhas.length) return;

  const campanhaIds = campanhas.map((c) => String(c._id));
  const gastoMes = await buscarGastoMes(campanhaIds);
  if (gastoMes === 0) return;

  const agora = new Date();
  const diaAtual = agora.getDate();
  const diasNoMes = new Date(agora.getFullYear(), agora.getMonth() + 1, 0).getDate();
  const diasRestantes = diasNoMes - diaAtual;
  const projecao = (gastoMes / diaAtual) * diasNoMes;

  // Formata em pt-BR
  const fmtR = (v) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const mesAtual = agora.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  let cenario = null;
  if (gastoMes > meta) {
    cenario = 'ultrapassou';
  } else if (projecao > meta * (1 + THRESHOLD_META_MENSAL)) {
    cenario = 'projecao';
  }
  if (!cenario) return;

  // Throttle por cenário + mês — evita spam mas avisa ao mudar de cenário
  const chaveAlerta = `meta_mensal_${cenario}_${conta._id}_${agora.getFullYear()}_${agora.getMonth()}`;
  const desde = new Date(Date.now() - JANELA_RENOTIFICACAO_META * 60 * 60 * 1000);
  const jaAvisou = await Notificacao.exists({
    contaId: conta._id, tipo: 'alerta_orcamento', canal: 'whatsapp',
    conteudo: new RegExp(chaveAlerta.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    enviadaEm: { $gte: desde },
  });
  if (jaAvisou) return;

  const pctMeta = Math.round((gastoMes / meta) * 100);
  const pctProjecao = Math.round((projecao / meta) * 100);

  const mensagem = cenario === 'ultrapassou'
    ? [
        `🔴 *Meta mensal ultrapassada — ${conta.nome}*`,
        ``,
        `Mês: *${mesAtual}*`,
        `Meta: *${fmtR(meta)}*`,
        `Gasto atual: *${fmtR(gastoMes)}* (${pctMeta}% da meta)`,
        `Restam *${diasRestantes} dias* no mês.`,
        ``,
        `Considere pausar campanhas ou ajustar o orçamento com o cliente.`,
        `<!-- ${chaveAlerta} -->`,
      ].join('\n')
    : [
        `⚠️ *Ritmo de gasto acima do previsto — ${conta.nome}*`,
        ``,
        `Mês: *${mesAtual}* · Dia ${diaAtual} de ${diasNoMes}`,
        `Meta mensal: *${fmtR(meta)}*`,
        `Gasto até hoje: *${fmtR(gastoMes)}*`,
        `Projeção para o mês: *${fmtR(projecao)}* (${pctProjecao}% da meta)`,
        ``,
        `Reduza o orçamento diário das campanhas para manter dentro da meta.`,
        `<!-- ${chaveAlerta} -->`,
      ].join('\n');

  let envioStatus = 'enviada';
  try {
    await enviarMensagemWhatsapp(destinatarios, mensagem);
  } catch (e) {
    envioStatus = 'erro';
    logger.error({ msg: 'Falha ao enviar alerta de meta mensal', conta: conta.nome, erro: e.message });
  }

  await Notificacao.create({
    contaId: conta._id, tipo: 'alerta_orcamento', canal: 'whatsapp',
    destinatario: destinatarios.join(','), conteudo: mensagem,
    enviadaEm: new Date(), status: envioStatus,
  });

  logger.info({ msg: 'Alerta de meta mensal enviado', conta: conta.nome, cenario, gastoMes, meta, projecao, status: envioStatus });
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
    const isPrepago = conta.configuracoes?.prepago === true;
    const anteriorBloq = (conta.saldoPrepago ?? []).find((s) => s.contaAnuncioId === contaAnuncioId);

    // Pré-pago: só notifica na MUDANÇA de estado (não repete enquanto bloqueado).
    // Pós-pago: sem snapshot de saldo — mantém throttle por notificação (persistente).
    let deveNotificar;
    if (isPrepago) {
      deveNotificar = (anteriorBloq?.nivelNotificado ?? null) !== 'bloqueado';
    } else {
      const desde = new Date(Date.now() - JANELA_RENOTIFICACAO_PERSISTENTE * 60 * 60 * 1000);
      deveNotificar = !(await Notificacao.exists({
        contaId: conta._id, tipo: 'alerta_orcamento', canal: 'whatsapp',
        conteudo: new RegExp(`alerta_conta_status_${contaAnuncioId}`), enviadaEm: { $gte: desde },
      }));
    }

    if (deveNotificar) {
      const chaveAlerta = `alerta_conta_status_${contaAnuncioId}`;
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
    // Reflete o bloqueio no dashboard (conta pré-paga), marcando o nível já notificado
    if (isPrepago) {
      await persistirSnapshotSaldo(conta._id, contaAnuncioId, { nivel: 'bloqueado', motivoBloqueio: labelProblema, nivelNotificado: 'bloqueado' });
    }
    return;
  }

  // Saldo pré-pago via funding_source_details (valor REAL carregado na conta),
  // com fallback para spend_cap - amount_spent. (só para contas marcadas como prepago)
  if (conta.configuracoes?.prepago) {
    const snap = await computarSaldoPrepago(conta, contaAnuncioId, detalhes, token);
    if (!snap) return; // saldo indeterminável — não é pré-pago real
    const { saldoReais: saldoEstimadoReais, ritmoHora, runwayHoras, nivel } = snap;

    // Nível já notificado neste episódio (lido antes de persistir — em memória ainda é
    // o snapshot anterior). Anti-repetição: só alerta quando o nível MUDA.
    const nivelNotificadoAnterior = (conta.saldoPrepago ?? []).find((s) => s.contaAnuncioId === contaAnuncioId)?.nivelNotificado ?? null;

    // Persiste o snapshot pro dashboard. Carrega adiante o nivelNotificado; zera quando
    // volta a 'ok' (re-arma o alerta após uma recarga).
    await persistirSnapshotSaldo(conta._id, contaAnuncioId, {
      ...snap,
      nivelNotificado: nivel === 'ok' ? null : nivelNotificadoAnterior,
    });

    // 1. Saldo zerado — entrega interrompida. Notifica só na transição para 'zerado'.
    if (nivel === 'zerado') {
      if (nivelNotificadoAnterior === 'zerado') return; // já notificado neste episódio
      const chaveZerado = `saldo_prepago_zerado_${contaAnuncioId}`;
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
      await marcarNivelNotificado(conta._id, contaAnuncioId, 'zerado');
      logger.info({ msg: 'Alerta de saldo zerado enviado', conta: conta.nome, contaAnuncioId, status: envioStatus });
      return;
    }

    // 2. Saldo confortável — snapshot já persistido (nivelNotificado zerado), nada a alertar
    if (nivel === 'ok') return;

    // 2b. Saldo parado — não está caindo desde a última leitura. Suprime o alerta
    // de runway (mantém o snapshot do dashboard com a projeção real). Evita o
    // falso positivo de campanha agendada para não rodar no fim de semana.
    if (!saldoEstaCaindo(conta, contaAnuncioId, saldoEstimadoReais)) {
      logger.info({ msg: 'Alerta de saldo suprimido — saldo estável (não está caindo)', conta: conta.nome, contaAnuncioId, nivel, saldoEstimadoReais });
      return;
    }

    // 3. Projeção de esgotamento (runway): notifica só na MUDANÇA de nível (crítico/acabando).
    if (nivelNotificadoAnterior === nivel) return; // mesmo nível já notificado — não repete
    const chaveAlerta = `saldo_prepago_${nivel}_${contaAnuncioId}`;

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
    await marcarNivelNotificado(conta._id, contaAnuncioId, nivel);
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
  const snapshot = { contaAnuncioId, atualizadoEm: new Date(), saldoReais: null, ritmoHora: null, runwayHoras: null, nivel: null, motivoBloqueio: null, nivelNotificado: null, ...dados };
  const r = await Conta.updateOne(
    { _id: contaId, 'saldoPrepago.contaAnuncioId': contaAnuncioId },
    { $set: { 'saldoPrepago.$': snapshot } }
  );
  if (r.matchedCount === 0) {
    await Conta.updateOne({ _id: contaId }, { $push: { saldoPrepago: snapshot } });
  }
}

/** Marca o nível já notificado no snapshot (anti-repetição por mudança de estado). */
async function marcarNivelNotificado(contaId, contaAnuncioId, nivelNotificado) {
  await Conta.updateOne(
    { _id: contaId, 'saldoPrepago.contaAnuncioId': contaAnuncioId },
    { $set: { 'saldoPrepago.$.nivelNotificado': nivelNotificado } }
  );
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
  const { budgetRemaining, budgetTotal, origemOrcamento, ehDiario } = await obterSaldo(adset, token);

  if (budgetRemaining === null || budgetTotal === null || budgetTotal === 0) return;

  // Orçamento DIÁRIO se esgota todo dia por design e reseta à meia-noite — o
  // "restante baixo" no fim do dia é normal, não um problema. Alertar isso gera
  // falso positivo diário (e em massa quando há muitos adsets ativos). Só faz
  // sentido alertar orçamento TOTAL/lifetime, que de fato se esgota de vez.
  if (ehDiario) return;

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
      ehDiario: !!cfgAdset.daily_budget,
    };
  }

  // CBO — orçamento está na campanha
  const campanhaId = adset.hierarquia?.campanhaId;
  if (!campanhaId) return { budgetRemaining: null, budgetTotal: null, origemOrcamento: null, ehDiario: false };

  const cfgCampanha = await obterConfiguracaoCampanha(campanhaId, token);
  if (cfgCampanha.budget_remaining == null) return { budgetRemaining: null, budgetTotal: null, origemOrcamento: null, ehDiario: false };

  return {
    budgetRemaining: Number(cfgCampanha.budget_remaining) / 100,
    budgetTotal: Number(cfgCampanha.daily_budget || cfgCampanha.lifetime_budget) / 100,
    origemOrcamento: cfgCampanha.daily_budget ? 'diário (campanha CBO)' : 'total (campanha CBO)',
    ehDiario: !!cfgCampanha.daily_budget,
  };
}
