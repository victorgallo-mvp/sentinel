import { useState, useEffect } from 'react';
import DashboardCard from './DashboardCard.jsx';
import './DashboardView.css';

const LS_GESTOR   = 'sentinela_dashboard_gestor';
const LS_ATENCAO  = 'sentinela_dashboard_atencao_aberto';

function classificarConta(conta, notificacoesConta) {
  const status      = conta.resumo?.status;
  const saldoNiveis = (conta.resumo?.saldoPrepago ?? []).map((s) => s.nivel);
  const alertas     = conta.resumo?.alertas ?? [];
  const veredito    = conta.resumo?.veredito;

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

// Gera a linha de motivo resumida para a lista de atenção
function motivoPrincipal(conta, notifsConta) {
  const saldos  = conta.resumo?.saldoPrepago ?? [];
  const alertas = conta.resumo?.alertas ?? [];
  const status  = conta.resumo?.status;
  const veredito = conta.resumo?.veredito;

  for (const s of saldos) {
    if (s.nivel === 'zerado')    return { texto: 'Saldo esgotado', urgente: true };
    if (s.nivel === 'bloqueado') return { texto: 'Conta bloqueada', urgente: true };
    if (s.nivel === 'critico') {
      const runway = s.runwayHoras != null ? ` · ${Math.round(s.runwayHoras)}h de runway` : '';
      return { texto: `Saldo crítico${runway}`, urgente: false };
    }
    if (s.nivel === 'acabando')  return { texto: 'Saldo acabando', urgente: false };
  }

  if (status === 'critico' && alertas.length > 0) {
    const a = alertas[0];
    return { texto: `Problema: ${a.nome ?? a.status}`, urgente: true };
  }

  if (notifsConta?.length > 0) {
    const primeira = (notifsConta[0].conteudo ?? '').split('\n')[0]
      .replace(/<!--.*?-->/g, '').replace(/\*/g, '').trim();
    return { texto: primeira, urgente: false };
  }

  if (veredito?.direcao === 'cai') return { texto: 'Performance caindo (7d)', urgente: false };
  if (alertas.length > 0) return { texto: `Entrega: ${alertas[0].status}`, urgente: false };

  return { texto: 'Verificar', urgente: false };
}

const COLUNAS = [
  { id: 'problema', titulo: 'Problema', descricao: 'Requer ação imediata' },
  { id: 'alerta',   titulo: 'Alerta',   descricao: 'Atenção necessária' },
  { id: 'normal',   titulo: 'Normal',   descricao: 'Operando normalmente' },
];

export default function DashboardView({ contas, notificacoes }) {
  const [gestor, setGestor] = useState(() => {
    try { return localStorage.getItem(LS_GESTOR) ?? 'todos'; } catch { return 'todos'; }
  });

  const [atencaoAberto, setAtencaoAberto] = useState(() => {
    try { return localStorage.getItem(LS_ATENCAO) !== 'false'; } catch { return true; }
  });

  useEffect(() => {
    try { localStorage.setItem(LS_GESTOR, gestor); } catch {}
  }, [gestor]);

  useEffect(() => {
    try { localStorage.setItem(LS_ATENCAO, String(atencaoAberto)); } catch {}
  }, [atencaoAberto]);

  // Gestores únicos a partir das contas carregadas
  const gestores = [
    ...new Set(contas.map((c) => c.perfil?.gerenteResponsavel).filter(Boolean)),
  ].sort();

  // Mapa contaId → notificações recentes
  const notifPorConta = {};
  for (const n of notificacoes ?? []) {
    if (!notifPorConta[n.contaId]) notifPorConta[n.contaId] = [];
    notifPorConta[n.contaId].push(n);
  }

  // Filtrar por gestor selecionado
  const contasFiltradas = gestor === 'sem-gestor'
    ? contas.filter((c) => !c.perfil?.gerenteResponsavel)
    : gestor === 'todos'
    ? contas
    : contas.filter((c) => c.perfil?.gerenteResponsavel === gestor);

  // Agrupar por coluna
  const porColuna = { problema: [], alerta: [], normal: [] };
  for (const conta of contasFiltradas) {
    const col = classificarConta(conta, notifPorConta[conta.id] ?? []);
    porColuna[col].push(conta);
  }

  // Lista de atenção: problema + alerta, ordenados (problema primeiro)
  const contasAtencao = [
    ...porColuna.problema.map((c) => ({ conta: c, col: 'problema' })),
    ...porColuna.alerta.map((c)   => ({ conta: c, col: 'alerta' })),
  ];

  const temSemGestor = contas.some((c) => !c.perfil?.gerenteResponsavel);
  const nomesCuston  = (() => { try { return JSON.parse(localStorage.getItem('sentinela_nomes_customizados')) ?? {}; } catch { return {}; } })();

  return (
    <div className="dv-root">

      {/* ── Lista de atenção ── */}
      {contasAtencao.length > 0 && (
        <div className="dv-atencao">
          <button
            className="dv-atencao-header"
            onClick={() => setAtencaoAberto((v) => !v)}
            aria-expanded={atencaoAberto}
          >
            <span className="dv-atencao-titulo">
              Atenção hoje
              <span className="dv-atencao-badge">{contasAtencao.length}</span>
            </span>
            <span className="dv-atencao-chevron">{atencaoAberto ? '▲' : '▼'}</span>
          </button>

          {atencaoAberto && (
            <ul className="dv-atencao-lista">
              {contasAtencao.map(({ conta, col }) => {
                const nome         = nomesCuston[conta.id] ?? conta.nome;
                const gestorConta  = conta.perfil?.gerenteResponsavel;
                const motivo = motivoPrincipal(conta, notifPorConta[conta.id] ?? []);
                return (
                  <li key={conta.id} className={`dv-atencao-item dv-atencao-${col}`}>
                    <span className={`dv-atencao-dot dv-dot-${col}`} aria-hidden="true" />
                    <span className="dv-atencao-nome">{nome}</span>
                    {gestorConta && <span className="dv-atencao-gestor">{gestorConta}</span>}
                    <span className={`dv-atencao-motivo${motivo.urgente ? ' dv-motivo-urgente' : ''}`}>
                      {motivo.texto}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

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
