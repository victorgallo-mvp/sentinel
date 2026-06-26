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
 * Cada destinatário é tentado de forma independente: a falha de um não impede
 * o envio aos demais. Só lança erro se TODOS os destinatários falharem.
 * @param {string|string[]} destinatario - JID(s) do(s) destinatário(s)
 * @param {string} texto - conteúdo da mensagem
 * @returns {Promise<{idMensagemEnviada: string|null}>} resultado do último envio bem-sucedido
 */
export async function enviarMensagemWhatsapp(destinatario, texto) {
  const jids = Array.isArray(destinatario) ? destinatario : [destinatario];
  let ultimo = { idMensagemEnviada: null };
  let algumSucesso = false;
  const falhas = [];

  for (const jid of jids) {
    try {
      ultimo = await enviarParaJid(jid, texto);
      algumSucesso = true;
    } catch (e) {
      falhas.push(jid);
      logger.error({ msg: 'Falha ao enviar para destinatário — continuando com os demais', jid, erro: e.message });
    }
  }

  if (!algumSucesso) {
    throw new ErroAplicacao(`Falha ao enviar WhatsApp para todos os destinatários: ${falhas.join(', ')}`, 'ERRO_EVOLUTION_TODOS');
  }
  return ultimo;
}

// Cache em memória de número → JID real no WhatsApp (resolvido via Evolution).
// Evita reconsultar a cada envio. Só guarda resoluções bem-sucedidas.
const cacheJidReal = new Map();

/**
 * Resolve o JID real de um número no WhatsApp via Evolution (`whatsappNumbers`).
 * Crucial para números BR: o WhatsApp frequentemente registra o JID SEM o
 * nono dígito (ex.: 5537998409449 → 553798409449). Enviar para o JID errado
 * faz a mensagem não chegar.
 * Retorna o JID canônico, ou null se não encontrado/erro (fallback: usa o número como veio).
 */
async function resolverJidReal(numero) {
  const limpo = String(numero).replace(/@.*/, '').replace(/\D/g, '');
  if (!limpo) return null;
  if (cacheJidReal.has(limpo)) return cacheJidReal.get(limpo);

  try {
    const url = `${config.evolution.apiUrl.replace(/\/$/, '')}/chat/whatsappNumbers/${config.evolution.instanceName}`;
    const resposta = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: config.evolution.apiKey },
      body: JSON.stringify({ numbers: [limpo] }),
    });
    if (!resposta.ok) return null;

    const dados = await resposta.json();
    const item = Array.isArray(dados) ? dados.find((d) => d?.exists && d?.jid) : null;
    const jid = item?.jid ?? null;
    if (jid) cacheJidReal.set(limpo, jid); // só cacheia sucesso
    return jid;
  } catch (e) {
    logger.warn({ msg: 'Falha ao resolver JID real na Evolution — usando número original', numero: limpo, erro: e.message });
    return null;
  }
}

async function enviarParaJid(destinatario, texto) {
  if (!config.evolution.apiUrl || !config.evolution.apiKey || !config.evolution.instanceName) {
    throw new ErroAplicacao('Evolution API não configurada (EVOLUTION_API_URL/API_KEY/INSTANCE_NAME)', 'ERRO_CONFIG_EVOLUTION');
  }

  // Resolve o JID real no WhatsApp (corrige o nono dígito BR). Fallback: número como veio.
  const jidReal = await resolverJidReal(destinatario);
  let jidNormalizado;
  if (jidReal) {
    jidNormalizado = jidReal;
  } else if (!destinatario.includes('@')) {
    jidNormalizado = `${destinatario}@s.whatsapp.net`;
    logger.warn({ msg: 'JID não resolvido na Evolution, normalizado por sufixo', original: destinatario, normalizado: jidNormalizado });
  } else {
    jidNormalizado = destinatario;
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
