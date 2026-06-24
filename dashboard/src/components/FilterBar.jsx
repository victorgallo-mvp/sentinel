import { useState, useRef, useEffect } from 'react';
import './FilterBar.css';

const NIVEIS = [
  { id: 'todos',    label: 'Todos' },
  { id: 'campaign', label: 'Campanha' },
  { id: 'adset',    label: 'Conjunto' },
  { id: 'ad',       label: 'Anúncio' },
];

export default function FilterBar({ contas, selectedIds, customNames, nivel, onToggleConta, onRename, onSelectAll, onNivel }) {
  const [editandoId, setEditandoId] = useState(null);
  const [valorEdit, setValorEdit] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (editandoId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editandoId]);

  function iniciarEdicao(e, conta) {
    e.stopPropagation();
    setEditandoId(conta.id);
    setValorEdit(customNames[conta.id] ?? conta.nomeOriginal);
  }

  function confirmarEdicao(contaId) {
    const nome = valorEdit.trim();
    if (nome) onRename(contaId, nome);
    setEditandoId(null);
  }

  function handleKeyDown(e, contaId) {
    if (e.key === 'Enter') confirmarEdicao(contaId);
    if (e.key === 'Escape') setEditandoId(null);
  }

  const todasSelecionadas = contas.every((c) => selectedIds.includes(c.id));

  return (
    <div className="filterbar">
      {/* Seletor de contas */}
      <div className="filterbar-group">
        <span className="filterbar-label">BMs</span>
        <div className="filterbar-contas">
          {contas.map((conta) => {
            const ativa = selectedIds.includes(conta.id);
            const nomeExibido = customNames[conta.id] ?? conta.nomeOriginal;
            const editando = editandoId === conta.id;

            return (
              <div
                key={conta.id}
                className={`fb-chip ${ativa ? 'ativa' : 'inativa'}`}
                onClick={() => !editando && onToggleConta(conta.id)}
                title={ativa ? 'Clique para ocultar' : 'Clique para exibir'}
              >
                <span className="fb-chip-dot" />
                {editando ? (
                  <input
                    ref={inputRef}
                    className="fb-chip-input"
                    value={valorEdit}
                    onChange={(e) => setValorEdit(e.target.value)}
                    onBlur={() => confirmarEdicao(conta.id)}
                    onKeyDown={(e) => handleKeyDown(e, conta.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="fb-chip-nome">{nomeExibido}</span>
                )}
                <button
                  className="fb-chip-edit"
                  title="Renomear"
                  onClick={(e) => editando ? (e.stopPropagation(), confirmarEdicao(conta.id)) : iniciarEdicao(e, conta)}
                >
                  {editando ? '✓' : '✏'}
                </button>
              </div>
            );
          })}
          {contas.length > 1 && (
            <button className="fb-btn-all" onClick={onSelectAll} title={todasSelecionadas ? 'Ocultar todas' : 'Mostrar todas'}>
              {todasSelecionadas ? '−' : '+ Todas'}
            </button>
          )}
        </div>
      </div>

      <div className="filterbar-divider" />

      {/* Seletor de nível */}
      <div className="filterbar-group">
        <span className="filterbar-label">Nível</span>
        <div className="filterbar-niveis">
          {NIVEIS.map((n) => (
            <button
              key={n.id}
              className={`fb-nivel-btn ${nivel === n.id ? 'ativo' : ''}`}
              onClick={() => onNivel(n.id)}
            >
              {n.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
