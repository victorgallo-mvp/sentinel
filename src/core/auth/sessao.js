/**
 * Sessões do dashboard: token assinado (HMAC-SHA256) emitido no login e
 * enviado pelo front no header `Authorization: Bearer <token>`.
 *
 * Formato: `<payload-base64url>.<assinatura-base64url>`, onde payload é
 * `{ sub, exp }` — id do usuário e expiração em epoch (segundos).
 *
 * O segredo vem de SESSAO_SECRET. Se não estiver configurado, um segredo
 * aleatório é gerado no boot: tudo funciona, mas as sessões caem a cada
 * reinício do servidor (por isso o aviso no log).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../../config/index.js';
import { logger } from '../../infra/logger.js';

export const DURACAO_SESSAO_SEGUNDOS = 12 * 60 * 60; // 12h

let segredo = config.sessaoSecret;
if (!segredo) {
  segredo = randomBytes(32).toString('hex');
  logger.warn({
    msg: 'SESSAO_SECRET não configurado — usando segredo efêmero. As sessões do dashboard cairão a cada reinício.',
  });
}

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function assinar(dados) {
  return base64url(createHmac('sha256', segredo).update(dados).digest());
}

/** Emite um token de sessão para o usuário informado. */
export function emitirSessao(usuarioId, { duracaoSegundos = DURACAO_SESSAO_SEGUNDOS } = {}) {
  const exp = Math.floor(Date.now() / 1000) + duracaoSegundos;
  const payload = base64url(JSON.stringify({ sub: String(usuarioId), exp }));
  return { token: `${payload}.${assinar(payload)}`, expiraEm: new Date(exp * 1000).toISOString() };
}

/**
 * Valida um token de sessão.
 * @returns {{ sub: string, exp: number } | null} payload, ou null se inválido/expirado.
 */
export function verificarSessao(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;

  const [payload, assinatura] = token.split('.');
  if (!payload || !assinatura) return null;

  const esperada = Buffer.from(assinar(payload));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null;

  try {
    const dados = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!dados?.sub || typeof dados.exp !== 'number') return null;
    if (dados.exp * 1000 <= Date.now()) return null;
    return dados;
  } catch {
    return null;
  }
}

/** Extrai o token do header `Authorization: Bearer <token>` da requisição. */
export function extrairTokenSessao(req) {
  const cabecalho = req.headers.authorization ?? '';
  return cabecalho.startsWith('Bearer ') ? cabecalho.slice(7).trim() : null;
}
