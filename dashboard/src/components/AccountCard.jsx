import { useState, useRef, useEffect } from 'react';
import './AccountCard.css';

const STATUS_TITLE = { critico: 'Alerta ativo', atencao: 'Anomalia detectada', pausado: 'Conta pausada', normal: 'Sem alertas' };

// ── Saldo pré-pago: do mais grave ao mais tranquilo ──
const SALDO_ORDEM = { zerado: 0, bloqueado: 1, critico: 2, acabando: 3, ok: 4 };
// Tom do saldo: 'crit' | 'warn' | 'muted' (sem cor de "ok" — minimalismo)
const SALDO_TOM = { zerado: 'crit', bloqueado: 'crit', critico: 'crit', acabando: 'warn', ok: 'muted' };
// Veredito de melhora/queda por objetivos (tendência 7d vs 7d anterior)
const VEREDITO_UI = {
  melhorou: { icon: '📈', tom: 'ok',    label: 'melhorou' },
  estavel:  { icon: '➖', tom: 'muted', label: 'estável' },
  piorou:   { icon: '📉', tom: 'crit',  label: 'piorou' },
};

// Deep-link para o Ads Manager da conta (nível BM) — investigação a fundo é na Meta
function urlMetaBm(conta) {
  const act = conta.contaAnuncioId?.replace(/^act_/, '');
  if (!act) return null;
  const base = 'https://adsmanager.facebook.com/adsmanager/manage/campaigns';
  return `${base}?act=${act}${conta.bmId ? `&business_id=${conta.bmId}` : ''}`;
}

function fmtRunway(h) {
  if (h == null) return null;
  const horas = Math.max(0, Math.round(h));
  if (horas < 24) return `${horas}h`;
  const d = Math.floor(horas / 24);
  const r = horas % 24;
  return r > 0 ? `${d}d ${r}h` : `${d}d`;
}

function piorSaldo(lista) {
  if (!lista || !lista.length) return null;
  return [...lista].sort((a, b) => (SALDO_ORDEM[a.nivel] ?? 9) - (SALDO_ORDEM[b.nivel] ?? 9))[0];
}

function textoSaldo(s) {
  const runway = fmtRunway(s.runwayHoras);
  const reais = s.saldoReais != null
    ? `R$ ${s.saldoReais.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`
    : null;
  switch (s.nivel) {
    case 'zerado':    return 'saldo zerado';
    case 'bloqueado': return 'conta bloqueada';
    case 'critico':   return runway ? `acaba ~${runway}` : 'saldo crítico';
    case 'acabando':  return runway ? `acaba ~${runway}` : (reais ? `${reais} restante` : 'saldo baixo');
    default:          return reais ? `${reais}${runway ? ` · ~${runway}` : ''}` : null;
  }
}

function tituloSaldo(s) {
  const p = [];
  if (s.saldoReais != null) p.push(`Saldo estimado: R$ ${s.saldoReais.toFixed(2)}`);
  if (s.ritmoHora)          p.push(`Ritmo: R$ ${s.ritmoHora.toFixed(2)}/h`);
  if (s.runwayHoras != null) p.push(`Autonomia: ~${fmtRunway(s.runwayHoras)}`);
  if (s.motivoBloqueio)     p.push(`Motivo: ${s.motivoBloqueio}`);
  if (s.atualizadoEm)       p.push(`Atualizado: ${new Date(s.atualizadoEm).toLocaleString('pt-BR')}`);
  return p.join('\n');
}

function IconStar({ filled }) {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6"
      strokeLinejoin="round">
      <path d="M12 17.3l-5.4 3.1 1.4-6.1L3.2 10l6.2-.5L12 3.8l2.6 5.7 6.2.5-4.8 4.3 1.4 6.1z" />
    </svg>
  );
}

function IconPencil() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h4l10-10a2 2 0 0 0-3-3L5 17z" />
    </svg>
  );
}

function IconChevron() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export default function AccountCard({ conta, favorito, customName, onFavorito, onRename, onClick }) {
  const [editando, setEditando]   = useState(false);
  const [valorEdit, setValorEdit] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (editando && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editando]);

  const nomeExibido = customName ?? conta.nome;
  const { status, alertas = [], saldoPrepago = [], gasto7d, gasto30d, gastoMes, investimentoMensalPlanejado, veredito } = conta.resumo;
  const saldo = piorSaldo(saldoPrepago);
  const saldoTexto = saldo ? textoSaldo(saldo) : null;
  const fmtGasto = (v) => `R$ ${(v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;

  // Barra de gasto do mês vs. investimento planejado (substitui os números quando há plano)
  const temPlano = investimentoMensalPlanejado > 0;
  const pctMes = temPlano ? Math.round((gastoMes / investimentoMensalPlanejado) * 100) : null;
  const tomBarra = pctMes == null ? 'ok' : pctMes >= 100 ? 'crit' : pctMes >= 80 ? 'warn' : 'ok';

  const partesGasto = [
    gasto7d > 0 ? `7d: ${fmtGasto(gasto7d)}` : null,
    gasto30d > 0 ? `30d: ${fmtGasto(gasto30d)}` : null,
  ].filter(Boolean);
  const gastoTexto = !temPlano && partesGasto.length ? partesGasto.join(' · ') : null;

  const vd = veredito ? VEREDITO_UI[veredito.direcao] : null;
  const linkBm = urlMetaBm(conta);

  function iniciarEdicao(e) {
    e.stopPropagation();
    setValorEdit(nomeExibido);
    setEditando(true);
  }

  function confirmarEdicao() {
    const nome = valorEdit.trim();
    if (nome) onRename(conta.id, nome);
    setEditando(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') confirmarEdicao();
    if (e.key === 'Escape') setEditando(false);
  }

  function handleCardClick() {
    if (!editando && onClick) onClick(conta.id);
  }

  return (
    <div
      className={`ac-card ac-card--${status}`}
      onClick={handleCardClick}
      style={{ cursor: onClick ? 'pointer' : undefined }}
    >
      <div className="ac-header">
        <span className="ac-status-dot" title={STATUS_TITLE[status] ?? status} />

        <button
          className={`ac-favorito ${favorito ? 'ac-favorito--on' : ''}`}
          onClick={(e) => { e.stopPropagation(); onFavorito(conta.id); }}
          title={favorito ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
        >
          <IconStar filled={favorito} />
        </button>

        <div className="ac-nome-wrapper" onClick={(e) => e.stopPropagation()}>
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

        <div className="ac-resumo">
          {saldoTexto && (
            <span
              className={`ac-saldo ac-saldo--${SALDO_TOM[saldo.nivel] ?? 'muted'}`}
              title={tituloSaldo(saldo)}
            >
              {saldoTexto}
            </span>
          )}
          {gastoTexto && (
            <span className="ac-gasto30d" title="Gasto nos últimos 7 e 30 dias">
              {gastoTexto}
            </span>
          )}
          {vd && (
            <span
              className={`ac-veredito ac-veredito--${vd.tom}`}
              title={`Tendência (7d vs 7d anterior, ponderada pelos objetivos): ${vd.label} ${veredito.scorePct > 0 ? '+' : ''}${veredito.scorePct}%`}
            >
              {vd.icon} {vd.label}
            </span>
          )}
          {alertas.length > 0 && (
            <span className="ac-tag ac-tag--crit">
              {alertas.length} alerta{alertas.length !== 1 ? 's' : ''}
            </span>
          )}
          {status === 'atencao' && alertas.length === 0 && (
            <span className="ac-tag ac-tag--warn">atenção</span>
          )}
          {status === 'pausado' && (
            <span className="ac-tag ac-tag--muted">pausada</span>
          )}
          {linkBm && (
            <a
              className="ac-bm-link"
              href={linkBm}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title="Abrir esta conta no Meta Ads Manager (BM)"
            >
              Abrir na BM ↗
            </a>
          )}
        </div>

        <span className="ac-toggle"><IconChevron /></span>
      </div>

      {temPlano && (
        <div
          className="ac-gastobar"
          title={`Gasto do mês: ${fmtGasto(gastoMes)} de ${fmtGasto(investimentoMensalPlanejado)} planejados`}
        >
          <div className="ac-gastobar-track">
            <div
              className={`ac-gastobar-fill ac-gastobar-fill--${tomBarra}`}
              style={{ width: `${Math.min(pctMes, 100)}%` }}
            />
          </div>
          <span className="ac-gastobar-label">
            {fmtGasto(gastoMes)} / {fmtGasto(investimentoMensalPlanejado)} · {pctMes}%
          </span>
        </div>
      )}
    </div>
  );
}
