import { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar.jsx';
import CockpitBar from './components/CockpitBar.jsx';
import AccountList from './components/AccountList.jsx';
import AccountDetailPanel from './components/AccountDetailPanel.jsx';
import AlertsPanel from './components/AlertsPanel.jsx';
import DashboardView from './components/DashboardView.jsx';
import Login from './components/Login.jsx';
import { isDemo } from './demo/mockApi.js';
import { apiFetch, lerSessao, encerrarSessao } from './api.js';
import './App.css';

const REFRESH_MS = 60_000;
const LS_NOMES   = 'sentinela_nomes_customizados';
const LS_FAVS    = 'sentinela_favoritos';
const LS_GESTOR  = 'sentinela_gestor_filtro';
const LS_MODO    = 'sentinela_modo';

function lerStorage(chave, fallback) {
  try { return JSON.parse(localStorage.getItem(chave)) ?? fallback; } catch { return fallback; }
}

export default function App() {
  const emDemo = isDemo();
  // Em demo não há login: as chamadas são respondidas pelo interceptador local.
  const [sessao, setSessao] = useState(() => (emDemo ? { usuario: null } : lerSessao()));
  const [dados,  setDados]  = useState(null);
  const [erro,   setErro]   = useState(null);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState(null);
  const [segundos, setSegundos] = useState(0);
  const [modo, setModo] = useState(() => lerStorage(LS_MODO, 'monitoramento'));

  const isoHoje = new Date().toISOString().slice(0, 10);
  const [dataInicio, setDataInicio] = useState(isoHoje);
  const [dataFim,    setDataFim]    = useState(isoHoje);

  function calcPeriodo(ini, fim) {
    const dias = Math.max(1, Math.round(
      (new Date(fim + 'T00:00:00Z') - new Date(ini + 'T00:00:00Z')) / 86400000
    ) + 1);
    const label = ini === fim
      ? (ini === new Date().toISOString().slice(0, 10) ? 'hoje' : '1d')
      : `${dias}d`;
    return { label, dias };
  }

  const [usuario,     setUsuario]     = useState(null);
  const [customNames, setCustomNames] = useState(() => lerStorage(LS_NOMES, {}));
  const [favoritos,   setFavoritos]   = useState(() => lerStorage(LS_FAVS,  []));
  const [gestorFiltro, setGestorFiltro] = useState(() => lerStorage(LS_GESTOR, 'todos'));
  const [contaSelecionadaId, setContaSelecionadaId] = useState(null);

  const rangeRef = useRef({ dataInicio: isoHoje, dataFim: isoHoje });
  rangeRef.current = { dataInicio, dataFim };

  const buscarDados = useCallback(async () => {
    if (!sessao) return;
    try {
      const { dataInicio: ini, dataFim: fim } = rangeRef.current;
      const json = await apiFetch(`/dashboard/data?dataInicio=${ini}&dataFim=${fim}`);
      setDados(json);
      setUsuario(json.usuario ?? null);
      setUltimaAtualizacao(new Date());
      setSegundos(0);
      setErro(null);
    } catch (e) {
      // Sessão caiu (expirou ou usuário desativado): volta pra tela de login.
      if (e.status === 401) { setSessao(null); setDados(null); return; }
      setErro(e.message ?? 'Não foi possível conectar ao servidor.');
    }
  }, [sessao]);

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

  function handleSair() {
    encerrarSessao();
    setSessao(null);
    setDados(null);
    setUsuario(null);
    setErro(null);
  }

  function handleModo(m) {
    setModo(m);
    setContaSelecionadaId(null);
    try { localStorage.setItem(LS_MODO, JSON.stringify(m)); } catch {}
  }

  if (!sessao) {
    return <Login onEntrar={(nova) => { setErro(null); setSessao(nova); }} />;
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
        <button className="error-sair" onClick={handleSair}>Sair</button>
      </div>
    );
  }

  if (!dados) return <div className="loading">Carregando...</div>;

  const contas = dados.contas ?? [];
  const contaSelecionada = contaSelecionadaId ? contas.find((c) => c.id === contaSelecionadaId) ?? null : null;
  const painelAberto = contaSelecionada !== null;
  const periodo = calcPeriodo(dataInicio, dataFim);

  const BANNER_H = 26;

  return (
    <>
      {emDemo && (
        <div style={{
          height: BANNER_H, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 600, letterSpacing: '.02em', color: '#fff', background: '#7c3aed',
        }}>
          Ambiente demonstrativo — dados fictícios, apenas para fins de apresentação
        </div>
      )}
      <div className="app-shell" style={emDemo ? { height: `calc(100vh - ${BANNER_H}px)` } : undefined}>
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
          onSair={emDemo ? null : handleSair}
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
                periodo={periodo}
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
                  periodo={periodo}
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
    </>
  );
}
