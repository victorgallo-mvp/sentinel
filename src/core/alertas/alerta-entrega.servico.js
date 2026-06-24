/**
 * Verificador de erros de entrega via issues_info — roda a cada hora.
 * Para cada entidade ativa e monitorada, consulta o campo `issues_info`
 * na Meta API. Se houver erros ativos, envia alerta WhatsApp.
 *
 * Throttle: não reavisa a mesma (entidade + error_code) em menos de 4h.
 */
import { Conta } from '../../dominio/conta.modelo.js';
import { Entidade } from '../../dominio/entidade.modelo.js';
import { Notificacao } from '../../dominio/notificacao.modelo.js';
import { obterIssuesInfo } from '../coleta/meta-api.cliente.js';
import { enviarMensagemWhatsapp } from '../notificacao/enviador-whatsapp.servico.js';
import { config } from '../../config/index.js';
import { logger } from '../../infra/logger.js';

const JANELA_RENOTIFICACAO_HORAS = 4;
const TIPOS_VERIFICADOS = ['campaign', 'adset'];

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
      await verificarErrosEntidadeIndividual(conta, entidade, token, destinatario);
    } catch (erro) {
      logger.warn({ msg: 'Falha ao verificar issues_info da entidade', entidadeId: String(entidade._id), nome: entidade.nome, erro: erro.message });
    }
  }
}

async function verificarErrosEntidadeIndividual(conta, entidade, token, destinatario) {
  const issues = await obterIssuesInfo(entidade.tipo, entidade.metaId, token);
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
