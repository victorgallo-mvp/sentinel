import DateRangePicker from './DateRangePicker.jsx';
import './CockpitBar.css';

const VERD_ARROW = { melhorou: '↑', estavel: '—', piorou: '↓' };

function fmtBRL(v) {
  return `R$ ${Math.round(v ?? 0).toLocaleString('pt-BR')}`;
}

export default function CockpitBar({ contas = [], contaSelecionada, dataInicio, dataFim, onPeriodoChange, usuario, segundos, onVoltar, modo, onModo }) {
  const atualStr = segundos < 5 ? 'agora' : `há ${segundos}s`;

  if (contaSelecionada) {
    const r = contaSelecionada.resumo ?? {};
    const nome = contaSelecionada.nome;
    const gestor = r.gerenteResponsavel;
    const vd = r.veredito;
    const alertas = r.alertas ?? [];

    return (
      <div className="cb">
        <button className="cb-back" onClick={onVoltar}>← Voltar</button>
        <span className="cb-sep" />
        <span className="cb-conta-nome">{nome}</span>
        {gestor && <span className="cb-gestor">{gestor}</span>}
        {(r.gastoHoje ?? 0) > 0 && (
          <span className="cb-kpi">{fmtBRL(r.gastoHoje)} <span className="cb-kpi-label">hoje</span></span>
        )}
        {vd && (
          <span className={`cb-kpi cb-kpi--verd cb-kpi--${vd.direcao}`}>
            {VERD_ARROW[vd.direcao]} {vd.scorePct > 0 ? '+' : ''}{vd.scorePct}% <span className="cb-kpi-label">7d</span>
          </span>
        )}
        {alertas.length > 0 && (
          <span className="cb-kpi cb-kpi--crit">
            {alertas.length} alerta{alertas.length > 1 ? 's' : ''}
          </span>
        )}
        <div className="cb-right">
          <DateRangePicker dataInicio={dataInicio} dataFim={dataFim} onChange={onPeriodoChange} />
          <span className="cb-refresh">{atualStr}</span>
        </div>
      </div>
    );
  }

  // Visão geral — agrega todas as contas
  const gastoTotal = contas.reduce((s, c) => s + (c.resumo?.gastoHoje ?? 0), 0);
  const nProblema  = contas.filter((c) => c.resumo?.status === 'critico').length;
  const nAlerta    = contas.filter((c) => (c.resumo?.alertas?.length ?? 0) > 0 && c.resumo?.status !== 'critico').length;
  const tudo_ok    = nProblema === 0 && nAlerta === 0;

  return (
    <div className="cb">
      {/* Abas de modo */}
      <nav className="cb-nav">
        <button
          className={`cb-tab${modo === 'monitoramento' ? ' cb-tab--ativo' : ''}`}
          onClick={() => onModo?.('monitoramento')}
        >Monitoramento</button>
        <button
          className={`cb-tab${modo === 'dashboard' ? ' cb-tab--ativo' : ''}`}
          onClick={() => onModo?.('dashboard')}
        >Dashboard</button>
      </nav>

      <span className="cb-sep" />

      {/* KPIs agregados */}
      {gastoTotal > 0 && (
        <span className="cb-kpi">{fmtBRL(gastoTotal)} <span className="cb-kpi-label">hoje</span></span>
      )}
      {nProblema > 0 && (
        <span className="cb-kpi cb-kpi--crit">{nProblema} problema{nProblema > 1 ? 's' : ''}</span>
      )}
      {nAlerta > 0 && (
        <span className="cb-kpi cb-kpi--warn">{nAlerta} alerta{nAlerta > 1 ? 's' : ''}</span>
      )}
      {tudo_ok && <span className="cb-kpi cb-kpi--ok">✓ tudo ok</span>}

      <div className="cb-right">
        <DateRangePicker dataInicio={dataInicio} dataFim={dataFim} onChange={onPeriodoChange} />
        {usuario?.nome && <span className="cb-usuario">{usuario.nome}</span>}
        <span className="cb-refresh">{atualStr}</span>
      </div>
    </div>
  );
}
