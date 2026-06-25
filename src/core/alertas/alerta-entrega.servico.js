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
 * Throttle: 24h por (entidade + tipo de evento).
 */
import { Conta } from '../../dominio/conta.modelo.js';
import { Entidade } from '../../dominio/entidade.modelo.js';
import { Notificacao } from '../../dominio/notificacao.modelo.js';
import { obterStatusEIssues } from '../coleta/meta-api.cliente.js';
import { enviarMensagemWhatsapp } from '../notificacao/enviador-whatsapp.servico.js';
import { config } from '../../config/index.js';
import { logger } from '../../infra/logger.js';

const JANELA_RENOTIFICACAO_HORAS = 24;
const TIPOS_VERIFICADOS = ['campaign', 'adset', 'ad'];

const STATUS_LABEL = {
  PAUSED:               'pausada',
  WITH_ISSUES:          'com problemas de entrega',
  DISAPPROVED:          'reprovada pela Meta',
  PENDING_BILLING_INFO: 'pendente de informação de pagamento',
  CAMPAIGN_PAUSED:      'pausada (campanha pai pausada)',
  ADSET_PAUSED:         'pausada (conjunto pai pausado)',
};

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
  const destinatario = conta.notificacao?.whatsappJid || config.evolution.whatsappJidPadrao;
  if (!destinatario) return;

  const entidades = await Entidade.find({
    contaId: conta._id,
    tipo: { $in: TIPOS_VERIFICADOS },
    status: 'ACTIVE',
    'configuracoes.monitorada': true,
  });

  for (const entidade of entidades) {
    try {
      await verificarEntidadeIndividual(conta, entidade, token, destinatario);
    } catch (erro) {
      logger.warn({ msg: 'Falha ao verificar entidade', entidadeId: String(entidade._id), nome: entidade.nome, erro: erro.message });
    }
  }

  // Bug 1C: campanha ativa sem nenhum anúncio ativo
  try {
    await verificarCampanhasAtivas(conta, destinatario);
  } catch (erro) {
    logger.warn({ msg: 'Falha ao verificar campanhas sem ad ativo', contaId: String(conta._id), erro: erro.message });
  }
}

async function verificarEntidadeIndividual(conta, entidade, token, destinatario) {
  const { effectiveStatus, issues } = await obterStatusEIssues(entidade.tipo, entidade.metaId, token);

  if (effectiveStatus && effectiveStatus !== 'ACTIVE') {
    // Sempre atualiza MongoDB para manter status atual (usado na verificação 1C)
    if (effectiveStatus !== entidade.status) {
      await Entidade.findByIdAndUpdate(entidade._id, { status: effectiveStatus });
    }
    // Só envia alerta para mudanças acionáveis
    if (deveAlertarStatus(effectiveStatus, entidade.tipo)) {
      await notificarMudancaStatus(conta, entidade, effectiveStatus, destinatario);
    }
    return;
  }

  // Entidade ACTIVE — verifica erros de entrega
  if (!issues.length) return;

  const desde = new Date(Date.now() - JANELA_RENOTIFICACAO_HORAS * 60 * 60 * 1000);

  for (const issue of issues) {
    const errorCode = issue.error_code ?? issue.error_type ?? 'desconhecido';
    const chaveAlerta = `erroentrega_${String(entidade._id)}_${errorCode}`;

    const jaAvisou = await Notificacao.exists({
      contaId: conta._id,
      tipo: 'alerta_orcamento',
      canal: 'whatsapp',
      conteudo: new RegExp(chaveAlerta),
      enviadaEm: { $gte: desde },
    });
    if (jaAvisou) continue;

    const mensagem = [
      `⛔ *Erro de entrega — ${conta.nome}*`,
      ``,
      `Entidade: *${entidade.nome}* (${entidade.tipo})`,
      `Código: \`${errorCode}\``,
      `Resumo: ${issue.error_summary ?? '—'}`,
      `Detalhe: ${issue.error_message ?? '—'}`,
      ``,
      `Verifique o gerenciador de anúncios para resolver o problema.`,
      `<!-- ${chaveAlerta} -->`,
    ].join('\n');

    let envioStatus = 'enviada';
    try {
      await enviarMensagemWhatsapp(destinatario, mensagem);
    } catch (e) {
      envioStatus = 'erro';
      logger.error({ msg: 'Falha ao enviar alerta de erro de entrega', conta: conta.nome, entidade: entidade.nome, destinatario, erro: e.message });
    }

    await Notificacao.create({
      contaId: conta._id,
      tipo: 'alerta_orcamento',
      entidadeId: entidade._id,
      canal: 'whatsapp',
      destinatario,
      conteudo: mensagem,
      enviadaEm: new Date(),
      status: envioStatus,
    });

    logger.info({ msg: 'Alerta de erro de entrega enviado', conta: conta.nome, entidade: entidade.nome, errorCode, status: envioStatus });
  }
}

async function notificarMudancaStatus(conta, entidade, novoStatus, destinatario) {
  const desde = new Date(Date.now() - JANELA_RENOTIFICACAO_HORAS * 60 * 60 * 1000);
  const chaveAlerta = `status_change_${String(entidade._id)}_${novoStatus}`;

  const jaAvisou = await Notificacao.exists({
    contaId: conta._id,
    tipo: 'alerta_orcamento',
    canal: 'whatsapp',
    conteudo: new RegExp(chaveAlerta),
    enviadaEm: { $gte: desde },
  });
  if (jaAvisou) return;

  const tipoLabel = { campaign: 'Campanha', adset: 'Conjunto', ad: 'Anúncio' }[entidade.tipo] ?? entidade.tipo;
  const statusLabel = STATUS_LABEL[novoStatus] ?? novoStatus;
  const mensagem = [
    `⏸ *${tipoLabel} alterada — ${conta.nome}*`,
    ``,
    `${tipoLabel}: *${entidade.nome}*`,
    `Novo status: *${statusLabel}*`,
    ``,
    `A entrega pode ter sido interrompida. Verifique o gerenciador de anúncios.`,
    `<!-- ${chaveAlerta} -->`,
  ].join('\n');

  let envioStatus = 'enviada';
  try {
    await enviarMensagemWhatsapp(destinatario, mensagem);
  } catch (e) {
    envioStatus = 'erro';
    logger.error({ msg: 'Falha ao enviar alerta de mudança de status', conta: conta.nome, entidade: entidade.nome, novoStatus, destinatario, erro: e.message });
  }

  await Notificacao.create({
    contaId: conta._id,
    tipo: 'alerta_orcamento',
    entidadeId: entidade._id,
    canal: 'whatsapp',
    destinatario,
    conteudo: mensagem,
    enviadaEm: new Date(),
    status: envioStatus,
  });

  logger.info({ msg: 'Alerta de mudança de status enviado', conta: conta.nome, entidade: entidade.nome, novoStatus, status: envioStatus });
}

/**
 * Bug 1C: detecta campanhas ACTIVE que não possuem nenhum ad ACTIVE.
 * Requer que os ads estejam sincronizados no MongoDB para funcionar.
 */
async function verificarCampanhasAtivas(conta, destinatario) {
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
    if (adsAtivos.length > 0) continue;

    const chaveAlerta = `sem_ad_ativo_${String(campanha._id)}`;
    const desde = new Date(Date.now() - JANELA_RENOTIFICACAO_HORAS * 60 * 60 * 1000);
    const jaAvisou = await Notificacao.exists({
      contaId: conta._id,
      tipo: 'alerta_orcamento',
      canal: 'whatsapp',
      conteudo: new RegExp(chaveAlerta),
      enviadaEm: { $gte: desde },
    });
    if (jaAvisou) continue;

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
      await enviarMensagemWhatsapp(destinatario, mensagem);
    } catch (e) {
      envioStatus = 'erro';
      logger.error({ msg: 'Falha ao enviar alerta de campanha sem ad ativo', conta: conta.nome, campanha: campanha.nome, erro: e.message });
    }

    await Notificacao.create({
      contaId: conta._id,
      tipo: 'alerta_orcamento',
      entidadeId: campanha._id,
      canal: 'whatsapp',
      destinatario,
      conteudo: mensagem,
      enviadaEm: new Date(),
      status: envioStatus,
    });

    logger.info({ msg: 'Alerta de campanha sem ad ativo enviado', conta: conta.nome, campanha: campanha.nome, total: ads.length, ativos: 0 });
  }
}
