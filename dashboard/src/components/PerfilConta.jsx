import { useState } from 'react';
import './PerfilConta.css';

const API_URL = import.meta.env.VITE_API_URL ?? '';

function getToken() {
  const params = new URLSearchParams(window.location.search);
  return params.get('token') ?? sessionStorage.getItem('dash_token') ?? '';
}

// Deve casar com as chaves de OBJETIVOS em src/config/objetivos.config.js
const OBJETIVOS_OPTS = [
  { chave: 'conversao', nome: 'Conversões / Vendas' },
  { chave: 'mensagem',  nome: 'Mensagens (WhatsApp)' },
  { chave: 'lead',      nome: 'Leads / Formulário' },
  { chave: 'trafego',   nome: 'Tráfego / Cliques' },
  { chave: 'alcance',   nome: 'Alcance' },
];

/** Onboarding/perfil da conta: gerente, investimento mensal, objetivos (até 3, ordenados). */
export default function PerfilConta({ conta, onSalvo }) {
  const p = conta.perfil ?? {};
  const objInicial = (ordem) => (p.objetivos ?? []).find((o) => o.ordem === ordem)?.chave ?? '';

  const [gerente, setGerente] = useState(p.gerenteResponsavel ?? '');
  const [investimento, setInvestimento] = useState(p.investimentoMensalPlanejado ?? '');
  const [obj, setObj] = useState([objInicial(1), objInicial(2), objInicial(3)]);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState('');

  const setObjetivo = (i, v) => setObj((prev) => {
    const novo = [...prev];
    novo[i] = v;
    if (!v) for (let j = i + 1; j < 3; j++) novo[j] = ''; // limpar dependentes
    return novo;
  });

  // Opções de um slot, excluindo as já escolhidas em outros slots
  const opcoes = (idx) => OBJETIVOS_OPTS.filter((o) => !obj.some((c, j) => j !== idx && c === o.chave));

  async function salvar() {
    setSalvando(true);
    setMsg('');
    const objetivos = obj
      .map((chave, i) => (chave ? { ordem: i + 1, chave } : null))
      .filter(Boolean);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/dashboard/contas/${conta.id}/perfil?token=${token}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gerenteResponsavel: gerente,
          investimentoMensalPlanejado: investimento === '' ? null : Number(investimento),
          objetivos,
        }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setMsg('Salvo ✓');
      onSalvo?.();
    } catch {
      setMsg('Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  }

  const rotulos = ['Objetivo principal', 'Objetivo secundário', 'Objetivo terciário'];

  return (
    <div className="pc-form">
      <div className="pc-linha">
        <label className="pc-campo">
          <span>Gerente responsável</span>
          <input value={gerente} onChange={(e) => setGerente(e.target.value)} placeholder="Nome do gestor" />
        </label>
        <label className="pc-campo">
          <span>Investimento mensal (R$)</span>
          <input
            type="number" min="0" step="100"
            value={investimento}
            onChange={(e) => setInvestimento(e.target.value)}
            placeholder="ex.: 5000"
          />
        </label>
      </div>

      <div className="pc-objetivos">
        {[0, 1, 2].map((i) => (
          <label key={i} className="pc-campo">
            <span>{rotulos[i]}</span>
            <select
              value={obj[i]}
              disabled={i > 0 && !obj[i - 1]}
              onChange={(e) => setObjetivo(i, e.target.value)}
            >
              <option value="">{i === 0 ? 'Selecione…' : '(nenhum)'}</option>
              {opcoes(i).map((o) => (
                <option key={o.chave} value={o.chave}>{o.nome}</option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <div className="pc-acao">
        <button className="pc-salvar" onClick={salvar} disabled={salvando}>
          {salvando ? 'Salvando…' : 'Salvar perfil'}
        </button>
        {msg && <span className="pc-msg">{msg}</span>}
      </div>
    </div>
  );
}
