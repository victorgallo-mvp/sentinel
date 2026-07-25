import { useState } from 'react';
import './Sidebar.css';

const SALDO_ORDEM = { zerado: 0, bloqueado: 1, critico: 2, acabando: 3, ok: 4 };

function piorSaldo(lista) {
  if (!lista?.length) return null;
  return [...lista].sort((a, b) => (SALDO_ORDEM[a.nivel] ?? 9) - (SALDO_ORDEM[b.nivel] ?? 9))[0];
}

function urgencia(conta) {
  const status = conta.resumo?.status;
  const saldos = conta.resumo?.saldoPrepago ?? [];
  const pior = piorSaldo(saldos);
  if (status === 'critico' || pior?.nivel === 'zerado' || pior?.nivel === 'bloqueado') return 0;
  if (pior?.nivel === 'critico' || pior?.nivel === 'acabando' || (conta.resumo?.alertas?.length > 0)) return 1;
  return 2;
}

function labelSaldo(s) {
  if (!s) return null;
  if (s.nivel === 'zerado')    return { texto: 'Saldo zero', nivel: 'crit' };
  if (s.nivel === 'bloqueado') return { texto: 'Bloqueada', nivel: 'crit' };
  if (s.nivel === 'critico') {
    const h = s.runwayHoras != null ? `${Math.round(s.runwayHoras)}h` : 'crítico';
    return { texto: h, nivel: 'crit' };
  }
  if (s.nivel === 'acabando') {
    const h = s.runwayHoras != null ? `${Math.round(s.runwayHoras)}h` : 'baixo';
    return { texto: h, nivel: 'warn' };
  }
  return null;
}

function IconShield() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
    </svg>
  );
}

function IconMenu() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}

export default function Sidebar({ contas = [], contaSelecionadaId, onSelectConta, gestorFiltro, onGestorChange, customNames = {} }) {
  const [collapsed, setCollapsed] = useState(false);

  const gestores = [...new Set(contas.map((c) => c.perfil?.gerenteResponsavel).filter(Boolean))].sort();
  const temSemGestor = contas.some((c) => !c.perfil?.gerenteResponsavel);

  const contasFiltradas = gestorFiltro === 'sem-gestor'
    ? contas.filter((c) => !c.perfil?.gerenteResponsavel)
    : gestorFiltro && gestorFiltro !== 'todos'
    ? contas.filter((c) => c.perfil?.gerenteResponsavel === gestorFiltro)
    : contas;

  const ordenadas = [...contasFiltradas].sort((a, b) => urgencia(a) - urgencia(b));
  const comProblema = ordenadas.filter((c) => urgencia(c) === 0);
  const comAlerta   = ordenadas.filter((c) => urgencia(c) === 1);
  const normais     = ordenadas.filter((c) => urgencia(c) === 2);

  return (
    <aside className={`sb${collapsed ? ' sb--collapsed' : ''}`}>
      {/* ── Brand ── */}
      <div className="sb-brand">
        {!collapsed && (
          <div className="sb-brand-inner">
            <span className="sb-brand-icon"><IconShield /></span>
            <span className="sb-brand-name">Sentinela</span>
          </div>
        )}
        <button className="sb-collapse-btn" onClick={() => setCollapsed((v) => !v)} title={collapsed ? 'Expandir' : 'Recolher'}>
          <IconMenu />
        </button>
      </div>

      {/* ── Filtro de gestor ── */}
      {!collapsed && (gestores.length > 0 || temSemGestor) && (
        <div className="sb-gestores">
          <button
            className={`sb-gestor-btn${!gestorFiltro || gestorFiltro === 'todos' ? ' sb-gestor-ativo' : ''}`}
            onClick={() => onGestorChange('todos')}
          >Todos</button>
          {gestores.map((g) => (
            <button
              key={g}
              className={`sb-gestor-btn${gestorFiltro === g ? ' sb-gestor-ativo' : ''}`}
              onClick={() => onGestorChange(g)}
            >{g}</button>
          ))}
          {temSemGestor && (
            <button
              className={`sb-gestor-btn${gestorFiltro === 'sem-gestor' ? ' sb-gestor-ativo' : ''}`}
              onClick={() => onGestorChange('sem-gestor')}
            >Sem gestor</button>
          )}
        </div>
      )}

      {/* ── Lista ── */}
      <nav className="sb-nav">
        {comProblema.length > 0 && (
          <div className="sb-section">
            {!collapsed && <span className="sb-section-label">Problema</span>}
            {comProblema.map((c) => <SidebarItem key={c.id} conta={c} collapsed={collapsed} ativo={c.id === contaSelecionadaId} onClick={() => onSelectConta(c.id)} customName={customNames[c.id]} />)}
          </div>
        )}
        {comAlerta.length > 0 && (
          <div className="sb-section">
            {!collapsed && <span className="sb-section-label">Alerta</span>}
            {comAlerta.map((c) => <SidebarItem key={c.id} conta={c} collapsed={collapsed} ativo={c.id === contaSelecionadaId} onClick={() => onSelectConta(c.id)} customName={customNames[c.id]} />)}
          </div>
        )}
        {normais.length > 0 && (
          <div className="sb-section">
            {!collapsed && <span className="sb-section-label">Normal</span>}
            {normais.map((c) => <SidebarItem key={c.id} conta={c} collapsed={collapsed} ativo={c.id === contaSelecionadaId} onClick={() => onSelectConta(c.id)} customName={customNames[c.id]} />)}
          </div>
        )}
      </nav>

      {/* ── Total ── */}
      {!collapsed && (
        <div className="sb-footer">
          <span className="sb-footer-text">{contas.length} contas</span>
        </div>
      )}
    </aside>
  );
}

function SidebarItem({ conta, collapsed, ativo, onClick, customName }) {
  const u = urgencia(conta);
  const dotClass = u === 0 ? 'sb-dot--crit' : u === 1 ? 'sb-dot--warn' : 'sb-dot--ok';
  const nome = customName ?? conta.nome;
  const saldo = piorSaldo(conta.resumo?.saldoPrepago ?? []);
  const saldoLabel = labelSaldo(saldo);
  const alertas = conta.resumo?.alertas ?? [];
  const gastoHoje = conta.resumo?.gastoHoje ?? 0;
  const fmtR = (v) => v > 0 ? `R$${Math.round(v).toLocaleString('pt-BR')}` : null;

  const subInfo = saldoLabel
    ? saldoLabel.texto
    : alertas.length > 0
    ? `${alertas.length} alerta${alertas.length > 1 ? 's' : ''}`
    : fmtR(gastoHoje) ?? '';

  const subClass = saldoLabel?.nivel === 'crit' ? 'sb-item-sub--crit'
    : saldoLabel?.nivel === 'warn' ? 'sb-item-sub--warn'
    : '';

  if (collapsed) {
    return (
      <button className={`sb-item sb-item--collapsed${ativo ? ' sb-item--ativo' : ''}`} onClick={onClick} title={nome}>
        <span className={`sb-dot ${dotClass}`} />
      </button>
    );
  }

  return (
    <button className={`sb-item${ativo ? ' sb-item--ativo' : ''}`} onClick={onClick}>
      <span className={`sb-dot ${dotClass}`} />
      <span className="sb-item-content">
        <span className="sb-item-nome">{nome}</span>
        {subInfo && <span className={`sb-item-sub ${subClass}`}>{subInfo}</span>}
      </span>
    </button>
  );
}
