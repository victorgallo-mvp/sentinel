/**
 * Verificador de erros de entrega e mudanças de status — roda a cada hora.
 * Para cada entidade ACTIVE no MongoDB, consulta Meta API para:
 *   1. `effective_status` — detecta pausas inesperadas (ACTIVE → PAUSED/DISAPPROVED/etc.)
 *   2. `issues_info` — detecta erros de entrega ativos
 *
 * Quando uma entidade é pausada, atualiza o status no MongoDB e notifica.
 *
 * Throttle: 24h por (entidade + tipo de evento) — estados persistentes não repetem.
 */
import { Conta } from '../../dominio/conta.modelo.js';
import { Entidade } from '../../dominio/entidade.modelo.js';
import { Notificacao } from '../../dominio/notificacao.modelo.js';
import { obterStatusEIssues } from '../coleta/meta-api.cliente.js';
import { enviarMensagemWhatsapp } from '../notificacao/enviador-whatsapp.servico.js';
import { config } from '../../config/index.js';
import { logger } from '../../infra/logger.js';

const JANELA_RENOTIFICACAO_HORAS = 24;
const TIPOS_VERIFICADOS = ['campaign', 'adset'];

// Statuses que merecem notificação imediata (entidade estava ACTIVE no MongoDB)
const STATUS_ALERTAR = new Set(['PAUSED', 'WITH_ISSUES', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'DISAPPROVED', 'PENDING_BILLING_INFO']);

const STATUS_LABEL = {
  PAUSED: 'pausada',
  WITH_ISSUES: 'com problemas de entrega',
  CAMPAIGN_PAUSED: 'pausada (campanha pai pausada)',
  ADSET_PAUSED: 'pausada (conjunto pai pausado)',
  DISAPPROVED: 'reprovada pela Meta',
  PENDING_BILLING_INFO: 'pendente de informação de pagamento',
};

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
}

async function verificarEntidadeIndividual(conta, entidade, token, destinatario) {
  const { effectiveStatus, issues } = await obterStatusEIssues(entidade.tipo, entidade.metaId, token);

  // Detecta mudança de status: estava ACTIVE no MongoDB, mas não está mais na Meta
  if (effectiveStatus && effectiveStatus !== 'ACTIVE' && STATUS_ALERTAR.has(effectiveStatus)) {
    await notificarMudancaStatus(conta, entidade, effectiveStatus, destinatario);
    await Entidade.findByIdAndUpdate(entidade._id, { status: effectiveStatus });
    return; // se foi pausada, issues_info não é relevante
  }

  // Verifica erros de entrega ativos
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

  const tipoLabel = entidade.tipo === 'campaign' ? 'Campanha' : 'Conjunto';
  const statusLabel = STATUS_LABEL[novoStatus] ?? novoStatus;
  const mensagem = [
    `⏸ *${tipoLabel} pausada/alterada — ${conta.nome}*`,
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
