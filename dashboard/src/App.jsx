import { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar.jsx';
import CockpitBar from './components/CockpitBar.jsx';
import AccountList from './components/AccountList.jsx';
import AccountDetailPanel from './components/AccountDetailPanel.jsx';
import AlertsPanel from './components/AlertsPanel.jsx';
import DashboardView from './components/DashboardView.jsx';
import './App.css';

const API_URL    = import.meta.env.VITE_API_URL ?? '';
const REFRESH_MS = 60_000;
const LS_NOMES   = 'sentinela_nomes_customizados';
const LS_FAVS    = 'sentinela_favoritos';
const LS_GESTOR  = 'sentinela_gestor_filtro';
const LS_MODO    = 'sentinela_modo';

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
  const [modo, setModo] = useState(() => lerStorage(LS_MODO, 'monitoramento'));

  const isoHoje = new Date().toISOString().slice(0, 10);
  const [dataInicio, setDataInicio] = useState(isoHoje);
  const [dataFim,    setDataFim]    = useState(isoHoje);

  const [usuario,     setUsuario]     = useState(null);
  const [customNames, setCustomNames] = useState(() => lerStorage(LS_NOMES, {}));
  const [favoritos,   setFavoritos]   = useState(() => lerStorage(LS_FAVS,  []));
  const [gestorFiltro, setGestorFiltro] = useState(() => lerStorage(LS_GESTOR, 'todos'));
  const [contaSelecionadaId, setContaSelecionadaId] = useState(null);

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

  function handleGestorChange(g) {
    setGestorFiltro(g);
    try { localStorage.setItem(LS_GESTOR, JSON.stringify(g)); } catch {}
  }

  function handleModo(m) {
    setModo(m);
    setContaSelecionadaId(null);
    try { localStorage.setItem(LS_MODO, JSON.stringify(m)); } catch {}
  }

  if (erro) {
    return (
      <div className="error-screen">
        <span className="error-icon">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor"
            strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            <path d="M12 9v4" /><path d="M12 17h.01" />
          </svg>
        </span>
        <p>{erro}</p>
      </div>
    );
  }

  if (!dados) return <div className="loading">Carregando...</div>;

  const contas = dados.contas ?? [];
  const contaSelecionada = contaSelecionadaId ? contas.find((c) => c.id === contaSelecionadaId) ?? null : null;
  const painelAberto = contaSelecionada !== null;

  return (
    <div className="app-shell">
      <Sidebar
        contas={contas}
        contaSelecionadaId={contaSelecionadaId}
        onSelectConta={setContaSelecionadaId}
        gestorFiltro={gestorFiltro}
        onGestorChange={handleGestorChange}
        customNames={customNames}
      />

      <div className="app-main">
        <CockpitBar
          contas={contas}
          contaSelecionada={contaSelecionada}
          dataInicio={dataInicio}
          dataFim={dataFim}
          onPeriodoChange={({ dataInicio: ini, dataFim: fim }) => { setDataInicio(ini); setDataFim(fim); }}
          usuario={usuario}
          segundos={segundos}
          onVoltar={() => setContaSelecionadaId(null)}
          modo={modo}
          onModo={handleModo}
        />

        <div className={`app-body${painelAberto ? ' app-body--split' : ''}`}>
          {/* ── Conteúdo principal ── */}
          <div className="app-list">
            {modo === 'dashboard' ? (
              <DashboardView
                contas={contas}
                notificacoes={dados.notificacoes}
                customNames={customNames}
                contaSelecionadaId={contaSelecionadaId}
                onSelectConta={setContaSelecionadaId}
              />
            ) : (
              <>
                <AccountList
                  contas={contas}
                  favoritos={favoritos}
                  customNames={customNames}
                  onFavorito={handleFavorito}
                  onRename={handleRename}
                  contaSelecionadaId={contaSelecionadaId}
                  onSelectConta={setContaSelecionadaId}
                />
                {!painelAberto && (
                  <AlertsPanel
                    anomalias={dados.anomalias}
                    investigacoes={dados.investigacoes}
                    notificacoes={dados.notificacoes}
                    stats={dados.stats}
                  />
                )}
              </>
            )}
          </div>

          {/* ── Painel de detalhe (ambos os modos) ── */}
          {painelAberto && (
            <div className="app-panel">
              <AccountDetailPanel
                conta={contaSelecionada}
                customName={customNames[contaSelecionada.id] ?? null}
                onMetricasSalvas={buscarDados}
                onRefresh={buscarDados}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
