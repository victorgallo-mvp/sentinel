import { useState, useEffect, useRef } from 'react';
import AccountFilter from './AccountFilter.jsx';
import './Header.css';

export default function Header({ stats, ultimaAtualizacao, segundos, contas, selectedIds, customNames, onToggle, onRename, onSelectAll }) {
  const [filtroAberto, setFiltroAberto] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (!filtroAberto) return;
    function handleClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setFiltroAberto(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [filtroAberto]);

  const atualStr = ultimaAtualizacao
    ? segundos < 5
      ? 'agora mesmo'
      : `atualizado há ${segundos}s`
    : '—';

  const totalContas = contas?.length ?? 0;
  const contasVisiveis = selectedIds?.length ?? totalContas;
  const filtroAtivo = contasVisiveis < totalContas;

  return (
    <header className="header">
      <div className="header-top">
        <div className="header-brand">
          <span className="header-shield">🛡</span>
          <span className="header-title">Sentinela Ads</span>
        </div>
        <div className="header-actions">
          <span className="header-refresh">{atualStr}</span>
          {contas?.length > 1 && (
            <div className="header-filter-wrapper" ref={wrapperRef}>
              <button
                className={`header-filter-btn ${filtroAtivo ? 'ativo' : ''}`}
                onClick={() => setFiltroAberto((v) => !v)}
                title="Filtrar contas"
              >
                <span className="filter-icon">⚙</span>
                <span className="filter-label">
                  {filtroAtivo ? `${contasVisiveis} de ${totalContas}` : 'Contas'}
                </span>
              </button>
              {filtroAberto && (
                <div className="header-filter-dropdown">
                  <AccountFilter
                    contas={contas}
                    selectedIds={selectedIds}
                    customNames={customNames}
                    onToggle={onToggle}
                    onRename={onRename}
                    onSelectAll={onSelectAll}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="stat-cards">
        <StatCard label="Contas monitoradas" value={stats.totalContas} />
        <StatCard label="Entidades ativas" value={stats.totalEntidades} />
        <StatCard
          label="Anomalias (24h)"
          value={stats.anomalias24h}
          cor={stats.anomalias24h > 0 ? '#ea580c' : '#16a34a'}
        />
        <StatCard
          label="Investigações (24h)"
          value={stats.investigacoes24h}
          cor={stats.investigacoes24h > 0 ? '#2563eb' : '#6b7280'}
        />
        <StatCard
          label="Notificações (24h)"
          value={stats.notificacoes24h}
          cor={stats.notificacoes24h > 0 ? '#2563eb' : '#6b7280'}
        />
        {stats.errosEnvio24h > 0 && (
          <StatCard
            label="Falhas de envio (24h)"
            value={stats.errosEnvio24h}
            cor="#dc2626"
          />
        )}
      </div>
    </header>
  );
}

function StatCard({ label, value, cor }) {
  return (
    <div className="stat-card">
      <span className="stat-value" style={cor ? { color: cor } : undefined}>{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
