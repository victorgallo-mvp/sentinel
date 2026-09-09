/**
 * Hash e verificação de senhas do dashboard.
 * Usa scrypt do `node:crypto` (sem dependência externa), com sal aleatório por
 * senha. Formato armazenado: `scrypt$<N>$<sal-hex>$<hash-hex>`.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const CUSTO = 16384; // N do scrypt (2^14) — ~50ms por verificação
const TAM_SAL = 16;
const TAM_HASH = 64;

export const SENHA_TAMANHO_MINIMO = 8;

/** Gera o hash de uma senha em texto puro. */
export async function gerarHashSenha(senha) {
  if (typeof senha !== 'string' || senha.length < SENHA_TAMANHO_MINIMO) {
    throw new Error(`Senha deve ter ao menos ${SENHA_TAMANHO_MINIMO} caracteres`);
  }
  const sal = randomBytes(TAM_SAL);
  const hash = await scryptAsync(senha.normalize('NFKC'), sal, TAM_HASH, { N: CUSTO });
  return `scrypt$${CUSTO}$${sal.toString('hex')}$${hash.toString('hex')}`;
}

/**
 * Confere uma senha contra o hash armazenado.
 * Nunca lança: qualquer hash malformado é tratado como senha inválida.
 */
export async function verificarSenha(senha, hashArmazenado) {
  if (typeof senha !== 'string' || typeof hashArmazenado !== 'string') return false;

  const partes = hashArmazenado.split('$');
  if (partes.length !== 4 || partes[0] !== 'scrypt') return false;

  const custo = Number(partes[1]);
  if (!Number.isInteger(custo) || custo <= 0) return false;

  try {
    const sal = Buffer.from(partes[2], 'hex');
    const esperado = Buffer.from(partes[3], 'hex');
    if (sal.length === 0 || esperado.length === 0) return false;

    const calculado = await scryptAsync(senha.normalize('NFKC'), sal, esperado.length, { N: custo });
    return timingSafeEqual(calculado, esperado);
  } catch {
    return false;
  }
}
