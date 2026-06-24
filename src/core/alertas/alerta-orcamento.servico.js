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
import { enviarMensagemWhatsapp } from '../notificacao/enviador-whatsapp.servico.js';
import { config } from '../../config/index.js';
import { logger } from '../../infra/logger.js';

const LIMIAR_PCT_PADRAO = 0.20;   // 20% restante do orçamento diário
const LIMIAR_REAIS_PADRAO = 30;   // R$30 restante (em qualquer cenário)
const JANELA_RENOTIFICACAO_HORAS = 4;        // alertas transitórios (saldo baixo)
const JANELA_RENOTIFICACAO_PERSISTENTE = 24; // alertas persistentes (zerado, bloqueado)

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
  const destinatario = conta.notificacao?.whatsappJid || config.evolution.whatsappJidPadrao;
  if (!destinatario) return;

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
      try { await enviarMensagemWhatsapp(destinatario, mensagem); } catch (e) { envioStatus = 'erro'; logger.error({ msg: 'Falha ao enviar alerta de conta bloqueada', conta: conta.nome, erro: e.message }); }
      await Notificacao.create({ contaId: conta._id, tipo: 'alerta_orcamento', canal: 'whatsapp', destinatario, conteudo: mensagem, enviadaEm: new Date(), status: envioStatus });
      logger.info({ msg: 'Alerta de conta bloqueada enviado', conta: conta.nome, contaAnuncioId, status: labelProblema });
    }
    return;
  }

  // Saldo pré-pago via spend_cap - amount_spent (só para contas marcadas como prepago)
  if (conta.configuracoes?.prepago) {
    const spendCap = Number(detalhes.spend_cap ?? 0);
    const amountSpent = Number(detalhes.amount_spent ?? 0);
    if (spendCap <= 0) return; // spend_cap não definido — não é pré-pago real

    const saldoEstimadoReais = (spendCap - amountSpent) / 100;
    const limiar = conta.configuracoes?.limiarAlertaSaldoReais ?? 50;
    if (saldoEstimadoReais >= limiar) return;

    const desde = new Date(Date.now() - JANELA_RENOTIFICACAO_HORAS * 60 * 60 * 1000);

    // Saldo zerado — entrega interrompida (chave separada para não ser bloqueado pelo alerta de "baixo")
    if (saldoEstimadoReais <= 0) {
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
        try { await enviarMensagemWhatsapp(destinatario, mensagem); } catch (e) { envioStatus = 'erro'; logger.error({ msg: 'Falha ao enviar alerta de saldo zerado', conta: conta.nome, destinatario, erro: e.message }); }
        await Notificacao.create({ contaId: conta._id, tipo: 'alerta_orcamento', canal: 'whatsapp', destinatario, conteudo: mensagem, enviadaEm: new Date(), status: envioStatus });
        logger.info({ msg: 'Alerta de saldo zerado enviado', conta: conta.nome, contaAnuncioId, status: envioStatus });
      }
      return;
    }

    // Saldo baixo (entre 0 e limiar)
    const chaveAlerta = `saldo_prepago_${contaAnuncioId}`;
    const jaAvisou = await Notificacao.exists({
      contaId: conta._id, tipo: 'alerta_orcamento', canal: 'whatsapp',
      conteudo: new RegExp(chaveAlerta), enviadaEm: { $gte: desde },
    });
    if (jaAvisou) return;

    // Burn rate: estima horas restantes com base no gasto de ontem
    let burnRateLinha = '';
    try {
      const gastoOntem = await calcularGastoDiarioOntem(conta._id);
      if (gastoOntem && gastoOntem > 0) {
        const taxaHoraria = gastoOntem / 24;
        const horasRestantes = Math.round(saldoEstimadoReais / taxaHoraria);
        burnRateLinha = `\nRitmo atual: *R$ ${taxaHoraria.toFixed(2)}/h* → saldo acaba em ~*${horasRestantes}h*`;
      }
    } catch { /* não crítico — mensagem enviada sem burn rate */ }

    const mensagem = [
      `💳 *Saldo pré-pago baixo — ${conta.nome}*`,
      ``, `Conta: \`${contaAnuncioId}\``,
      `Saldo estimado: *R$ ${saldoEstimadoReais.toFixed(2)}* (limite: R$ ${limiar.toFixed(2)})${burnRateLinha}`,
      ``,
      `Recarregue o saldo para evitar interrupção das campanhas.`,
      `<!-- ${chaveAlerta} -->`,
    ].join('\n');
    let envioStatus = 'enviada';
    try { await enviarMensagemWhatsapp(destinatario, mensagem); } catch (e) { envioStatus = 'erro'; logger.error({ msg: 'Falha ao enviar alerta de saldo baixo', conta: conta.nome, destinatario, erro: e.message }); }
    await Notificacao.create({ contaId: conta._id, tipo: 'alerta_orcamento', canal: 'whatsapp', destinatario, conteudo: mensagem, enviadaEm: new Date(), status: envioStatus });
    logger.info({ msg: 'Alerta de saldo pré-pago enviado', conta: conta.nome, contaAnuncioId, saldoEstimadoReais, status: envioStatus });
  }
}

/**
 * Estima o gasto diário médio da conta (ontem) para calcular horas restantes de saldo.
 * Usa o valor máximo de `spend` (24h) coletado ontem para cada entidade da conta.
 * Retorna null se não houver dados suficientes.
 */
async function calcularGastoDiarioOntem(contaId) {
  const entidades = await Entidade.find({ contaId }).select('_id').lean();
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

  const destinatario = conta.notificacao?.whatsappJid || config.evolution.whatsappJidPadrao;
  if (!destinatario) {
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
    await enviarMensagemWhatsapp(destinatario, mensagem);
  } catch (erro) {
    status = 'erro';
    logger.error({ msg: 'Falha ao enviar alerta de saldo WhatsApp', adsetId: String(adset._id), erro: erro.message });
  }

  await Notificacao.create({
    contaId: conta._id,
    tipo: 'alerta_orcamento',
    entidadeId: adset._id,
    canal: 'whatsapp',
    destinatario,
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
