import { useState } from 'react';
import { login } from '../api.js';
import './Login.css';

export default function Login({ onEntrar }) {
  const [email, setEmail]   = useState('');
  const [senha, setSenha]   = useState('');
  const [erro,  setErro]    = useState(null);
  const [enviando, setEnviando] = useState(false);

  async function handleSubmit(evento) {
    evento.preventDefault();
    if (enviando) return;

    setErro(null);
    setEnviando(true);
    try {
      const sessao = await login(email.trim(), senha);
      onEntrar(sessao);
    } catch (e) {
      setErro(e.message);
      setSenha('');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-marca">
          <span className="login-marca-ponto" />
          Sentinela
        </div>
        <p className="login-sub">Entre para acompanhar suas campanhas.</p>

        <label className="login-campo">
          <span>E-mail</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </label>

        <label className="login-campo">
          <span>Senha</span>
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {erro && <p className="login-erro">{erro}</p>}

        <button className="login-botao" type="submit" disabled={enviando || !email || !senha}>
          {enviando ? 'Entrando...' : 'Entrar'}
        </button>

        <p className="login-rodape">Acesso restrito. Fale com o administrador se precisar de uma conta.</p>
      </form>
    </div>
  );
}
