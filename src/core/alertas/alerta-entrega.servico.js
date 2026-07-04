/**
 * Verificador de erros de entrega e mudanças de status — roda a cada hora.
 * Para cada entidade ACTIVE no MongoDB, consulta Meta API para:
 *   1. `effective_status` — detecta pausas inesperadas e reprovações
 *   2. `issues_info` — detecta erros de entrega ativos
 *
 * Lógica de alertas por nível:
 *   - CAMPAIGN_PAUSED / ADSET_PAUSED: status herdado do pai, nunca alerta (atualiza MongoDB)
 *   - PAUSED em adset/ad: pausado manualmente, nunca alerta (atualiza MongoDB)
 *   - PAUSED em campaign: pausa inesperada, sempre alerta
 *   - WITH_ISSUES / DISAPPROVED / PENDING_BILLING_INFO: alerta em qualquer nível
 *
 * Bug 1C: detecta campanha ACTIVE sem nenhum ad ACTIVE (todos pausados/reprovados).
 *
 * Anti-repetição: mudança de status notifica só quando o estado MUDA; erro de entrega
 * em entidade ACTIVE usa janela longa (7d); Bug 1C usa flag de estado (notifica na
 * transição, re-arma na recuperação). Em todos, "ciente" no dashboard suprime.
 */
import { Conta } from '../../dominio/conta.modelo.js';
import { Entidade } from '../../dominio/entidade.modelo.js';
import { Notificacao } from '../../dominio/notificacao.modelo.js';
import { obterStatusEIssues } from '../coleta/meta-api.cliente.js';
import { enviarMensagemWhatsapp, resolverDestinatarios } from '../notificacao/enviador-whatsapp.servico.js';
import { logger } from '../../infra/logger.js';

// Estados persistentes (erro de entrega em entidade ACTIVE): não repetir todo dia.
// Renotifica no máximo a cada 7 dias como rede de segurança; "ciente" para de vez.
const JANELA_RENOTIFICACAO_PERSISTENTE_HORAS = 168;
const TIPOS_VERIFICADOS = ['campaign', 'adset', 'ad'];

/** True se o usuário marcou `entidade:status` como "ciente" no dashboard. */
function reconhecido(conta, chave) {
  return (conta.configuracoes?.alertasReconhecidos ?? []).some((a) => a.chave === chave);
}

const STATUS_LABEL = {
  PAUSED:               'pausada',
  WITH_ISSUES:          'com problemas de entrega',
  DISAPPROVED:          'reprovada pela Meta',
  PENDING_BILLING_INFO: 'pendente de informação de pagamento',
  CAMPAIGN_PAUSED:      'pausada (campanha pai pausada)',
  ADSET_PAUSED:         'pausada (conjunto pai pausado)',
};

/**
 * Mapeia effectiveStatus e issues para uma string legível em português.
 * @param {string} effectiveStatus
 * @param {Array} issues - lista de issues_info da Meta API
 * @param {string} tipo - 'campaign'|'adset'|'ad'
 * @returns {string|null}
 */
function computarMotivoStatus(effectiveStatus, issues = [], tipo = '') {
  switch (effectiveStatus) {
    case 'PAUSED':
      return tipo === 'campaign' ? 'Pausada manualmente' : 'Pausada manualmente';
    case 'CAMPAIGN_PAUSED':
      return 'Pausada pela campanha';
    case 'ADSET_PAUSED':
      return 'Pausada pelo conjunto';
    case 'WITH_ISSUES':
      return issues[0]?.error_summary ?? 'Problema de entrega';
    case 'DISAPPROVED':
      return 'Reprovado pela Meta';
    case 'PENDING_BILLING_INFO':
      return 'Pendente de pagamento';
    case 'ACTIVE':
      return null;
    default:
      return null;
  }
}

/**
 * Retorna true se o status deve gerar notificação WhatsApp,
 * considerando o nível hierárquico da entidade.
 */
function deveAlertarStatus(status, tipo) {
  if (['WITH_ISSUES', 'DISAPPROVED', 'PENDING_BILLING_INFO'].includes(status)) return true;
  if (status === 'PAUSED' && tipo === 'campaign') return true;
  return false;
}

export async function verificarErrosEntrega() {
  const contas = await Conta.find({ ativo: true });

  for (const conta of contas) {
    try {
      await verificarErrosEntregaConta(conta);
    } catch (erro) {
      logger.error({ msg: 'Falha ao verificar erros de entrega da conta', contaId: String(conta._id), erro: erro.message });
    }
  }
}

async function verificarErrosEntregaConta(conta) {
  const token = conta.metaConfig?.systemUserToken || undefined;
  const destinatarios = resolverDestinatarios(conta);
  if (!destinatarios.length) return;

  const entidades = await Entidade.find({
    contaId: conta._id,
    tipo: { $in: TIPOS_VERIFICADOS },
    status: 'ACTIVE',
    'configuracoes.monitorada': true,
  });

  for (const entidade of entidades) {
    try {
      await verificarEntidadeIndividual(conta, entidade, token, destinatarios);
    } catch (erro) {
      logger.warn({ msg: 'Falha ao verificar entidade', entidadeId: String(entidade._id), nome: entidade.nome, erro: erro.message });
    }
  }

  // Bug 1C: campanha ativa sem nenhum anúncio ativo
  try {
    await verificarCampanhasAtivas(conta, destinatarios);
  } catch (erro) {
    logger.warn({ msg: 'Falha ao verificar campanhas sem ad ativo', contaId: String(conta._id), erro: erro.message });
  }
}

async function verificarEntidadeIndividual(conta, entidade, token, destinatarios) {
  const { effectiveStatus, issues } = await obterStatusEIssues(entidade.tipo, entidade.metaId, token);

  if (effectiveStatus && effectiveStatus !== 'ACTIVE') {
    // Sempre atualiza MongoDB para manter status atual (usado na verificação 1C)
    if (effectiveStatus !== entidade.status) {
      const motivoStatus = computarMotivoStatus(effectiveStatus, issues, entidade.tipo);
      await Entidade.findByIdAndUpdate(entidade._id, {
        status: effectiveStatus,
        issues: issues ?? [],
        motivoStatus,
      });
    }
    // Só envia alerta para mudanças acionáveis
    if (deveAlertarStatus(effectiveStatus, entidade.tipo)) {
      // Contas pré-pagas sem saldo (PENDING_BILLING_INFO) são tratadas exclusivamente
      // pelo verificador de orçamento (alerta-orcamento), que conhece o valor real do
      // saldo via spend_cap e alerta por conta de anúncio. Evita notificação duplicada.
      const isPrepago = conta.configuracoes?.prepago === true;
      if (effectiveStatus === 'PENDING_BILLING_INFO' && isPrepago) return;

      await notificarMudancaStatus(conta, entidade, effectiveStatus, destinatarios);
    }
    return;
  }

  // Entidade ACTIVE — atualiza issues no MongoDB e verifica erros de entrega
  const motivoStatusAtual = issues.length > 0 ? computarMotivoStatus('WITH_ISSUES', issues, entidade.tipo) : null;
  await Entidade.findByIdAndUpdate(entidade._id, {
    issues: issues ?? [],
    motivoStatus: motivoStatusAtual,
  });

  if (!issues.length) return;

  // Respeita "ciente": se o usuário já reconheceu o problema desta entidade no
  // dashboard, não re-notifica.
  if (reconhecido(conta, `${String(entidade._id)}:${entidade.status}`)) return;

  // Resolve campanha de referência — throttle e notificação sempre no nível campanha
  let campanhaRef = entidade;
  if (entidade.tipo !== 'campaign' && entidade.hierarquia?.campanhaId) {
    const campanhaPai = await Entidade.findOne({
      contaId: conta._id,
      metaId: entidade.hierarquia.campanhaId,
      tipo: 'campaign',
    }).lean();
    if (campanhaPai) campanhaRef = campanhaPai;
  }

  // 1 alerta por campanha — erro de entrega em entidade ACTIVE é persistente (a
  // entidade continua sendo verificada a cada hora), então usa a janela longa para
  // não repetir todo dia. "Ciente" (acima) para de vez.
  const desde = new Date(Date.now() - JANELA_RENOTIFICACAO_PERSISTENTE_HORAS * 60 * 60 * 1000);
  const chaveAlerta = `erroentrega_camp_${String(campanhaRef._id)}`;
  const jaAvisou = await Notificacao.exists({
    contaId: conta._id,
    tipo: 'alerta_orcamento',
    canal: 'whatsapp',
    conteudo: new RegExp(chaveAlerta),
    enviadaEm: { $gte: desde },
  });
  if (jaAvisou) return;

  const mensagem = [
    `⛔ *Problemas de entrega — ${conta.nome}*`,
    ``,
    `Campanha: *${campanhaRef.nome}*`,
    ``,
    `Foram detectados erros de entrega nesta campanha. Acesse o painel Sentinela para ver os detalhes.`,
    `<!-- ${chaveAlerta} -->`,
  ].join('\n');

  let envioStatus = 'enviada';
  try {
    await enviarMensagemWhatsapp(destinatarios, mensagem);
  } catch (e) {
    envioStatus = 'erro';
    logger.error({ msg: 'Falha ao enviar alerta de erro de entrega', conta: conta.nome, campanha: campanhaRef.nome, erro: e.message });
  }

  await Notificacao.create({
    contaId: conta._id,
    tipo: 'alerta_orcamento',
    entidadeId: campanhaRef._id,
    canal: 'whatsapp',
    destinatario: destinatarios.join(','),
    conteudo: mensagem,
    enviadaEm: new Date(),
    status: envioStatus,
  });

  logger.info({ msg: 'Alerta de erro de entrega enviado', conta: conta.nome, campanha: campanhaRef.nome, status: envioStatus });
}

async function notificarMudancaStatus(conta, entidade, novoStatus, destinatarios) {
  // Resolve campanha de referência ANTES do throttle — chave usa campaign ID
  let campanhaRef = entidade;
  if (entidade.tipo !== 'campaign' && entidade.hierarquia?.campanhaId) {
    const campanhaPai = await Entidade.findOne({
      contaId: conta._id,
      metaId: entidade.hierarquia.campanhaId,
      tipo: 'campaign',
    }).lean();
    if (campanhaPai) campanhaRef = campanhaPai;
  }

  // Respeita "ciente": problema já reconhecido no dashboard não re-notifica.
  if (reconhecido(conta, `${String(entidade._id)}:${novoStatus}`)) return;

  const chaveAlerta = `status_change_camp_${String(campanhaRef._id)}_${novoStatus}`;

  // Só notifica quando o estado MUDA: se a última notificação de status desta campanha
  // já foi o mesmo status, não repete (independe de tempo). Uma mudança real (status
  // diferente) gera uma chave nova e dispara.
  const ultima = await Notificacao.findOne({
    contaId: conta._id,
    canal: 'whatsapp',
    conteudo: new RegExp(`status_change_camp_${String(campanhaRef._id)}_`),
  }).sort({ enviadaEm: -1 }).select('conteudo').lean();
  if (ultima) {
    const m = ultima.conteudo.match(new RegExp(`status_change_camp_${String(campanhaRef._id)}_([A-Z_]+)`));
    if (m && m[1] === novoStatus) return; // mesmo estado já notificado — não repete
  }

  const statusLabel = STATUS_LABEL[novoStatus] ?? novoStatus;
  const mensagem = [
    `⏸ *Campanha alterada — ${conta.nome}*`,
    ``,
    `Campanha: *${campanhaRef.nome}*`,
    `Novo status: *${statusLabel}*`,
    ``,
    `A entrega pode ter sido interrompida. Acesse o painel Sentinela para verificar.`,
    `<!-- ${chaveAlerta} -->`,
  ].join('\n');

  let envioStatus = 'enviada';
  try {
    await enviarMensagemWhatsapp(destinatarios, mensagem);
  } catch (e) {
    envioStatus = 'erro';
    logger.error({ msg: 'Falha ao enviar alerta de mudança de status', conta: conta.nome, campanha: campanhaRef.nome, novoStatus, erro: e.message });
  }

  await Notificacao.create({
    contaId: conta._id,
    tipo: 'alerta_orcamento',
    entidadeId: campanhaRef._id,
    canal: 'whatsapp',
    destinatario: destinatarios.join(','),
    conteudo: mensagem,
    enviadaEm: new Date(),
    status: envioStatus,
  });

  logger.info({ msg: 'Alerta de mudança de status enviado', conta: conta.nome, campanha: campanhaRef.nome, novoStatus, status: envioStatus });
}

/**
 * Bug 1C: detecta campanhas ACTIVE que não possuem nenhum ad ACTIVE.
 * Requer que os ads estejam sincronizados no MongoDB para funcionar.
 */
async function verificarCampanhasAtivas(conta, destinatarios) {
  const campanhasAtivas = await Entidade.find({
    contaId: conta._id,
    tipo: 'campaign',
    status: 'ACTIVE',
    'configuracoes.monitorada': true,
  });

  for (const campanha of campanhasAtivas) {
    const ads = await Entidade.find({
      contaId: conta._id,
      tipo: 'ad',
      'hierarquia.campanhaId': campanha.metaId,
    });

    if (ads.length === 0) continue; // ads não sincronizados — não é possível saber

    const adsAtivos = ads.filter((a) => a.status === 'ACTIVE');
    if (adsAtivos.length > 0) {
      // Recuperou (voltou a ter ad ativo): re-arma o alerta para a próxima vez.
      if (campanha.semAdAtivoNotificado) {
        await Entidade.findByIdAndUpdate(campanha._id, { semAdAtivoNotificado: false });
      }
      continue;
    }

    // Sem ad ativo. Notifica só na TRANSIÇÃO para esse estado (state-change): se já
    // notificou e o estado persiste (ex.: você pausou os ads de propósito), não repete.
    // "Ciente" no dashboard também suprime.
    if (campanha.semAdAtivoNotificado) continue;
    if (reconhecido(conta, `${String(campanha._id)}:${campanha.status}`)) continue;

    const chaveAlerta = `sem_ad_ativo_${String(campanha._id)}`;

    const adsPausados = ads.filter((a) => a.status === 'PAUSED').length;
    const adsReprovados = ads.filter((a) => a.status === 'DISAPPROVED').length;
    const resumoAds = [
      adsPausados > 0 ? `${adsPausados} pausado${adsPausados > 1 ? 's' : ''}` : null,
      adsReprovados > 0 ? `${adsReprovados} reprovado${adsReprovados > 1 ? 's' : ''}` : null,
    ].filter(Boolean).join(', ') || 'todos inativos';

    const mensagem = [
      `⚠️ *Campanha ativa sem anúncio veiculando — ${conta.nome}*`,
      ``,
      `Campanha: *${campanha.nome}*`,
      `Anúncios: ${resumoAds} (${ads.length} no total)`,
      ``,
      `A campanha está ativa mas nenhum anúncio está sendo exibido.`,
      `<!-- ${chaveAlerta} -->`,
    ].join('\n');

    let envioStatus = 'enviada';
    try {
      await enviarMensagemWhatsapp(destinatarios, mensagem);
    } catch (e) {
      envioStatus = 'erro';
      logger.error({ msg: 'Falha ao enviar alerta de campanha sem ad ativo', conta: conta.nome, campanha: campanha.nome, erro: e.message });
    }

    await Notificacao.create({
      contaId: conta._id,
      tipo: 'alerta_orcamento',
      entidadeId: campanha._id,
      canal: 'whatsapp',
      destinatario: destinatarios.join(','),
      conteudo: mensagem,
      enviadaEm: new Date(),
      status: envioStatus,
    });

    // Marca o estado como notificado — só volta a alertar após recuperar (ter ad ativo).
    await Entidade.findByIdAndUpdate(campanha._id, { semAdAtivoNotificado: true });

    logger.info({ msg: 'Alerta de campanha sem ad ativo enviado', conta: conta.nome, campanha: campanha.nome, total: ads.length, ativos: 0 });
  }
}
