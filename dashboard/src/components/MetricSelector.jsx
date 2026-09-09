import { useState, useEffect } from 'react';
import { apiFetch } from '../api.js';
import './MetricSelector.css';

export default function MetricSelector({ contaId, selecionadas = [], onClose, onSalvo }) {
  const [catalogo, setCatalogo]   = useState([]);
  const [escolhidas, setEscolhidas] = useState(new Set(selecionadas));
  const [salvando, setSalvando]   = useState(false);
  const [erro, setErro]           = useState(null);

  useEffect(() => {
    apiFetch('/dashboard/metricas/catalogo')
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
      await apiFetch(`/dashboard/contas/${contaId}/metricas`, {
        method: 'PATCH',
        body: JSON.stringify({ metricasSelecionadas: [...escolhidas] }),
      });
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
