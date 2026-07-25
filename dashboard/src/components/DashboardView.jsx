import { useState } from 'react';
import DashboardCard from './DashboardCard.jsx';
import './DashboardView.css';

const LS_GESTOR = 'sentinela_dashboard_gestor';

const SALDO_ORDEM = { zerado: 0, bloqueado: 1, critico: 2, acabando: 3, ok: 4 };

function classificar(conta) {
  const status = conta.resumo?.status;
  const saldos = (conta.resumo?.saldoPrepago ?? []).map((s) => s.nivel);
  const alertas = conta.resumo?.alertas ?? [];

  const ehProblema =
    status === 'critico' ||
    saldos.some((n) => n === 'zerado' || n === 'bloqueado');

  const ehAlerta =
    !ehProblema && (
      saldos.some((n) => n === 'critico' || n === 'acabando') ||
      alertas.length > 0
    );

  return ehProblema ? 'problema' : ehAlerta ? 'alerta' : 'normal';
}

function piorSaldo(lista) {
  if (!lista?.length) return null;
  return [...lista].sort((a, b) => (SALDO_ORDEM[a.nivel] ?? 9) - (SALDO_ORDEM[b.nivel] ?? 9))[0];
}

const COLUNAS = [
  { id: 'problema', titulo: 'Problema',  cor: 'crit', desc: 'Requer ação imediata' },
  { id: 'alerta',   titulo: 'Alerta',    cor: 'warn', desc: 'Atenção necessária'   },
  { id: 'normal',   titulo: 'Normal',    cor: 'ok',   desc: 'Operando normalmente'  },
];

export default function DashboardView({ contas, notificacoes, customNames = {}, contaSelecionadaId, onSelectConta }) {
  const [gestor, setGestor] = useState(() => {
    try { return localStorage.getItem(LS_GESTOR) ?? 'todos'; } catch { return 'todos'; }
  });

  function handleGestor(g) {
    setGestor(g);
    try { localStorage.setItem(LS_GESTOR, g); } catch {}
  }

  const notifPorConta = {};
  for (const n of notificacoes ?? []) {
    (notifPorConta[n.contaId] ??= []).push(n);
  }

  const gestores = [...new Set(contas.map((c) => c.perfil?.gerenteResponsavel).filter(Boolean))].sort();
  const temSemGestor = contas.some((c) => !c.perfil?.gerenteResponsavel);

  const filtradas = gestor === 'sem-gestor'
    ? contas.filter((c) => !c.perfil?.gerenteResponsavel)
    : gestor === 'todos'
    ? contas
    : contas.filter((c) => c.perfil?.gerenteResponsavel === gestor);

  const porColuna = { problema: [], alerta: [], normal: [] };
  for (const c of filtradas) porColuna[classificar(c)].push(c);

  // Totais por coluna para os headers
  function totalGasto(lista) {
    return lista.reduce((s, c) => s + (c.resumo?.gastoHoje ?? 0), 0);
  }

  return (
    <div className="dv-root">
      {/* ── Filtro gestor ── */}
      {(gestores.length > 0 || temSemGestor) && (
        <div className="dv-filtros">
          {['todos', ...gestores, ...(temSemGestor ? ['sem-gestor'] : [])].map((g) => {
            const label = g === 'todos' ? `Todos (${contas.length})` : g === 'sem-gestor' ? 'Sem gestor' : g;
            return (
              <button
                key={g}
                className={`dv-filtro-btn${gestor === g ? ' dv-filtro-ativo' : ''}`}
                onClick={() => handleGestor(g)}
              >{label}</button>
            );
          })}
        </div>
      )}

      {/* ── Kanban ── */}
      <div className="dv-kanban">
        {COLUNAS.map((col) => {
          const items = porColuna[col.id];
          const gasto = totalGasto(items);
          return (
            <div key={col.id} className={`dv-col dv-col--${col.cor}`}>
              {/* Header da coluna */}
              <div className="dv-col-header">
                <div className="dv-col-header-top">
                  <span className="dv-col-titulo">{col.titulo}</span>
                  <span className="dv-col-count">{items.length}</span>
                </div>
                {gasto > 0 && (
                  <span className="dv-col-gasto">
                    R$ {Math.round(gasto).toLocaleString('pt-BR')} hoje
                  </span>
                )}
              </div>

              {/* Cards */}
              <div className="dv-cards">
                {items.length === 0 ? (
                  <div className="dv-vazio">{col.desc}</div>
                ) : (
                  items.map((conta) => (
                    <DashboardCard
                      key={conta.id}
                      conta={conta}
                      customName={customNames[conta.id] ?? null}
                      notificacoesConta={notifPorConta[conta.id] ?? []}
                      isSelected={conta.id === contaSelecionadaId}
                      onClick={onSelectConta}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
