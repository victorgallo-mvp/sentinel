import { useState, useEffect, useCallback } from 'react';
import Header from './components/Header.jsx';
import EntitySection from './components/EntitySection.jsx';
import EventList from './components/EventList.jsx';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL ?? '';
const REFRESH_MS = 60_000;

function getToken() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('token');
  if (fromUrl) {
    sessionStorage.setItem('dash_token', fromUrl);
    return fromUrl;
  }
  return sessionStorage.getItem('dash_token') ?? '';
}

export default function App() {
  const [token] = useState(getToken);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState(null);
  const [segundos, setSegundos] = useState(0);

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
    } catch {
      setErro('Não foi possível conectar ao servidor.');
    }
  }, [token]);

  useEffect(() => { buscarDados(); }, [buscarDados]);

  useEffect(() => {
    const intervalo = setInterval(buscarDados, REFRESH_MS);
    return () => clearInterval(intervalo);
  }, [buscarDados]);

  useEffect(() => {
    const tick = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(tick);
  }, [ultimaAtualizacao]);

  if (erro) {
    return (
      <div className="error-screen">
        <span className="error-icon">⚠️</span>
        <p>{erro}</p>
      </div>
    );
  }

  if (!dados) {
    return <div className="loading">Carregando...</div>;
  }

  return (
    <div className="app">
      <Header stats={dados.stats} ultimaAtualizacao={ultimaAtualizacao} segundos={segundos} />

      <main className="main">
        {dados.contas.map((conta) => (
          <section key={conta.id} className="conta-section">
            <h2 className="conta-nome">{conta.nome}</h2>
            {conta.entidades.map((entidade) => (
              <EntitySection key={entidade.id} entidade={entidade} />
            ))}
          </section>
        ))}

        <div className="events-grid">
          <EventList
            titulo="Anomalias (24h)"
            items={dados.anomalias}
            vazia="Nenhuma anomalia detectada"
            renderItem={(a) => (
              <div key={a.id} className="event-item">
                <span className="event-badge anomalia">{a.metrica}</span>
                <span className="event-detail">
                  atual {fmt(a.valorAtual)} · esperado {fmt(a.valorEsperado)}
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
                <span className={`event-badge ${i.decidiuNotificar ? 'notificou' : 'silencioso'}`}>
                  {i.decidiuNotificar ? '🔔 Notificou' : '🔕 Silenciou'}
                </span>
                <span className="event-detail">
                  {i.recomendacao?.acao ?? i.motivoNaoNotificar ?? '—'}
                </span>
                <span className="event-time">{tempo(i.inicioEm)}</span>
              </div>
            )}
          />
          <EventList
            titulo="Notificações (24h)"
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
