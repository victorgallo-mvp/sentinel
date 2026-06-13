/**
 * Interpreta a resposta de texto livre do usuário a uma notificação,
 * mapeando para uma classificação de feedback.
 */

const RESPOSTAS_UTIL = ['1', '1️⃣', 'util', 'útil'];
const RESPOSTAS_RUIDO = ['2', '2️⃣', 'ruido', 'ruído'];
const RESPOSTAS_SNOOZE = ['3', '3️⃣', 'snooze'];

/**
 * @param {string} texto - mensagem recebida do usuário
 * @returns {{ classificacao: 'util'|'ruido'|'parcial'|'comentario', acao: 'snooze'|null, comentarioLivre: string|null }}
 */
export function interpretarResposta(texto) {
  const normalizado = (texto ?? '').trim().toLowerCase();

  if (RESPOSTAS_UTIL.includes(normalizado)) {
    return { classificacao: 'util', acao: null, comentarioLivre: null };
  }

  if (RESPOSTAS_RUIDO.includes(normalizado)) {
    return { classificacao: 'ruido', acao: null, comentarioLivre: null };
  }

  if (RESPOSTAS_SNOOZE.some((r) => normalizado === r || normalizado.startsWith(r))) {
    return { classificacao: 'parcial', acao: 'snooze', comentarioLivre: texto };
  }

  return { classificacao: 'comentario', acao: null, comentarioLivre: texto };
}
