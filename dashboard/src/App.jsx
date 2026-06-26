import { useState, useEffect, useCallback, useRef } from 'react';
import Header from './components/Header.jsx';
import AccountList from './components/AccountList.jsx';
import AlertsPanel from './components/AlertsPanel.jsx';
import './App.css';

const API_URL    = import.meta.env.VITE_API_URL ?? '';
const REFRESH_MS = 60_000;
const LS_NOMES   = 'sentinela_nomes_customizados';
const LS_FAVS    = 'sentinela_favoritos';

function getToken() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('token');
  if (fromUrl) { sessionStorage.setItem('dash_token', fromUrl); return fromUrl; }
  return sessionStorage.getItem('dash_token') ?? '';
}

function lerStorage(chave, fallback) {
  try { return JSON.parse(localStorage.getItem(chave)) ?? fallback; } catch { return fallback; }
}

export default function App() {
  const [token]  = useState(getToken);
  const [dados,  setDados]  = useState(null);
  const [erro,   setErro]   = useState(null);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState(null);
  const [segundos, setSegundos] = useState(0);

  const isoHoje = new Date().toISOString().slice(0, 10);
  const [dataInicio, setDataInicio] = useState(isoHoje);
  const [dataFim,    setDataFim]    = useState(isoHoje);

  const [usuario,     setUsuario]     = useState(null);
  const [customNames, setCustomNames] = useState(() => lerStorage(LS_NOMES, {}));
  const [favoritos,   setFavoritos]   = useState(() => lerStorage(LS_FAVS,  []));

  const rangeRef = useRef({ dataInicio: isoHoje, dataFim: isoHoje });
  rangeRef.current = { dataInicio, dataFim };

  const buscarDados = useCallback(async () => {
    if (!token) { setErro('Token não encontrado na URL. Adicione ?token=SEU_TOKEN'); return; }
    try {
      const { dataInicio: ini, dataFim: fim } = rangeRef.current;
      const res = await fetch(`${API_URL}/dashboard/data?token=${token}&dataInicio=${ini}&dataFim=${fim}`);
      if (!res.ok) { setErro(`Erro ${res.status}: token inválido ou servidor indisponível.`); return; }
      const json = await res.json();
      setDados(json);
      setUsuario(json.usuario ?? null);
      setUltimaAtualizacao(new Date());
      setSegundos(0);
      setErro(null);
    } catch {
      setErro('Não foi possível conectar ao servidor.');
    }
  }, [token]);

  useEffect(() => { buscarDados(); }, [buscarDados]);
  useEffect(() => { buscarDados(); }, [dataInicio, dataFim]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const i = setInterval(buscarDados, REFRESH_MS);
    return () => clearInterval(i);
  }, [buscarDados]);
  useEffect(() => {
    const tick = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(tick);
  }, [ultimaAtualizacao]);

  function handleRename(id, nome) {
    setCustomNames((prev) => {
      const next = { ...prev, [id]: nome };
      localStorage.setItem(LS_NOMES, JSON.stringify(next));
      return next;
    });
  }

  function handleFavorito(id) {
    setFavoritos((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      localStorage.setItem(LS_FAVS, JSON.stringify(next));
      return next;
    });
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

  return (
    <div className="app">
      <Header
        stats={dados.stats}
        ultimaAtualizacao={ultimaAtualizacao}
        segundos={segundos}
        usuario={usuario}
        dataInicio={dataInicio}
        dataFim={dataFim}
        onPeriodoChange={({ dataInicio: ini, dataFim: fim }) => {
          setDataInicio(ini);
          setDataFim(fim);
        }}
      />

      <main className="main">
        <AccountList
          contas={dados.contas}
          favoritos={favoritos}
          customNames={customNames}
          onFavorito={handleFavorito}
          onRename={handleRename}
          onRefresh={buscarDados}
        />

        <AlertsPanel
          anomalias={dados.anomalias}
          investigacoes={dados.investigacoes}
          notificacoes={dados.notificacoes}
          stats={dados.stats}
        />
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
