/**
 * Envia mensagens via Evolution API (WhatsApp).
 * https://doc.evolution-api.com/
 */
import { config } from '../../config/index.js';
import { logger } from '../../infra/logger.js';
import { comRetry } from '../../shared/utils.js';
import { ErroAplicacao } from '../../shared/erros.js';

/**
 * Envia uma mensagem de texto via Evolution API.
 * @param {string} destinatario - JID/número do destinatário (ex: "5511999999999")
 * @param {string} texto - conteúdo da mensagem
 * @returns {Promise<{idMensagemEnviada: string|null}>}
 */
export async function enviarMensagemWhatsapp(destinatario, texto) {
  if (!config.evolution.apiUrl || !config.evolution.apiKey || !config.evolution.instanceName) {
    throw new ErroAplicacao('Evolution API não configurada (EVOLUTION_API_URL/API_KEY/INSTANCE_NAME)', 'ERRO_CONFIG_EVOLUTION');
  }

  const url = `${config.evolution.apiUrl.replace(/\/$/, '')}/message/sendText/${config.evolution.instanceName}`;

  return comRetry(
    async () => {
      const resposta = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: config.evolution.apiKey,
        },
        body: JSON.stringify({
          number: destinatario,
          text: texto,
        }),
      });

      if (!resposta.ok) {
        const corpo = await resposta.text();
        throw new ErroAplicacao(`Evolution API retornou ${resposta.status}: ${corpo}`, 'ERRO_EVOLUTION_API');
      }

      const dados = await resposta.json();
      const idMensagemEnviada = dados?.key?.id ?? null;

      logger.info({ msg: 'Mensagem WhatsApp enviada', destinatario, idMensagemEnviada });
      return { idMensagemEnviada };
    },
    { tentativas: 3, esperaBaseMs: 1000, fatorBackoff: 2 }
  );
}
