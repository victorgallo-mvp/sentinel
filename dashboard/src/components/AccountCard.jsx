import { useState, useRef, useEffect } from 'react';
import './AccountCard.css';

const SALDO_ORDEM = { zerado: 0, bloqueado: 1, critico: 2, acabando: 3, ok: 4 };
const SALDO_TOM   = { zerado: 'crit', bloqueado: 'crit', critico: 'crit', acabando: 'warn', ok: 'muted' };

const OBJ_LABEL = {
  conversao: 'Conversões',
  mensagem:  'Conversas',
  lead:      'Leads',
  trafego:   'Cliques',
  alcance:   'Alcance',
};

// Mapeia objetivo → metrica raw (para cruzar com metasPersonalizadas)
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

// Alvo da meta para o período selecionado (n dias)
function metaAlvoPeriodo(meta, dias) {
  if (meta.janela === '1d')  return meta.valor * dias;
  if (meta.janela === '7d')  return meta.valor * (dias / 7);
  if (meta.janela === '30d') return meta.valor * (dias / 30);
  return meta.valor * dias;
}

const VEREDITO_UI = {
  melhorou: { arrow: '↑', tom: 'ok' },
  estavel:  { arrow: '—', tom: 'muted' },
  piorou:   { arrow: '↓', tom: 'crit' },
};

function piorSaldo(lista) {
  if (!lista?.length) return null;
  return [...lista].sort((a, b) => (SALDO_ORDEM[a.nivel] ?? 9) - (SALDO_ORDEM[b.nivel] ?? 9))[0];
}

function textoSaldo(s) {
  const h = s.runwayHoras != null ? Math.max(0, Math.round(s.runwayHoras)) : null;
  const runway = h != null ? (h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`) : null;
  switch (s.nivel) {
    case 'zerado':    return 'saldo zerado';
    case 'bloqueado': return 'conta bloqueada';
    case 'critico':   return runway ? `~${runway} de saldo` : 'saldo crítico';
    case 'acabando':  return runway ? `~${runway} restantes` : 'saldo baixo';
    default:          return null;
  }
}

function IconPencil() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h4l10-10a2 2 0 0 0-3-3L5 17z" />
    </svg>
  );
}

export default function AccountCard({ conta, customName, onRename, onClick, isSelected, periodo = { label: 'hoje', dias: 1 } }) {
  const [editando,  setEditando]  = useState(false);
  const [valorEdit, setValorEdit] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (editando && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
  }, [editando]);

  const nomeExibido = customName ?? conta.nome;
  const r = conta.resumo ?? {};
  const {
    status = 'normal', alertas = [], saldoPrepago = [],
    gastoHoje, gastoMes, investimentoMensalPlanejado,
    veredito, gerenteResponsavel,
  } = r;

  const saldo    = piorSaldo(saldoPrepago);
  const saldoTxt = saldo && saldo.nivel !== 'ok' ? textoSaldo(saldo) : null;
  const saldoTom = saldo ? SALDO_TOM[saldo.nivel] ?? 'muted' : 'muted';

  const temPlano = (investimentoMensalPlanejado ?? 0) > 0;

  const objetivos = (conta.perfil?.objetivos ?? []).slice().sort((a, b) => a.ordem - b.ordem);

  // resultadosPeriodo: contagens do período selecionado (period-aware)
  const resultadoMap = Object.fromEntries(
    (r.resultadosPeriodo ?? []).map((d) => [d.chave, d])
  );

  // Progresso das metas de resultado vs. período selecionado
  const metasProgresso = (conta.perfil?.metasPersonalizadas ?? [])
    .filter((m) => m.ativo && m.operador === 'acima_de')
    .map((m) => {
      const chave = Object.entries(CHAVE_TO_METRICA).find(([, v]) => v === m.metrica)?.[0];
      if (!chave) return null;
      const res   = resultadoMap[chave];
      const atual = res?.valor ?? 0; // 0 quando ainda não há resultados no período
      const alvo  = Math.round(metaAlvoPeriodo(m, periodo.dias));
      const pct   = alvo > 0 ? Math.min(Math.round((atual / alvo) * 100), 150) : null;
      const tom   = pct == null ? 'muted' : pct >= 100 ? 'ok' : pct >= 60 ? 'warn' : 'crit';
      const rotulo = res?.rotulo ?? OBJ_LABEL[chave] ?? chave;
      return { rotulo, atual, alvo, pct, tom };
    })
    .filter(Boolean);
  const pctMes   = temPlano ? Math.min(Math.round(((gastoMes ?? 0) / investimentoMensalPlanejado) * 100), 100) : null;
  const tomBarra = pctMes == null ? 'ok' : pctMes >= 100 ? 'crit' : pctMes >= 80 ? 'warn' : 'ok';

  const vd = veredito ? VEREDITO_UI[veredito.direcao] : null;

  function iniciarEdicao(e) {
    e.stopPropagation();
    setValorEdit(nomeExibido);
    setEditando(true);
  }
  function confirmarEdicao() {
    const nome = valorEdit.trim();
    if (nome) onRename?.(conta.id, nome);
    setEditando(false);
  }
  function handleKeyDown(e) {
    if (e.key === 'Enter') confirmarEdicao();
    if (e.key === 'Escape') setEditando(false);
  }

  return (
    <div
      className={`ac-card ac-card--${status}${isSelected ? ' ac-card--selected' : ''}`}
      onClick={() => { if (!editando) onClick?.(conta.id); }}
    >
      {/* ── Cabeçalho ── */}
      <div className="ac-header">
        <span className={`ac-dot ac-dot--${status}`} />
        <div className="ac-nome-wrap">
          {editando ? (
            <input
              ref={inputRef}
              className="ac-nome-input"
              value={valorEdit}
              onChange={(e) => setValorEdit(e.target.value)}
              onBlur={confirmarEdicao}
              onKeyDown={handleKeyDown}
            />
          ) : (
            <span className="ac-nome">{nomeExibido}</span>
          )}
          <button className="ac-rename-btn" onClick={iniciarEdicao} title="Renomear">
            <IconPencil />
          </button>
        </div>
        {gerenteResponsavel && <span className="ac-gestor">{gerenteResponsavel}</span>}
      </div>

      {/* ── Objetivos ── */}
      {objetivos.length > 0 && (
        <div className="ac-obj-row">
          {objetivos.map((o) => {
            const label = OBJ_LABEL[o.chave] ?? o.chave;
            const res   = resultadoMap[o.chave];
            const count = res?.valor > 0 ? res.valor : null;
            return (
              <span key={o.chave} className="ac-obj-pill">
                {label}{count != null ? ` · ${fmtContagem(count)}` : ''}
              </span>
            );
          })}
        </div>
      )}

      {/* ── Progresso de metas de resultado ── */}
      {metasProgresso.map((m, i) => (
        <div key={i} className="ac-meta-row">
          <span className="ac-meta-rotulo">{m.rotulo}</span>
          <div className="ac-meta-track">
            <div
              className={`ac-meta-fill ac-meta-fill--${m.tom}`}
              style={{ width: `${Math.min(m.pct ?? 0, 100)}%` }}
            />
          </div>
          <span className={`ac-meta-num ac-meta-num--${m.tom}`}>
            {fmtContagem(m.atual)}/{fmtContagem(m.alvo)}
          </span>
          <span className={`ac-meta-pct ac-meta-pct--${m.tom}`}>
            {m.pct ?? 0}%
          </span>
        </div>
      ))}

      {/* ── Corpo ── */}
      <div className="ac-body">
        <div className="ac-gasto-hoje">
          <span className="ac-gasto-valor">
            {(gastoHoje ?? 0) > 0
              ? `R$ ${(gastoHoje).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : '—'}
          </span>
          <span className="ac-gasto-label">{periodo.label}</span>
        </div>
        {vd && (
          <span className={`ac-verd ac-verd--${vd.tom}`}>
            {vd.arrow} {veredito.scorePct > 0 ? '+' : ''}{veredito.scorePct}%
            <span className="ac-verd-label">7d</span>
          </span>
        )}
      </div>

      {/* ── Barra de meta mensal ── */}
      {temPlano && (
        <div className="ac-progress">
          <div className="ac-progress-track">
            <div
              className={`ac-progress-fill ac-progress-fill--${tomBarra}`}
              style={{ width: `${pctMes}%` }}
            />
          </div>
          <div className="ac-progress-labels">
            <span>Meta {pctMes}%</span>
            <span>R$ {Math.round(gastoMes ?? 0).toLocaleString('pt-BR')} / R$ {Math.round(investimentoMensalPlanejado).toLocaleString('pt-BR')}</span>
          </div>
        </div>
      )}

      {/* ── Rodapé ── */}
      {(saldoTxt || alertas.length > 0) && (
        <div className="ac-footer">
          {saldoTxt && <span className={`ac-saldo ac-saldo--${saldoTom}`}>{saldoTxt}</span>}
          {alertas.length > 0 && (
            <span className="ac-alertas">{alertas.length} alerta{alertas.length > 1 ? 's' : ''}</span>
          )}
        </div>
      )}
    </div>
  );
}
