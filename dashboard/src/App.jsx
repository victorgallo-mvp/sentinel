import { useState, useEffect, useCallback, useRef } from 'react';
import Header from './components/Header.jsx';
import EntitySection from './components/EntitySection.jsx';
import EventList from './components/EventList.jsx';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL ?? '';
const REFRESH_MS = 60_000;
const LS_SELECTED = 'sentinela_contas_selecionadas';
const LS_NOMES = 'sentinela_nomes_customizados';

function getToken() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('token');
  if (fromUrl) {
    sessionStorage.setItem('dash_token', fromUrl);
    return fromUrl;
  }
  return sessionStorage.getItem('dash_token') ?? '';
}

function lerStorage(chave, fallback) {
  try { return JSON.parse(localStorage.getItem(chave)) ?? fallback; } catch { return fallback; }
}

export default function App() {
  const [token] = useState(getToken);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState(null);
  const [segundos, setSegundos] = useState(0);

  // Filtros: IDs de contas visíveis e nomes customizados
  const [selectedIds, setSelectedIds] = useState(() => lerStorage(LS_SELECTED, null));
  const [customNames, setCustomNames] = useState(() => lerStorage(LS_NOMES, {}));

  // Ref para não recalcular selectedIds após o primeiro fetch quando ainda é null
  const initedFilter = useRef(false);

  const buscarDados = useCallback(async () => {
    if (!token) { setErro('Token não encontrado na URL. Adicione ?token=SEU_TOKEN'); return; }
    try {
      const res = await fetch(`${API_URL}/dashboard/data?token=${token}`);
      if (!res.ok) { setErro(`Erro ${res.status}: token inválido ou servidor indisponível.`); return; }
      const json = await res.json();
      setDados(json);
      setUltimaAtualizacao(new Date());
      setSegundos(0);
      setErro(null);

      // Na primeira carga, inicializa selectedIds com todas as contas se nunca salvo
      if (!initedFilter.current) {
        initedFilter.current = true;
        const saved = lerStorage(LS_SELECTED, null);
        if (saved === null) {
          const todos = json.contas.map((c) => c.id);
          setSelectedIds(todos);
          localStorage.setItem(LS_SELECTED, JSON.stringify(todos));
        }
      }
    } catch {
      setErro('Não foi possível conectar ao servidor.');
    }
  }, [token]);

  useEffect(() => { buscarDados(); }, [buscarDados]);
  useEffect(() => {
    const i = setInterval(buscarDados, REFRESH_MS);
    return () => clearInterval(i);
  }, [buscarDados]);
  useEffect(() => {
    const tick = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(tick);
  }, [ultimaAtualizacao]);

  // Fecha dropdown ao clicar fora (tratado no Header via state local)

  function handleToggle(id) {
    setSelectedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      localStorage.setItem(LS_SELECTED, JSON.stringify(next));
      return next;
    });
  }

  function handleRename(id, nome) {
    setCustomNames((prev) => {
      const next = { ...prev, [id]: nome };
      localStorage.setItem(LS_NOMES, JSON.stringify(next));
      return next;
    });
  }

  function handleSelectAll() {
    if (!dados) return;
    const todos = dados.contas.map((c) => c.id);
    const todasSelecionadas = todos.every((id) => selectedIds.includes(id));
    const next = todasSelecionadas ? [] : todos;
    setSelectedIds(next);
    localStorage.setItem(LS_SELECTED, JSON.stringify(next));
  }

  if (erro) {
    return (
      <div className="error-screen">
        <span className="error-icon">⚠️</span>
        <p>{erro}</p>
      </div>
    );
  }

  if (!dados) return <div className="loading">Carregando...</div>;

  // Contas para o seletor (com nomeOriginal sempre disponível)
  const contasParaFiltro = dados.contas.map((c) => ({ id: c.id, nomeOriginal: c.nome }));

  // Contas visíveis (filtradas)
  const contasVisiveis = dados.contas.filter(
    (c) => !selectedIds || selectedIds.length === 0 || selectedIds.includes(c.id)
  );

  return (
    <div className="app">
      <Header
        stats={dados.stats}
        ultimaAtualizacao={ultimaAtualizacao}
        segundos={segundos}
        contas={contasParaFiltro}
        selectedIds={selectedIds ?? dados.contas.map((c) => c.id)}
        customNames={customNames}
        onToggle={handleToggle}
        onRename={handleRename}
        onSelectAll={handleSelectAll}
      />

      <main className="main">
        {contasVisiveis.map((conta) => {
          const nomeExibido = customNames[conta.id] ?? conta.nome;
          return (
            <section key={conta.id} className="conta-section">
              <h2 className="conta-nome">{nomeExibido}</h2>
              {conta.entidades.map((entidade) => (
                <EntitySection key={entidade.id} entidade={entidade} />
              ))}
            </section>
          );
        })}

        <div className="events-grid">
          <EventList
            titulo="Anomalias (24h)"
            items={dados.anomalias}
            vazia="Nenhuma anomalia detectada"
            renderItem={(a) => (
              <div key={a.id} className="event-item">
                <span className="event-badge anomalia">{a.metrica}</span>
                <span className="event-detail">
                  {a.direcao === 'aumento' ? '↑' : a.direcao === 'queda' ? '↓' : ''}{' '}
                  atual {fmt(a.valorAtual)} · esperado {fmt(a.valorEsperado)}
                  {a.desvio != null ? ` (${Number(a.desvio).toFixed(1)}σ)` : ''}
                </span>
                <span className="event-time">{tempo(a.detectadaEm)}</span>
              </div>
            )}
          />
          <EventList
            titulo="Investigações (24h)"
            items={dados.investigacoes}
            vazia="Nenhuma investigação"
            renderItem={(i) => (
              <div key={i.id} className="event-item">
                <span className={`event-badge ${i.decidiuNotificar ? (i.notificacaoEnviada === false ? 'erro' : 'notificou') : 'silencioso'}`}>
                  {i.decidiuNotificar
                    ? (i.notificacaoEnviada === false ? '⚠️ Notif. falhou' : '🔔 Notificou')
                    : '🔕 Silenciou'}
                </span>
                <span className="event-detail">
                  {i.recomendacao?.acao ?? i.motivoNaoNotificar ?? '—'}
                </span>
                <span className="event-time">{tempo(i.inicioEm)}</span>
              </div>
            )}
          />
          <EventList
            titulo={`Notificações (24h)${dados.stats.errosEnvio24h > 0 ? ` · ⚠️ ${dados.stats.errosEnvio24h} falha${dados.stats.errosEnvio24h > 1 ? 's' : ''} oculta${dados.stats.errosEnvio24h > 1 ? 's' : ''}` : ''}`}
            items={dados.notificacoes}
            vazia="Nenhuma notificação enviada"
            renderItem={(n) => (
              <div key={n.id} className="event-item">
                <span className={`event-badge ${n.status === 'enviada' ? 'ok' : 'erro'}`}>
                  {n.status === 'enviada' ? '✓ Enviada' : '✗ Erro'}
                </span>
                <span className="event-detail">{n.conteudo?.slice(0, 80)}…</span>
                <span className="event-time">{tempo(n.enviadaEm)}</span>
              </div>
            )}
          />
        </div>
      </main>
    </div>
  );
}

function fmt(v) {
  if (v == null) return '—';
  return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function tempo(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso)) / 60000;
  if (diff < 60) return `${Math.round(diff)}min atrás`;
  if (diff < 1440) return `${Math.round(diff / 60)}h atrás`;
  return `${Math.round(diff / 1440)}d atrás`;
}
