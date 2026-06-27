import { useState } from 'react';
import './AlertsPanel.css';

const ABAS = [
  { id: 'anomalias',    label: 'Anomalias' },
  { id: 'investigacoes', label: 'Investigações' },
  { id: 'notificacoes', label: 'Notificações' },
];

function IconChevron({ aberto }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
      fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: aberto ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function tempo(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso)) / 60000;
  if (diff < 60) return `${Math.round(diff)}min`;
  if (diff < 1440) return `${Math.round(diff / 60)}h`;
  return `${Math.round(diff / 1440)}d`;
}

function fmt(v) {
  if (v == null) return '—';
  return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

export default function AlertsPanel({ anomalias = [], investigacoes = [], notificacoes = [], stats = {} }) {
  const [abaAtiva, setAbaAtiva] = useState('anomalias');
  const [colapsado, setColapsado] = useState(false);

  const contagens = {
    anomalias:     anomalias.length,
    investigacoes: investigacoes.length,
    notificacoes:  notificacoes.length,
  };

  const totalAlertas = contagens.anomalias + contagens.investigacoes;

  return (
    <div className={`ap-panel ${colapsado ? 'ap-panel--colapsado' : ''}`}>
      {/* ── Header do painel ── */}
      <div className="ap-panel-header">
        <h3 className="ap-panel-titulo">
          Eventos (24h)
          {totalAlertas > 0 && (
            <span className="ap-total-badge">{totalAlertas}</span>
          )}
          {stats.errosEnvio24h > 0 && (
            <span className="ap-erro-badge">
              {stats.errosEnvio24h} falha{stats.errosEnvio24h > 1 ? 's' : ''}
            </span>
          )}
        </h3>
        <button
          className="ap-colapsar-btn"
          onClick={() => setColapsado((v) => !v)}
          title={colapsado ? 'Expandir' : 'Colapsar'}
        >
          <IconChevron aberto={!colapsado} />
        </button>
      </div>

      {!colapsado && (
        <>
          {/* ── Abas ── */}
          <div className="ap-abas">
            {ABAS.map((aba) => (
              <button
                key={aba.id}
                className={`ap-aba-btn ${abaAtiva === aba.id ? 'ativo' : ''}`}
                onClick={() => setAbaAtiva(aba.id)}
              >
                {aba.label}
                {contagens[aba.id] > 0 && (
                  <span className="ap-aba-count">{contagens[aba.id]}</span>
                )}
              </button>
            ))}
          </div>

          {/* ── Conteúdo das abas ── */}
          <div className="ap-body">
            {abaAtiva === 'anomalias' && (
              anomalias.length === 0
                ? <p className="ap-vazio">Nenhuma anomalia detectada</p>
                : anomalias.map((a) => (
                    <div key={a.id} className="ap-item">
                      {a.contaNome && <span className="ap-conta-tag">{a.contaNome}</span>}
                      <span className="ap-badge ap-badge--warn">{a.metrica}</span>
                      <span className="ap-detalhe">
                        {a.direcao === 'aumento' ? '↑' : a.direcao === 'queda' ? '↓' : ''}{' '}
                        atual {fmt(a.valorAtual)} · esp. {fmt(a.valorEsperado)}
                        {a.desvio != null ? ` (${Number(a.desvio).toFixed(1)}σ)` : ''}
                      </span>
                      <span className="ap-tempo">{tempo(a.detectadaEm)}</span>
                    </div>
                  ))
            )}

            {abaAtiva === 'investigacoes' && (
              investigacoes.length === 0
                ? <p className="ap-vazio">Nenhuma investigação</p>
                : investigacoes.map((i) => (
                    <div key={i.id} className="ap-item">
                      {i.contaNome && <span className="ap-conta-tag">{i.contaNome}</span>}
                      <span className={`ap-badge ${i.decidiuNotificar ? (i.notificacaoEnviada === false ? 'ap-badge--crit' : 'ap-badge--neutral') : 'ap-badge--muted'}`}>
                        {i.decidiuNotificar
                          ? (i.notificacaoEnviada === false ? 'Falhou' : 'Notificou')
                          : 'Silenciou'}
                      </span>
                      <span className="ap-detalhe">
                        {i.recomendacao?.acao ?? i.motivoNaoNotificar ?? '—'}
                      </span>
                      <span className="ap-tempo">{tempo(i.inicioEm)}</span>
                    </div>
                  ))
            )}

            {abaAtiva === 'notificacoes' && (
              notificacoes.length === 0
                ? <p className="ap-vazio">Nenhuma notificação enviada</p>
                : notificacoes.map((n) => (
                    <div key={n.id} className="ap-item">
                      {n.contaNome && <span className="ap-conta-tag">{n.contaNome}</span>}
                      <span className={`ap-badge ${n.status === 'enviada' ? 'ap-badge--neutral' : 'ap-badge--crit'}`}>
                        {n.status === 'enviada' ? 'Enviada' : 'Erro'}
                      </span>
                      <span className="ap-detalhe">{n.conteudo?.slice(0, 80)}…</span>
                      <span className="ap-tempo">{tempo(n.enviadaEm)}</span>
                    </div>
                  ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
