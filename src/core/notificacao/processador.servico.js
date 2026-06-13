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
import { enviarMensagemWhatsapp } from './enviador-whatsapp.servico.js';
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
  const entidade = await Entidade.findById(anomalia.entidadeId);
  const conta = await Conta.findById(investigacao.contaId);

  const { podeEnviar, motivo } = await podeNotificar(conta, entidade, anomalia);
  if (!podeEnviar) {
    logger.info({ msg: 'Notificação suprimida por throttling', investigacaoId, motivo });
    return { enviada: false, motivo };
  }

  const destinatario = conta.notificacao?.whatsappJid || config.evolution.whatsappJidPadrao;
  if (!destinatario) {
    logger.warn({ msg: 'Notificação não enviada — destinatário não configurado', investigacaoId, contaId: String(conta._id) });
    return { enviada: false, motivo: 'Destinatário WhatsApp não configurado para a conta.' };
  }

  const mensagem = construirMensagem(investigacao, anomalia, entidade);

  let idMensagemEnviada = null;
  let status = 'enviada';
  try {
    const resultado = await enviarMensagemWhatsapp(destinatario, mensagem);
    idMensagemEnviada = resultado.idMensagemEnviada;
  } catch (erro) {
    status = 'erro';
    logger.error({ msg: 'Falha ao enviar notificação WhatsApp', investigacaoId, erro: erro.message });
  }

  const notificacao = await Notificacao.create({
    contaId: conta._id,
    investigacaoId: investigacao._id,
    canal: 'whatsapp',
    destinatario,
    conteudo: mensagem,
    idMensagemEnviada,
    enviadaEm: new Date(),
    status,
  });

  return { enviada: status === 'enviada', notificacaoId: String(notificacao._id) };
}
