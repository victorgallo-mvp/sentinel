import { useState, useMemo } from 'react';
import AccountCard from './AccountCard.jsx';
import AccountModal from './AccountModal.jsx';
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

const SORTS = [
  { id: 'alertas', label: 'Alertas' },
  { id: 'gasto',   label: 'Gasto' },
  { id: 'nome',    label: 'Nome' },
];

export default function AccountList({ contas, favoritos, customNames, onFavorito, onRename, onRefresh }) {
  const [busca, setBusca]             = useState('');
  const [sort,  setSort]              = useState('alertas');
  const [openModalContaId, setOpenModalContaId] = useState(null);

  const contaModal = openModalContaId ? contas.find((c) => c.id === openModalContaId) ?? null : null;

  const contasOrdenadas = useMemo(() => {
    const termoBusca = busca.trim().toLowerCase();

    const filtradas = termoBusca
      ? contas.filter((c) => {
          const nome = (customNames[c.id] ?? c.nome).toLowerCase();
          return nome.includes(termoBusca);
        })
      : contas;

    return [...filtradas].sort((a, b) => {
      const aFav = favoritos.includes(a.id) ? 0 : 1;
      const bFav = favoritos.includes(b.id) ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;

      if (sort === 'alertas') {
        const diffStatus = (ORDEM_STATUS[a.resumo.status] ?? 9) - (ORDEM_STATUS[b.resumo.status] ?? 9);
        if (diffStatus !== 0) return diffStatus;
        return (b.resumo.gastoHoje ?? 0) - (a.resumo.gastoHoje ?? 0);
      }
      if (sort === 'gasto') {
        return (b.resumo.gastoHoje ?? 0) - (a.resumo.gastoHoje ?? 0);
      }
      // nome
      const nA = (customNames[a.id] ?? a.nome).toLowerCase();
      const nB = (customNames[b.id] ?? b.nome).toLowerCase();
      return nA.localeCompare(nB, 'pt-BR');
    });
  }, [contas, busca, sort, favoritos, customNames]);

  return (
    <div className="al-wrapper">
      {/* ── Barra de busca + sort ── */}
      <div className="al-toolbar">
        <div className="al-search-wrapper">
          <span className="al-search-icon"><IconSearch /></span>
          <input
            className="al-search"
            type="text"
            placeholder="Buscar conta..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          {busca && (
            <button className="al-search-clear" onClick={() => setBusca('')} title="Limpar busca">×</button>
          )}
        </div>

        <div className="al-sort">
          <span className="al-sort-label">Ordenar:</span>
          {SORTS.map((s) => (
            <button
              key={s.id}
              className={`al-sort-btn ${sort === s.id ? 'ativo' : ''}`}
              onClick={() => setSort(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Lista de contas ── */}
      {contasOrdenadas.length === 0 ? (
        <p className="al-vazio">Nenhuma conta encontrada para "{busca}".</p>
      ) : (
        <div className="al-lista">
          {contasOrdenadas.map((conta) => (
            <AccountCard
              key={conta.id}
              conta={conta}
              favorito={favoritos.includes(conta.id)}
              customName={customNames[conta.id] ?? null}
              onFavorito={onFavorito}
              onRename={onRename}
              onClick={(id) => setOpenModalContaId(id)}
            />
          ))}
        </div>
      )}

      {/* ── Modal de conta ── */}
      {contaModal && (
        <AccountModal
          conta={contaModal}
          customName={customNames[contaModal.id] ?? null}
          onClose={() => setOpenModalContaId(null)}
          onMetricasSalvas={onRefresh}
          onRefresh={onRefresh}
        />
      )}
    </div>
  );
}
