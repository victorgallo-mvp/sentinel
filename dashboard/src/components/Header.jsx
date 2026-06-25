import './Header.css';

const PERIODOS = [
  { id: 'hoje',  label: 'Hoje' },
  { id: 'ontem', label: 'Ontem' },
];

export default function Header({ stats, ultimaAtualizacao, segundos, usuario, periodo, onPeriodoChange }) {
  const atualStr = ultimaAtualizacao
    ? segundos < 5
      ? 'agora mesmo'
      : `atualizado há ${segundos}s`
    : '—';

  return (
    <header className="header">
      <div className="header-top">
        <div className="header-brand">
          <span className="header-shield">🛡</span>
          <span className="header-title">Sentinela Ads</span>
        </div>
        <div className="header-top-right">
          <div className="header-periodo">
            {PERIODOS.map((p) => (
              <button
                key={p.id}
                className={`header-periodo-btn ${periodo === p.id ? 'ativo' : ''}`}
                onClick={() => onPeriodoChange?.(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
          {usuario?.nome && (
            <span className="header-usuario">{usuario.nome}</span>
          )}
          <span className="header-refresh">{atualStr}</span>
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
