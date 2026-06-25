import { useState, useRef, useEffect } from 'react';
import HierarchyView from './HierarchyView.jsx';
import './AccountCard.css';

const NIVEIS = [
  { id: 'todos',    label: 'Todos' },
  { id: 'campaign', label: 'Campanha' },
  { id: 'adset',    label: 'Conjunto' },
  { id: 'ad',       label: 'Anúncio' },
];

const STATUS_COR   = { critico: '#dc2626', atencao: '#f59e0b', normal: '#16a34a' };
const STATUS_TITLE = { critico: 'Alerta ativo', atencao: 'Anomalia detectada', normal: 'Sem alertas' };

export default function AccountCard({ conta, favorito, customName, onFavorito, onRename }) {
  const [expandido, setExpandido] = useState(false);
  const [nivel, setNivel]         = useState('todos');
  const [editando, setEditando]   = useState(false);
  const [valorEdit, setValorEdit] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (editando && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editando]);

  const nomeExibido = customName ?? conta.nome;
  const { gastoHoje, anomalias24h, notificacoes24h, status } = conta.resumo;

  function iniciarEdicao(e) {
    e.stopPropagation();
    setValorEdit(nomeExibido);
    setEditando(true);
  }

  function confirmarEdicao() {
    const nome = valorEdit.trim();
    if (nome) onRename(conta.id, nome);
    setEditando(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') confirmarEdicao();
    if (e.key === 'Escape') setEditando(false);
  }

  return (
    <div className={`ac-card ac-card--${status} ${expandido ? 'ac-card--expandido' : ''}`}>
      {/* ── Linha do header ── */}
      <div className="ac-header" onClick={() => !editando && setExpandido((v) => !v)}>
        {/* Status dot */}
        <span
          className="ac-status-dot"
          style={{ background: STATUS_COR[status] }}
          title={STATUS_TITLE[status]}
        />

        {/* Favorito */}
        <button
          className="ac-favorito"
          onClick={(e) => { e.stopPropagation(); onFavorito(conta.id); }}
          title={favorito ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
        >
          {favorito ? '★' : '☆'}
        </button>

        {/* Nome (editável) */}
        <div className="ac-nome-wrapper" onClick={(e) => e.stopPropagation()}>
          {editando ? (
            <input
              ref={inputRef}
              className="ac-nome-input"
              value={valorEdit}
              onChange={(e) => setValorEdit(e.target.value)}
              onBlur={confirmarEdicao}
              onKeyDown={handleKeyDown}
            />
          ) : (
            <span className="ac-nome" onClick={() => setExpandido((v) => !v)}>
              {nomeExibido}
            </span>
          )}
          <button className="ac-rename-btn" onClick={iniciarEdicao} title="Renomear">✏</button>
        </div>

        {/* Resumo */}
        <div className="ac-resumo">
          {gastoHoje > 0 && (
            <span className="ac-resumo-gasto">
              R$ {gastoHoje.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </span>
          )}
          {notificacoes24h > 0 && (
            <span className="ac-badge ac-badge--critico">
              {notificacoes24h} alerta{notificacoes24h !== 1 ? 's' : ''}
            </span>
          )}
          {anomalias24h > 0 && notificacoes24h === 0 && (
            <span className="ac-badge ac-badge--atencao">
              {anomalias24h} anomalia{anomalias24h !== 1 ? 's' : ''}
            </span>
          )}
          {status === 'normal' && (
            <span className="ac-badge ac-badge--normal">sem alertas</span>
          )}
        </div>

        {/* Toggle */}
        <span className="ac-toggle">{expandido ? '▾' : '▸'}</span>
      </div>

      {/* ── Conteúdo expandido ── */}
      {expandido && (
        <div className="ac-body">
          <div className="ac-niveis">
            {NIVEIS.map((n) => (
              <button
                key={n.id}
                className={`ac-nivel-btn ${nivel === n.id ? 'ativo' : ''}`}
                onClick={() => setNivel(n.id)}
              >
                {n.label}
              </button>
            ))}
          </div>
          <HierarchyView entidades={conta.entidades} nivel={nivel} />
        </div>
      )}
    </div>
  );
}
