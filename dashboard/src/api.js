/**
 * Camada de acesso à API do dashboard.
 *
 * A autenticação é por e-mail + senha: `login()` troca as credenciais por um
 * token de sessão, guardado no localStorage e enviado em toda requisição no
 * header `Authorization: Bearer <token>`. Nada de token na URL.
 */
const API_URL = import.meta.env.VITE_API_URL ?? '';

const LS_SESSAO = 'sentinela_sessao';

/** Erro de requisição que carrega o status HTTP (401 = sessão caiu). */
export class ErroApi extends Error {
  constructor(mensagem, status) {
    super(mensagem);
    this.name = 'ErroApi';
    this.status = status;
  }
}

export function lerSessao() {
  try {
    const bruto = localStorage.getItem(LS_SESSAO);
    if (!bruto) return null;
    const sessao = JSON.parse(bruto);
    if (!sessao?.token) return null;
    if (sessao.expiraEm && new Date(sessao.expiraEm) <= new Date()) {
      localStorage.removeItem(LS_SESSAO);
      return null;
    }
    return sessao;
  } catch {
    return null;
  }
}

function gravarSessao(sessao) {
  try { localStorage.setItem(LS_SESSAO, JSON.stringify(sessao)); } catch {}
}

export function encerrarSessao() {
  try { localStorage.removeItem(LS_SESSAO); } catch {}
}

/** Autentica com e-mail e senha e guarda a sessão. */
export async function login(email, senha) {
  let res;
  try {
    res = await fetch(`${API_URL}/dashboard/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha }),
    });
  } catch {
    throw new ErroApi('Não foi possível conectar ao servidor.', 0);
  }

  const corpo = await res.json().catch(() => ({}));
  if (!res.ok) throw new ErroApi(corpo.erro ?? 'Não foi possível entrar.', res.status);

  const sessao = { token: corpo.token, expiraEm: corpo.expiraEm, usuario: corpo.usuario };
  gravarSessao(sessao);
  return sessao;
}

/**
 * `fetch` autenticado para as rotas do dashboard.
 * Lança ErroApi em respostas de erro; um 401 já limpa a sessão local.
 */
export async function apiFetch(caminho, opcoes = {}) {
  const sessao = lerSessao();
  const headers = { ...(opcoes.headers ?? {}) };
  if (sessao?.token) headers.Authorization = `Bearer ${sessao.token}`;
  if (opcoes.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(`${API_URL}${caminho}`, { ...opcoes, headers });
  } catch {
    throw new ErroApi('Não foi possível conectar ao servidor.', 0);
  }

  if (res.status === 401) {
    encerrarSessao();
    throw new ErroApi('Sessão expirada. Entre novamente.', 401);
  }

  if (!res.ok) {
    const corpo = await res.json().catch(() => ({}));
    throw new ErroApi(corpo.erro ?? `Erro ${res.status}`, res.status);
  }

  return res.json();
}
