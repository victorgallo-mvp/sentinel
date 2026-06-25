import { config } from '../config/index.js';
import { enviarMensagemWhatsapp } from '../core/notificacao/enviador-whatsapp.servico.js';
import { logger } from '../infra/logger.js';

let falhasConsecutivas = 0;
const LIMITE_ALERTA = 3; // 3 × 5min = 15 min offline antes de alertar
let alertaEnviado = false; // evita spam de alertas enquanto permanece offline

export async function verificarSaudeEvolution() {
  const { apiUrl, apiKey, instanceName, whatsappJidPadrao } = config.evolution;

  if (!apiUrl || !apiKey || !instanceName) {
    logger.debug({ msg: 'health-check-evolution ignorado — Evolution não configurado' });
    return;
  }

  let estado = 'unknown';
  try {
    const url = `${apiUrl.replace(/\/$/, '')}/instance/connectionState/${instanceName}`;
    const res = await fetch(url, { headers: { apikey: apiKey }, signal: AbortSignal.timeout(10_000) });
    if (res.ok) {
      const dados = await res.json();
      estado = dados?.instance?.state ?? dados?.state ?? 'unknown';
    } else {
      estado = `http_${res.status}`;
    }
  } catch (err) {
    estado = `erro_rede: ${err.message}`;
  }

  if (estado === 'open') {
    if (falhasConsecutivas > 0) {
      logger.info({ msg: 'Evolution API reconectou', instanceName, falhasConsecutivas });
      // Avisa reconexão se tinha alertado
      if (alertaEnviado && whatsappJidPadrao) {
        try {
          await enviarMensagemWhatsapp(whatsappJidPadrao,
            `✅ *Sentinela Ads — WhatsApp reconectado*\nInstância *${instanceName}* está online novamente.`
          );
        } catch { /* não crítico */ }
      }
    }
    falhasConsecutivas = 0;
    alertaEnviado = false;
    return;
  }

  falhasConsecutivas++;
  logger.warn({ msg: 'Evolution API não está online', instanceName, estado, falhasConsecutivas });

  if (falhasConsecutivas >= LIMITE_ALERTA && !alertaEnviado && whatsappJidPadrao) {
    alertaEnviado = true;
    try {
      await enviarMensagemWhatsapp(whatsappJidPadrao,
        `⚠️ *Sentinela Ads — WhatsApp desconectado*\n` +
        `Instância *${instanceName}* está offline há ${falhasConsecutivas * 5} minutos.\n` +
        `Estado: ${estado}\n\n` +
        `Acesse o painel Evolution API para reconectar.`
      );
    } catch (err) {
      logger.error({ msg: 'Falha ao enviar alerta de desconexão Evolution', erro: err.message });
    }
  }
}
