import './DashboardCard.css';

const SALDO_ORDEM = { zerado: 0, bloqueado: 1, critico: 2, acabando: 3, ok: 4 };
const VERD = { melhorou: { s: '↑', cls: 'ok' }, estavel: { s: '—', cls: 'muted' }, piorou: { s: '↓', cls: 'crit' } };

const OBJ_LABEL = {
  conversao: 'Conversões',
  mensagem:  'Conversas',
  lead:      'Leads',
  trafego:   'Cliques',
  alcance:   'Alcance',
};

function fmtContagem(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.0', '')}k`;
  return String(Math.round(n));
}

function piorSaldo(lista) {
  if (!lista?.length) return null;
  return [...lista].sort((a, b) => (SALDO_ORDEM[a.nivel] ?? 9) - (SALDO_ORDEM[b.nivel] ?? 9))[0];
}

function fmtRunway(h) {
  if (h == null) return null;
  const v = Math.max(0, Math.round(h));
  return v < 24 ? `${v}h` : `${Math.floor(v / 24)}d`;
}

function saldoInfo(s) {
  const rw = fmtRunway(s.runwayHoras);
  switch (s.nivel) {
    case 'zerado':    return { txt: 'Saldo zero',    cls: 'crit' };
    case 'bloqueado': return { txt: 'Bloqueada',     cls: 'crit' };
    case 'critico':   return { txt: rw ? `~${rw}` : 'Crítico',  cls: 'crit' };
    case 'acabando':  return { txt: rw ? `~${rw}` : 'Baixo',    cls: 'warn' };
    default:          return null;
  }
}

function fmtBRL(v) {
  return `R$ ${Math.round(v ?? 0).toLocaleString('pt-BR')}`;
}

export default function DashboardCard({ conta, customName, notificacoesConta, isSelected, onClick }) {
  const nome    = customName ?? conta.nome;
  const gestor  = conta.perfil?.gerenteResponsavel;
  const r       = conta.resumo ?? {};
  const {
    gastoHoje = 0, gastoMes = 0, investimentoMensalPlanejado,
    alertas = [], saldoPrepago = [], veredito,
  } = r;

  const saldo    = piorSaldo(saldoPrepago);
  const saldoI   = saldo ? saldoInfo(saldo) : null;
  const temPlano = (investimentoMensalPlanejado ?? 0) > 0;

  const objetivos   = (conta.perfil?.objetivos ?? []).slice().sort((a, b) => a.ordem - b.ordem);
  const primObj     = objetivos[0] ?? null;
  const detalhesMap = Object.fromEntries((veredito?.detalhes ?? []).map((d) => [d.chave, d]));
  const pctMes   = temPlano ? Math.min(Math.round((gastoMes / investimentoMensalPlanejado) * 100), 100) : null;
  const barCls   = pctMes == null ? 'ok' : pctMes >= 100 ? 'crit' : pctMes >= 80 ? 'warn' : 'ok';
  const vd       = veredito ? VERD[veredito.direcao] : null;

  return (
    <div
      className={`dc-card${isSelected ? ' dc-card--selected' : ''}`}
      onClick={() => onClick?.(conta.id)}
    >
      {/* Nome + gestor */}
      <div className="dc-header">
        <span className="dc-nome">{nome}</span>
        {gestor && <span className="dc-gestor">{gestor}</span>}
      </div>

      {/* Objetivo principal */}
      {primObj && (
        <div className="dc-obj-row">
          <span className="dc-obj-pill">
            {OBJ_LABEL[primObj.chave] ?? primObj.chave}
            {detalhesMap[primObj.chave]?.atual > 0
              ? ` · ${fmtContagem(detalhesMap[primObj.chave].atual)}`
              : ''}
          </span>
          {objetivos.length > 1 && (
            <span className="dc-obj-extra">+{objetivos.length - 1}</span>
          )}
        </div>
      )}

      {/* Gasto hoje + veredito */}
      <div className="dc-body">
        <div className="dc-gasto">
          <span className="dc-gasto-valor">{gastoHoje > 0 ? fmtBRL(gastoHoje) : '—'}</span>
          <span className="dc-gasto-label">hoje</span>
        </div>
        {vd && (
          <span className={`dc-verd dc-verd--${vd.cls}`}>
            {vd.s} {veredito.scorePct > 0 ? '+' : ''}{veredito.scorePct}%
          </span>
        )}
      </div>

      {/* Barra de meta */}
      {temPlano && (
        <div className="dc-progress">
          <div className="dc-progress-track">
            <div className={`dc-progress-fill dc-progress-fill--${barCls}`} style={{ width: `${pctMes}%` }} />
          </div>
          <div className="dc-progress-label">
            <span>Meta {pctMes}%</span>
            <span>{fmtBRL(gastoMes)} / {fmtBRL(investimentoMensalPlanejado)}</span>
          </div>
        </div>
      )}

      {/* Rodapé: saldo + alertas */}
      {(saldoI || alertas.length > 0) && (
        <div className="dc-footer">
          {saldoI && <span className={`dc-saldo dc-saldo--${saldoI.cls}`}>{saldoI.txt}</span>}
          {alertas.length > 0 && (
            <span className="dc-alertas">{alertas.length} alerta{alertas.length > 1 ? 's' : ''}</span>
          )}
        </div>
      )}
    </div>
  );
}
