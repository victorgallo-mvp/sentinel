/**
 * Processa um job da fila `notificar`: carrega a investigação concluída,
 * verifica throttling, monta a mensagem e envia via WhatsApp, registrando
 * o resultado em `Notificacao`.
 */
import { Investigacao } from '../../dominio/investigacao.modelo.js';
import { Anomalia } from '../../dominio/anomalia.modelo.js';
import { Entidade } from '../../dominio/entidade.modelo.js';
import { Conta } from '../../dominio/conta.modelo.js';
import { Notificacao } from '../../dominio/notificacao.modelo.js';
import { podeNotificar } from './throttling.js';
import { construirMensagem } from './construtor-mensagem.js';
import { enviarMensagemWhatsapp, resolverDestinatarios } from './enviador-whatsapp.servico.js';
import { config } from '../../config/index.js';
import { logger } from '../../infra/logger.js';
import { ErroNaoEncontrado } from '../../shared/erros.js';

/**
 * @param {string} investigacaoId - ObjectId da Investigacao
 * @returns {Promise<{enviada: boolean, motivo?: string, notificacaoId?: string}>}
 */
export async function processarNotificacao(investigacaoId) {
  const investigacao = await Investigacao.findById(investigacaoId);
  if (!investigacao) throw new ErroNaoEncontrado(`Investigação ${investigacaoId} não encontrada`);

  const anomalia = await Anomalia.findById(investigacao.anomaliaId);
  if (!anomalia) throw new ErroNaoEncontrado(`Anomalia ${investigacao.anomaliaId} não encontrada`);
  const entidade = await Entidade.findById(anomalia.entidadeId);
  if (!entidade) throw new ErroNaoEncontrado(`Entidade ${anomalia.entidadeId} não encontrada`);
  const conta = await Conta.findById(investigacao.contaId);
  if (!conta) throw new ErroNaoEncontrado(`Conta ${investigacao.contaId} não encontrada`);

  const { podeEnviar, motivo } = await podeNotificar(conta, entidade, anomalia);
  if (!podeEnviar) {
    logger.info({ msg: 'Notificação suprimida por throttling', investigacaoId, motivo });
    return { enviada: false, motivo };
  }

  const destinatarios = resolverDestinatarios(conta);
  if (!destinatarios.length) {
    logger.warn({ msg: 'Notificação não enviada — destinatário não configurado', investigacaoId, contaId: String(conta._id) });
    return { enviada: false, motivo: 'Destinatário WhatsApp não configurado para a conta.' };
  }

  // Resolve a campanha pai para ancorar a mensagem na campanha (não no adset/ad)
  let campanha = null;
  if (entidade.tipo !== 'campaign' && entidade.hierarquia?.campanhaId) {
    campanha = await Entidade.findOne({
      contaId: conta._id,
      metaId: entidade.hierarquia.campanhaId,
      tipo: 'campaign',
    }).lean();
  }

  const mensagem = construirMensagem(investigacao, anomalia, entidade, campanha);

  let idMensagemEnviada = null;
  let status = 'enviada';
  try {
    const resultado = await enviarMensagemWhatsapp(destinatarios, mensagem);
    idMensagemEnviada = resultado.idMensagemEnviada;
  } catch (erro) {
    status = 'erro';
    logger.error({ msg: 'Falha ao enviar notificação WhatsApp', investigacaoId, erro: erro.message });
  }

  const notificacao = await Notificacao.create({
    contaId: conta._id,
    investigacaoId: investigacao._id,
    canal: 'whatsapp',
    destinatario: destinatarios.join(','),
    conteudo: mensagem,
    idMensagemEnviada,
    enviadaEm: new Date(),
    status,
  });

  return { enviada: status === 'enviada', notificacaoId: String(notificacao._id) };
}
