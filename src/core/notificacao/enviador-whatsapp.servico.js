/**
 * Envia mensagens via Evolution API (WhatsApp).
 * https://doc.evolution-api.com/
 */
import { config } from '../../config/index.js';
import { logger } from '../../infra/logger.js';
import { comRetry } from '../../shared/utils.js';
import { ErroAplicacao } from '../../shared/erros.js';

/**
 * Resolve a lista de JIDs de destinatários de uma conta.
 * Combina whatsappJid (primário) + whatsappJids (adicionais), deduplica.
 * Fallback para NOTIFICACAO_WHATSAPP_JID do env se nenhum JID configurado.
 * @param {Object} conta - documento Conta
 * @returns {string[]}
 */
export function resolverDestinatarios(conta) {
  const principal  = conta.notificacao?.whatsappJid ?? '';
  const adicionais = conta.notificacao?.whatsappJids ?? [];
  const todos = [...new Set([principal, ...adicionais].filter(Boolean))];
  if (todos.length === 0 && config.evolution.whatsappJidPadrao) {
    return [config.evolution.whatsappJidPadrao];
  }
  return todos;
}

/**
 * Envia uma mensagem de texto via Evolution API.
 * Aceita um único JID (string) ou múltiplos JIDs (string[]).
 * @param {string|string[]} destinatario - JID(s) do(s) destinatário(s)
 * @param {string} texto - conteúdo da mensagem
 * @returns {Promise<{idMensagemEnviada: string|null}>} resultado do primeiro envio
 */
export async function enviarMensagemWhatsapp(destinatario, texto) {
  const jids = Array.isArray(destinatario) ? destinatario : [destinatario];
  let ultimo = { idMensagemEnviada: null };
  for (const jid of jids) {
    ultimo = await enviarParaJid(jid, texto);
  }
  return ultimo;
}

async function enviarParaJid(destinatario, texto) {
  if (!config.evolution.apiUrl || !config.evolution.apiKey || !config.evolution.instanceName) {
    throw new ErroAplicacao('Evolution API não configurada (EVOLUTION_API_URL/API_KEY/INSTANCE_NAME)', 'ERRO_CONFIG_EVOLUTION');
  }

  // Normalização defensiva do JID: garante sufixo correto se não vier formatado
  let jidNormalizado = destinatario;
  if (!destinatario.includes('@')) {
    jidNormalizado = `${destinatario}@s.whatsapp.net`;
    logger.warn({ msg: 'JID sem sufixo @, normalizado automaticamente', original: destinatario, normalizado: jidNormalizado });
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
          number: jidNormalizado,
          text: texto,
        }),
      });

      if (!resposta.ok) {
        const corpo = await resposta.text();
        throw new ErroAplicacao(`Evolution API retornou ${resposta.status}: ${corpo}`, 'ERRO_EVOLUTION_API');
      }

      const dados = await resposta.json();
      const idMensagemEnviada = dados?.key?.id ?? null;

      logger.info({ msg: 'Mensagem WhatsApp enviada', destinatario: jidNormalizado, idMensagemEnviada });
      return { idMensagemEnviada };
    },
    { tentativas: 3, esperaBaseMs: 1000, fatorBackoff: 2 }
  );
}
