import './Header.css';

export default function Header({ stats, ultimaAtualizacao, segundos }) {
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
        <span className="header-refresh">{atualStr}</span>
      </div>

      <div className="stat-cards">
        <StatCard label="Contas monitoradas" value={stats.totalContas} />
        <StatCard label="Entidades ativas" value={stats.totalEntidades} />
        <StatCard
          label="Anomalias (24h)"
          value={stats.anomalias24h}
          cor={stats.anomalias24h > 0 ? '#f0883e' : '#3fb950'}
        />
        <StatCard
          label="Investigações (24h)"
          value={stats.investigacoes24h}
          cor={stats.investigacoes24h > 0 ? '#58a6ff' : '#7d8590'}
        />
        <StatCard
          label="Notificações (24h)"
          value={stats.notificacoes24h}
          cor={stats.notificacoes24h > 0 ? '#58a6ff' : '#7d8590'}
        />
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
