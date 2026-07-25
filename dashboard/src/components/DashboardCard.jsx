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

const CHAVE_TO_METRICA = {
  mensagem:  'messaging_conversations_started',
  conversao: 'conversions',
  lead:      'leads',
  trafego:   'clicks',
  alcance:   'reach',
};

function fmtContagem(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.0', '')}k`;
  return String(Math.round(n));
}

function metaAlvoPeriodo(meta, dias) {
  if (meta.janela === '1d')  return meta.valor * dias;
  if (meta.janela === '7d')  return meta.valor * (dias / 7);
  if (meta.janela === '30d') return meta.valor * (dias / 30);
  return meta.valor * dias;
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

export default function DashboardCard({ conta, customName, notificacoesConta, isSelected, onClick, periodo = { label: 'hoje', dias: 1 } }) {
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

  const objetivos    = (conta.perfil?.objetivos ?? []).slice().sort((a, b) => a.ordem - b.ordem);
  const primObj      = objetivos[0] ?? null;

  // resultadosPeriodo: contagens do período selecionado (period-aware)
  const resultadoMap = Object.fromEntries(
    (r.resultadosPeriodo ?? []).map((d) => [d.chave, d])
  );

  // Meta do objetivo principal vs. período selecionado
  const primMetrica  = primObj ? CHAVE_TO_METRICA[primObj.chave] : null;
  const primMetaDef  = primMetrica
    ? (conta.perfil?.metasPersonalizadas ?? []).find((m) => m.metrica === primMetrica && m.ativo && m.operador === 'acima_de')
    : null;
  const primRes      = primObj ? resultadoMap[primObj.chave] : null;
  const primMetaAlvo = primMetaDef ? Math.round(metaAlvoPeriodo(primMetaDef, periodo.dias)) : null;
  const primAtual    = primMetaDef ? (primRes?.valor ?? 0) : null; // 0 quando sem resultados mas com meta
  const primPct      = primMetaAlvo > 0 && primAtual != null
    ? Math.min(Math.round((primAtual / primMetaAlvo) * 100), 150)
    : null;
  const primTom      = primPct == null ? null : primPct >= 100 ? 'ok' : primPct >= 60 ? 'warn' : 'crit';
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
            {primRes?.valor > 0 ? ` · ${fmtContagem(primRes.valor)}` : ''}
          </span>
          {objetivos.length > 1 && (
            <span className="dc-obj-extra">+{objetivos.length - 1}</span>
          )}
        </div>
      )}

      {/* Meta de resultado */}
      {primMetaAlvo != null && primAtual != null && (
        <div className="dc-meta-row">
          <div className="dc-meta-track">
            <div
              className={`dc-meta-fill dc-meta-fill--${primTom}`}
              style={{ width: `${Math.min(primPct ?? 0, 100)}%` }}
            />
          </div>
          <span className={`dc-meta-label dc-meta-label--${primTom}`}>
            {fmtContagem(primAtual)}/{fmtContagem(primMetaAlvo)} · {primPct ?? 0}%
          </span>
        </div>
      )}

      {/* Gasto hoje + veredito */}
      <div className="dc-body">
        <div className="dc-gasto">
          <span className="dc-gasto-valor">{gastoHoje > 0 ? fmtBRL(gastoHoje) : '—'}</span>
          <span className="dc-gasto-label">{periodo.label}</span>
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
