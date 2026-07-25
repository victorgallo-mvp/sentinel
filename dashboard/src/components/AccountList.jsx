import { useState, useMemo } from 'react';
import AccountCard from './AccountCard.jsx';
import './AccountList.css';

function IconSearch() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

const ORDEM_STATUS = { critico: 0, atencao: 1, pausado: 2, normal: 3 };

export default function AccountList({ contas, favoritos, customNames, onFavorito, onRename, contaSelecionadaId, onSelectConta, periodo }) {
  const [busca, setBusca] = useState('');
  const [sort,  setSort]  = useState('alertas');

  const contasOrdenadas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const filtradas = termo
      ? contas.filter((c) => (customNames[c.id] ?? c.nome).toLowerCase().includes(termo))
      : contas;

    return [...filtradas].sort((a, b) => {
      const aFav = favoritos.includes(a.id) ? 0 : 1;
      const bFav = favoritos.includes(b.id) ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;

      if (sort === 'alertas') {
        const ds = (ORDEM_STATUS[a.resumo.status] ?? 9) - (ORDEM_STATUS[b.resumo.status] ?? 9);
        if (ds !== 0) return ds;
        return (b.resumo.gastoHoje ?? 0) - (a.resumo.gastoHoje ?? 0);
      }
      if (sort === 'gasto') return (b.resumo.gastoHoje ?? 0) - (a.resumo.gastoHoje ?? 0);
      const nA = (customNames[a.id] ?? a.nome).toLowerCase();
      const nB = (customNames[b.id] ?? b.nome).toLowerCase();
      return nA.localeCompare(nB, 'pt-BR');
    });
  }, [contas, busca, sort, favoritos, customNames]);

  return (
    <div className="al-wrapper">
      <div className="al-toolbar">
        <div className="al-search-wrapper">
          <span className="al-search-icon"><IconSearch /></span>
          <input
            className="al-search"
            type="text"
            placeholder="Buscar conta…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          {busca && <button className="al-search-clear" onClick={() => setBusca('')}>×</button>}
        </div>
        <div className="al-sort">
          {['alertas', 'gasto', 'nome'].map((s) => (
            <button
              key={s}
              className={`al-sort-btn${sort === s ? ' ativo' : ''}`}
              onClick={() => setSort(s)}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {contasOrdenadas.length === 0 ? (
        <p className="al-vazio">Nenhuma conta para "{busca}".</p>
      ) : (
        <div className="al-lista">
          {contasOrdenadas.map((conta) => (
            <AccountCard
              key={conta.id}
              conta={conta}
              customName={customNames[conta.id] ?? null}
              onRename={onRename}
              onClick={onSelectConta}
              isSelected={conta.id === contaSelecionadaId}
              periodo={periodo}
            />
          ))}
        </div>
      )}
    </div>
  );
}
