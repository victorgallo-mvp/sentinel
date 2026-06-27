import { useState } from 'react';
import './Footer.css';

function IconChevron() {
  return (
    <svg className="footer-chevron" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 15l6-6 6 6" />
    </svg>
  );
}

export default function Footer({ stats }) {
  const [aberto, setAberto] = useState(false);

  const itens = [
    { label: 'Contas monitoradas', value: stats.totalContas },
    { label: 'Entidades ativas', value: stats.totalEntidades },
    { label: 'Anomalias (24h)', value: stats.anomalias24h, tom: stats.anomalias24h > 0 ? 'warn' : null },
    { label: 'Investigações (24h)', value: stats.investigacoes24h },
    { label: 'Notificações (24h)', value: stats.notificacoes24h },
  ];
  if (stats.errosEnvio24h > 0) {
    itens.push({ label: 'Falhas de envio (24h)', value: stats.errosEnvio24h, tom: 'crit' });
  }

  return (
    <footer className={`footer ${aberto ? 'is-open' : ''}`}>
      {aberto && (
        <div className="footer-stats">
          {itens.map((it) => (
            <div className="footer-stat" key={it.label}>
              <span className={`footer-stat-value ${it.tom ? `footer-stat-value--${it.tom}` : ''}`}>{it.value}</span>
              <span className="footer-stat-label">{it.label}</span>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        className="footer-toggle"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
      >
        <span className="footer-toggle-left">
          <IconChevron />
          Resumo do sistema
        </span>
        {!aberto && (
          <span className="footer-flags">
            {stats.anomalias24h > 0 && (
              <span className="footer-flag footer-flag--warn">{stats.anomalias24h} anomalias</span>
            )}
            {stats.errosEnvio24h > 0 && (
              <span className="footer-flag footer-flag--crit">{stats.errosEnvio24h} falhas</span>
            )}
          </span>
        )}
      </button>
    </footer>
  );
}
