import { useState, useEffect } from 'react';
import DashboardCard from './DashboardCard.jsx';
import './DashboardView.css';

const LS_GESTOR = 'sentinela_dashboard_gestor';

function classificarConta(conta, notificacoesConta) {
  const status = conta.resumo?.status;
  const saldoNiveis = (conta.resumo?.saldoPrepago ?? []).map((s) => s.nivel);
  const alertas = conta.resumo?.alertas ?? [];
  const veredito = conta.resumo?.veredito;

  const ehProblema =
    status === 'critico' ||
    saldoNiveis.some((n) => n === 'zerado' || n === 'bloqueado');

  const ehAlerta =
    !ehProblema && (
      saldoNiveis.some((n) => n === 'critico' || n === 'acabando') ||
      alertas.length > 0 ||
      veredito?.direcao === 'cai' ||
      (notificacoesConta?.length ?? 0) > 0
    );

  if (ehProblema) return 'problema';
  if (ehAlerta) return 'alerta';
  return 'normal';
}

const COLUNAS = [
  { id: 'problema', titulo: 'Problema',  descricao: 'Requer ação imediata' },
  { id: 'alerta',   titulo: 'Alerta',    descricao: 'Atenção necessária' },
  { id: 'normal',   titulo: 'Normal',    descricao: 'Operando normalmente' },
];

export default function DashboardView({ contas, notificacoes }) {
  const [gestor, setGestor] = useState(() => {
    try { return localStorage.getItem(LS_GESTOR) ?? 'todos'; } catch { return 'todos'; }
  });

  useEffect(() => {
    try { localStorage.setItem(LS_GESTOR, gestor); } catch {}
  }, [gestor]);

  // Gestores únicos a partir das contas carregadas
  const gestores = [
    ...new Set(
      contas
        .map((c) => c.perfil?.gerenteResponsavel)
        .filter(Boolean)
    ),
  ].sort();

  // Mapa contaId → notificações recentes
  const notifPorConta = {};
  for (const n of notificacoes ?? []) {
    if (!notifPorConta[n.contaId]) notifPorConta[n.contaId] = [];
    notifPorConta[n.contaId].push(n);
  }

  // Filtrar por gestor selecionado
  const contasFiltradas = gestor === 'todos' || gestor === 'sem-gestor'
    ? contas.filter((c) =>
        gestor === 'todos' || !c.perfil?.gerenteResponsavel
      )
    : contas.filter((c) => c.perfil?.gerenteResponsavel === gestor);

  // Agrupar por coluna
  const porColuna = { problema: [], alerta: [], normal: [] };
  for (const conta of contasFiltradas) {
    const col = classificarConta(conta, notifPorConta[conta.id] ?? []);
    porColuna[col].push(conta);
  }

  const temSemGestor = contas.some((c) => !c.perfil?.gerenteResponsavel);

  return (
    <div className="dv-root">
      {/* ── Filtro de gestor ── */}
      <div className="dv-filtros">
        <span className="dv-filtro-label">Gestor</span>
        <div className="dv-filtro-grupo">
          <button
            className={`dv-filtro-btn${gestor === 'todos' ? ' dv-filtro-ativo' : ''}`}
            onClick={() => setGestor('todos')}
          >
            Todos ({contas.length})
          </button>
          {gestores.map((g) => {
            const n = contas.filter((c) => c.perfil?.gerenteResponsavel === g).length;
            return (
              <button
                key={g}
                className={`dv-filtro-btn${gestor === g ? ' dv-filtro-ativo' : ''}`}
                onClick={() => setGestor(g)}
              >
                {g} ({n})
              </button>
            );
          })}
          {temSemGestor && (
            <button
              className={`dv-filtro-btn${gestor === 'sem-gestor' ? ' dv-filtro-ativo' : ''}`}
              onClick={() => setGestor('sem-gestor')}
            >
              Sem gestor ({contas.filter((c) => !c.perfil?.gerenteResponsavel).length})
            </button>
          )}
        </div>
      </div>

      {/* ── Colunas kanban ── */}
      <div className="dv-kanban">
        {COLUNAS.map((col) => {
          const items = porColuna[col.id];
          return (
            <div key={col.id} className={`dv-coluna dv-col-${col.id}`}>
              <div className="dv-coluna-header">
                <span className="dv-coluna-titulo">{col.titulo}</span>
                <span className="dv-coluna-count">{items.length}</span>
              </div>
              <p className="dv-coluna-desc">{col.descricao}</p>

              <div className="dv-cards">
                {items.length === 0 && (
                  <div className="dv-vazio">Nenhuma conta</div>
                )}
                {items.map((conta) => (
                  <DashboardCard
                    key={conta.id}
                    conta={conta}
                    notificacoesConta={notifPorConta[conta.id] ?? []}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
