import { useState, useRef, useEffect } from 'react';
import './AccountCard.css';

const STATUS_COR   = { critico: '#dc2626', atencao: '#f59e0b', pausado: '#9ca3af', normal: '#16a34a' };
const STATUS_TITLE = { critico: 'Alerta ativo', atencao: 'Anomalia detectada', pausado: 'Conta pausada', normal: 'Sem alertas' };

export default function AccountCard({ conta, favorito, customName, onFavorito, onRename, onClick }) {
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
  const { gastoHoje, status, alertas = [] } = conta.resumo;

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

  function handleCardClick() {
    if (!editando && onClick) onClick(conta.id);
  }

  return (
    <div
      className={`ac-card ac-card--${status}`}
      onClick={handleCardClick}
      style={{ cursor: onClick ? 'pointer' : undefined }}
    >
      {/* ── Linha do header ── */}
      <div className="ac-header">
        {/* Status dot */}
        <span
          className="ac-status-dot"
          style={{ background: STATUS_COR[status] ?? '#9ca3af' }}
          title={STATUS_TITLE[status] ?? status}
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
            <span className="ac-nome">{nomeExibido}</span>
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
          {alertas.length > 0 && (
            <span className="ac-badge ac-badge--critico">
              {alertas.length} alerta{alertas.length !== 1 ? 's' : ''}
            </span>
          )}
          {status === 'atencao' && alertas.length === 0 && (
            <span className="ac-badge ac-badge--atencao">atenção</span>
          )}
          {status === 'pausado' && (
            <span className="ac-badge ac-badge--pausado">pausada</span>
          )}
          {status === 'normal' && (
            <span className="ac-badge ac-badge--normal">sem alertas</span>
          )}
        </div>

        {/* Indicador clicável */}
        <span className="ac-toggle">▸</span>
      </div>
    </div>
  );
}
