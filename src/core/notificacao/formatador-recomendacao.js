/**
 * Formatadores de texto usados na montagem da mensagem WhatsApp:
 * emojis por severidade, listas em bullet e percentuais.
 */

const EMOJI_SEVERIDADE = {
  info: 'ℹ️',
  atencao: '⚠️',
  urgente: '🟠',
  critica: '🚨',
};

const LABEL_URGENCIA = {
  imediata: 'Imediata',
  '24h': 'Em até 24h',
  esta_semana: 'Esta semana',
};

/** Retorna o emoji correspondente à severidade do diagnóstico. */
export function emojiSeveridade(severidade) {
  return EMOJI_SEVERIDADE[severidade] ?? 'ℹ️';
}

/** Retorna o label legível da urgência de resposta. */
export function labelUrgencia(urgencia) {
  return LABEL_URGENCIA[urgencia] ?? 'Não especificada';
}

/** Formata uma lista de strings como bullets numerados/marcados. */
export function formatarBullets(lista, marcador = '•') {
  if (!lista || lista.length === 0) return '_nenhum item registrado_';
  return lista.map((item) => `${marcador} ${item}`).join('\n');
}

/** Formata um percentual de confiança (0-1) como inteiro percentual. */
export function formatarConfianca(confianca) {
  if (confianca === null || confianca === undefined) return 'N/A';
  return `${Math.round(confianca * 100)}%`;
}
