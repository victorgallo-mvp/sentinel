import DateRangePicker from './DateRangePicker.jsx';
import './Header.css';

function IconShield() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
    </svg>
  );
}

export default function Header({ ultimaAtualizacao, segundos, usuario, dataInicio, dataFim, onPeriodoChange }) {
  const atualStr = ultimaAtualizacao
    ? segundos < 5
      ? 'agora mesmo'
      : `atualizado há ${segundos}s`
    : '—';

  return (
    <header className="header">
      <div className="header-top">
        <div className="header-brand">
          <span className="header-shield"><IconShield /></span>
          <span className="header-title">Sentinela Ads</span>
        </div>
        <div className="header-top-right">
          <DateRangePicker
            dataInicio={dataInicio}
            dataFim={dataFim}
            onChange={onPeriodoChange}
          />
          {usuario?.nome && (
            <span className="header-usuario">{usuario.nome}</span>
          )}
          <span className="header-refresh">{atualStr}</span>
        </div>
      </div>
    </header>
  );
}
