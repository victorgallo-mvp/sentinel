/**
 * Webhook da Evolution API — recebe mensagens recebidas no WhatsApp
 * (feedback do usuário a notificações enviadas pelo sistema).
 *
 * Payload esperado (evento `messages.upsert` da Evolution API):
 * {
 *   event: 'messages.upsert',
 *   data: {
 *     key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: false },
 *     message: { conversation: '1' }
 *   }
 * }
 */
import { interpretarResposta } from '../../core/feedback/interpretador.js';
import { registrarFeedback, encontrarNotificacaoRecente } from '../../core/feedback/registrador.servico.js';
import { logger } from '../../infra/logger.js';

/** Extrai o texto e o JID remetente de um payload de webhook da Evolution. */
function extrairMensagem(payload) {
  const data = payload?.data;
  if (!data) return null;

  const fromMe = data.key?.fromMe;
  if (fromMe) return null; // ignora mensagens enviadas pelo próprio sistema

  const remoteJid = data.key?.remoteJid;
  const texto =
    data.message?.conversation ??
    data.message?.extendedTextMessage?.text ??
    null;

  if (!remoteJid || !texto) return null;

  // Normaliza JID para o formato usado ao enviar (apenas números)
  const numero = remoteJid.split('@')[0];

  return { numero, texto };
}

/**
 * Handler Express para o webhook da Evolution API.
 * Sempre responde 200 rapidamente — falhas de processamento são logadas,
 * não retornadas ao Evolution (evita retries em loop).
 */
export async function receberWebhookEvolution(req, res) {
  res.status(200).json({ recebido: true });

  try {
    if (req.body?.event && req.body.event !== 'messages.upsert') {
      return; // ignora outros eventos (status de conexão, etc)
    }

    const mensagem = extrairMensagem(req.body);
    if (!mensagem) return;

    const notificacao = await encontrarNotificacaoRecente(mensagem.numero);
    if (!notificacao) {
      logger.info({ msg: 'Mensagem recebida sem notificação recente correspondente', numero: mensagem.numero, texto: mensagem.texto });
      return;
    }

    const interpretacao = interpretarResposta(mensagem.texto);
    await registrarFeedback(String(notificacao._id), interpretacao);
  } catch (erro) {
    logger.error({ msg: 'Erro ao processar webhook da Evolution', erro: erro.message });
  }
}
