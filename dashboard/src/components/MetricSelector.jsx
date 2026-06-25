import { useState, useEffect } from 'react';
import './MetricSelector.css';

const API_URL = import.meta.env.VITE_API_URL ?? '';

function getToken() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('token');
  if (fromUrl) return fromUrl;
  return sessionStorage.getItem('dash_token') ?? '';
}

export default function MetricSelector({ contaId, selecionadas = [], onClose, onSalvo }) {
  const [catalogo, setCatalogo]   = useState([]);
  const [escolhidas, setEscolhidas] = useState(new Set(selecionadas));
  const [salvando, setSalvando]   = useState(false);
  const [erro, setErro]           = useState(null);

  useEffect(() => {
    const token = getToken();
    fetch(`${API_URL}/dashboard/metricas/catalogo?token=${token}`)
      .then((r) => r.json())
      .then((d) => setCatalogo(d.catalogo ?? []))
      .catch(() => setErro('Falha ao carregar catálogo'));
  }, []);

  function toggle(chave) {
    setEscolhidas((prev) => {
      const next = new Set(prev);
      next.has(chave) ? next.delete(chave) : next.add(chave);
      return next;
    });
  }

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/dashboard/contas/${contaId}/metricas?token=${token}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metricasSelecionadas: [...escolhidas] }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      onSalvo([...escolhidas]);
      onClose();
    } catch {
      setErro('Falha ao salvar. Tente novamente.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="ms-overlay" onClick={onClose}>
      <div className="ms-panel" onClick={(e) => e.stopPropagation()}>
        <div className="ms-header">
          <h3>Métricas exibidas</h3>
          <button className="ms-close" onClick={onClose}>×</button>
        </div>
        <p className="ms-sub">
          {escolhidas.size === 0
            ? 'Usando padrão por objetivo (todas as relevantes)'
            : `${escolhidas.size} métrica${escolhidas.size !== 1 ? 's' : ''} selecionada${escolhidas.size !== 1 ? 's' : ''}`}
        </p>

        {catalogo.length === 0 && !erro && <p className="ms-loading">Carregando...</p>}
        {erro && <p className="ms-erro">{erro}</p>}

        <div className="ms-lista">
          {catalogo.map((m) => (
            <label key={m.chave} className={`ms-item ${escolhidas.has(m.chave) ? 'ms-item--on' : ''}`}>
              <input
                type="checkbox"
                checked={escolhidas.has(m.chave)}
                onChange={() => toggle(m.chave)}
              />
              <span className="ms-nome">{m.nome}</span>
              <span className="ms-unidade">{m.unidade}</span>
            </label>
          ))}
        </div>

        <div className="ms-footer">
          {escolhidas.size > 0 && (
            <button className="ms-btn ms-btn--limpar" onClick={() => setEscolhidas(new Set())}>
              Usar padrão
            </button>
          )}
          <button className="ms-btn ms-btn--salvar" onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
