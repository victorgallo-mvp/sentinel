/**
 * Fluxo HTTP de autenticação do dashboard: login com e-mail/senha, acesso às
 * rotas protegidas com a sessão e recusa sem ela. O model de usuário é
 * mockado — o teste é sobre a rota, não sobre o Mongo.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer } from 'node:http';
import { gerarHashSenha } from '../src/core/auth/senha.js';

const USUARIO = {
  _id: '507f1f77bcf86cd799439011',
  nome: 'Victor',
  email: 'victor@exemplo.com',
  superAdmin: true,
  ativo: true,
  contaIds: [],
  senhaHash: await gerarHashSenha('senhaSegura123'),
};

vi.mock('../src/dominio/usuario.modelo.js', () => {
  const encadeavel = (resultado) => ({
    select: () => encadeavel(resultado),
    lean: async () => resultado,
  });
  return {
    Usuario: {
      findOne: vi.fn((filtro) => {
        const bate = filtro.email
          ? filtro.email === USUARIO.email
          : String(filtro._id) === USUARIO._id;
        return encadeavel(bate && USUARIO.ativo ? USUARIO : null);
      }),
      updateOne: vi.fn(async () => ({ acknowledged: true })),
    },
  };
});

// A rota /dashboard/data consulta contas — sem banco, devolve lista vazia.
vi.mock('../src/dominio/conta.modelo.js', () => ({
  Conta: { find: () => ({ lean: async () => [] }) },
}));

const { criarServidor } = await import('../src/api/servidor.js');

let servidor;
let base;

beforeAll(async () => {
  servidor = createServer(criarServidor());
  await new Promise((ok) => servidor.listen(0, ok));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

afterAll(async () => {
  await new Promise((ok) => servidor.close(ok));
});

function login(corpo) {
  return fetch(`${base}/dashboard/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
}

describe('POST /dashboard/login', () => {
  it('devolve token de sessão e dados do usuário com credenciais corretas', async () => {
    const res = await login({ email: 'victor@exemplo.com', senha: 'senhaSegura123' });
    expect(res.status).toBe(200);

    const corpo = await res.json();
    expect(corpo.token).toBeTruthy();
    expect(corpo.usuario).toMatchObject({ nome: 'Victor', email: 'victor@exemplo.com' });
    expect(JSON.stringify(corpo)).not.toContain('senhaHash');
  });

  it('aceita e-mail com maiúsculas e espaços', async () => {
    const res = await login({ email: '  Victor@Exemplo.com ', senha: 'senhaSegura123' });
    expect(res.status).toBe(200);
  });

  it('recusa senha errada sem dizer qual campo falhou', async () => {
    const res = await login({ email: 'victor@exemplo.com', senha: 'errada123' });
    expect(res.status).toBe(401);
    expect((await res.json()).erro).toBe('E-mail ou senha inválidos');
  });

  it('recusa e-mail inexistente', async () => {
    const res = await login({ email: 'ninguem@exemplo.com', senha: 'senhaSegura123' });
    expect(res.status).toBe(401);
  });

  it('exige os dois campos', async () => {
    expect((await login({ email: 'victor@exemplo.com' })).status).toBe(400);
    expect((await login({ senha: 'senhaSegura123' })).status).toBe(400);
  });
});

describe('rotas protegidas', () => {
  it('recusam requisição sem sessão', async () => {
    const res = await fetch(`${base}/dashboard/data`);
    expect(res.status).toBe(401);
  });

  it('recusam token de sessão inválido', async () => {
    const res = await fetch(`${base}/dashboard/data`, {
      headers: { Authorization: 'Bearer forjado.forjado' },
    });
    expect(res.status).toBe(401);
  });

  it('não aceitam mais token em query param', async () => {
    const res = await fetch(`${base}/dashboard/data?token=qualquer-token`);
    expect(res.status).toBe(401);
  });

  it('liberam acesso com a sessão do login', async () => {
    const { token } = await (await login({ email: 'victor@exemplo.com', senha: 'senhaSegura123' })).json();

    const res = await fetch(`${base}/dashboard/eu`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect((await res.json()).usuario).toMatchObject({ email: 'victor@exemplo.com', superAdmin: true });
  });
});
