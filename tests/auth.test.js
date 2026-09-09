/**
 * Autenticação do dashboard: hash de senha (scrypt) e token de sessão (HMAC).
 */
import { describe, it, expect } from 'vitest';
import { gerarHashSenha, verificarSenha, SENHA_TAMANHO_MINIMO } from '../src/core/auth/senha.js';
import { emitirSessao, verificarSessao, extrairTokenSessao } from '../src/core/auth/sessao.js';

describe('senha', () => {
  it('aceita a senha correta', async () => {
    const hash = await gerarHashSenha('senhaSegura123');
    expect(await verificarSenha('senhaSegura123', hash)).toBe(true);
  });

  it('recusa senha errada', async () => {
    const hash = await gerarHashSenha('senhaSegura123');
    expect(await verificarSenha('senhaSegura124', hash)).toBe(false);
    expect(await verificarSenha('', hash)).toBe(false);
  });

  it('nunca guarda a senha em texto puro e usa sal diferente por senha', async () => {
    const a = await gerarHashSenha('mesmaSenha123');
    const b = await gerarHashSenha('mesmaSenha123');
    expect(a).not.toContain('mesmaSenha123');
    expect(a).not.toBe(b);
    expect(await verificarSenha('mesmaSenha123', b)).toBe(true);
  });

  it('exige o tamanho mínimo', async () => {
    await expect(gerarHashSenha('a'.repeat(SENHA_TAMANHO_MINIMO - 1))).rejects.toThrow();
  });

  it('trata hash malformado ou ausente como senha inválida', async () => {
    expect(await verificarSenha('qualquer', 'lixo')).toBe(false);
    expect(await verificarSenha('qualquer', undefined)).toBe(false);
    expect(await verificarSenha('qualquer', 'scrypt$16384$zz$zz')).toBe(false);
  });
});

describe('sessão', () => {
  it('emite e valida um token, devolvendo o id do usuário', () => {
    const { token } = emitirSessao('507f1f77bcf86cd799439011');
    expect(verificarSessao(token).sub).toBe('507f1f77bcf86cd799439011');
  });

  it('recusa token adulterado', () => {
    const { token } = emitirSessao('507f1f77bcf86cd799439011');
    const [payload, assinatura] = token.split('.');
    const outroPayload = Buffer.from(
      JSON.stringify({ sub: '000000000000000000000000', exp: Math.floor(Date.now() / 1000) + 3600 })
    ).toString('base64url');

    expect(verificarSessao(`${outroPayload}.${assinatura}`)).toBeNull();
    expect(verificarSessao(`${payload}.${assinatura.slice(0, -1)}x`)).toBeNull();
    expect(verificarSessao('')).toBeNull();
    expect(verificarSessao('sem-ponto')).toBeNull();
  });

  it('recusa token expirado', () => {
    const { token } = emitirSessao('507f1f77bcf86cd799439011', { duracaoSegundos: -1 });
    expect(verificarSessao(token)).toBeNull();
  });

  it('extrai o token do header Authorization', () => {
    expect(extrairTokenSessao({ headers: { authorization: 'Bearer abc.def' } })).toBe('abc.def');
    expect(extrairTokenSessao({ headers: { authorization: 'abc.def' } })).toBeNull();
    expect(extrairTokenSessao({ headers: {} })).toBeNull();
  });
});

describe('modelo de usuário', () => {
  it('nunca serializa o hash da senha em JSON', async () => {
    const { Usuario } = await import('../src/dominio/usuario.modelo.js');
    const usuario = new Usuario({
      nome: 'Victor',
      email: 'victor@exemplo.com',
      senhaHash: await gerarHashSenha('senhaSegura123'),
    });

    const serializado = JSON.parse(JSON.stringify({ usuario }));
    expect(serializado.usuario.email).toBe('victor@exemplo.com');
    expect(serializado.usuario.senhaHash).toBeUndefined();
  });
});
