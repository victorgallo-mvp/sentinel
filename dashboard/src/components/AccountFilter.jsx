import { useState, useRef, useEffect } from 'react';
import './AccountFilter.css';

export default function AccountFilter({ contas, selectedIds, customNames, onToggle, onRename, onSelectAll }) {
  const [editandoId, setEditandoId] = useState(null);
  const [valorEdit, setValorEdit] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (editandoId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editandoId]);

  function iniciarEdicao(conta) {
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
    <div className="af-panel">
      <div className="af-header">
        <span className="af-titulo">Contas visíveis</span>
        <button className="af-btn-tudo" onClick={onSelectAll}>
          {todasSelecionadas ? 'Desmarcar todas' : 'Selecionar todas'}
        </button>
      </div>

      <ul className="af-lista">
        {contas.map((conta) => {
          const ativa = selectedIds.includes(conta.id);
          const nomeExibido = customNames[conta.id] ?? conta.nomeOriginal;

          return (
            <li key={conta.id} className={`af-item ${ativa ? 'ativa' : 'inativa'}`}>
              <label className="af-check-label">
                <input
                  type="checkbox"
                  className="af-checkbox"
                  checked={ativa}
                  onChange={() => onToggle(conta.id)}
                />
                {editandoId === conta.id ? (
                  <input
                    ref={inputRef}
                    className="af-input-nome"
                    value={valorEdit}
                    onChange={(e) => setValorEdit(e.target.value)}
                    onBlur={() => confirmarEdicao(conta.id)}
                    onKeyDown={(e) => handleKeyDown(e, conta.id)}
                    onClick={(e) => e.preventDefault()}
                  />
                ) : (
                  <span className="af-nome">{nomeExibido}</span>
                )}
              </label>
              <button
                className="af-btn-renomear"
                title="Renomear"
                onClick={() => editandoId === conta.id ? confirmarEdicao(conta.id) : iniciarEdicao(conta)}
              >
                {editandoId === conta.id ? '✓' : '✏️'}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
