import { useState, useRef, useEffect } from 'react';
import './AccountCard.css';

const STATUS_COR   = { critico: '#dc2626', atencao: '#f59e0b', pausado: '#9ca3af', normal: '#16a34a' };
const STATUS_TITLE = { critico: 'Alerta ativo', atencao: 'Anomalia detectada', pausado: 'Conta pausada', normal: 'Sem alertas' };

// ── Saldo pré-pago: do mais grave ao mais tranquilo ──
const SALDO_ORDEM = { zerado: 0, bloqueado: 1, critico: 2, acabando: 3, ok: 4 };
const SALDO_CLS   = { zerado: 'critico', bloqueado: 'critico', critico: 'critico', acabando: 'atencao', ok: 'normal' };

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
    case 'zerado':    return '🔴 saldo zerado';
    case 'bloqueado': return '🚨 bloqueada';
    case 'critico':   return runway ? `🟠 acaba ~${runway}` : '🟠 saldo crítico';
    case 'acabando':  return runway ? `🟡 acaba ~${runway}` : (reais ? `🟡 ${reais}` : '🟡 saldo baixo');
    default:          return reais ? `💰 ${reais}${runway ? ` · ~${runway}` : ''}` : null;
  }
}

function tituloSaldo(s) {
  const p = [];
  if (s.saldoReais != null) p.push(`Saldo estimado: R$ ${s.saldoReais.toFixed(2)}`);
  if (s.ritmoHora)          p.push(`Ritmo: R$ ${s.ritmoHora.toFixed(2)}/h`);
  if (s.runwayHoras != null) p.push(`Autonomia: ~${fmtRunway(s.runwayHoras)}`);
  if (s.atualizadoEm)       p.push(`Atualizado: ${new Date(s.atualizadoEm).toLocaleString('pt-BR')}`);
  return p.join('\n');
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
  const { gastoHoje, status, alertas = [], saldoPrepago = [] } = conta.resumo;
  const saldo = piorSaldo(saldoPrepago);
  const saldoTexto = saldo ? textoSaldo(saldo) : null;

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
      {/* ── Linha do header ── */}
      <div className="ac-header">
        {/* Status dot */}
        <span
          className="ac-status-dot"
          style={{ background: STATUS_COR[status] ?? '#9ca3af' }}
          title={STATUS_TITLE[status] ?? status}
        />

        {/* Favorito */}
        <button
          className="ac-favorito"
          onClick={(e) => { e.stopPropagation(); onFavorito(conta.id); }}
          title={favorito ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
        >
          {favorito ? '★' : '☆'}
        </button>

        {/* Nome (editável) */}
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
          <button className="ac-rename-btn" onClick={iniciarEdicao} title="Renomear">✏</button>
        </div>

        {/* Resumo */}
        <div className="ac-resumo">
          {gastoHoje > 0 && (
            <span className="ac-resumo-gasto">
              R$ {gastoHoje.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </span>
          )}
          {saldoTexto && (
            <span
              className={`ac-badge ac-saldo ac-badge--${SALDO_CLS[saldo.nivel] ?? 'normal'}`}
              title={tituloSaldo(saldo)}
            >
              {saldoTexto}
            </span>
          )}
          {alertas.length > 0 && (
            <span className="ac-badge ac-badge--critico">
              {alertas.length} alerta{alertas.length !== 1 ? 's' : ''}
            </span>
          )}
          {status === 'atencao' && alertas.length === 0 && (
            <span className="ac-badge ac-badge--atencao">atenção</span>
          )}
          {status === 'pausado' && (
            <span className="ac-badge ac-badge--pausado">pausada</span>
          )}
          {status === 'normal' && (
            <span className="ac-badge ac-badge--normal">sem alertas</span>
          )}
        </div>

        {/* Indicador clicável */}
        <span className="ac-toggle">▸</span>
      </div>
    </div>
  );
}
