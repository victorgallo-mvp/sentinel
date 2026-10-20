import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api.js';
import './AlteracoesView.css';

/**
 * Painel de alterações: o que foi feito nas contas, por quem e quando.
 *
 * Três leituras dos mesmos eventos — por gestor (quem está trabalhando),
 * por conta (o que está parado) e a linha do tempo (o que foi feito). A
 * agregação é feita aqui porque as três precisam cruzar os mesmos dados com
 * a lista de contas e gestores.
 */

const BRT = 'America/Sao_Paulo';
const PERIODOS = [
  { dias: 7,  rotulo: '7 dias' },
  { dias: 14, rotulo: '14 dias' },
  { dias: 30, rotulo: '30 dias' },
  { dias: 60, rotulo: '60 dias' },
];
const DIAS_PARADA = 7;
const SEM_VINCULO = '__sem_vinculo__';

const diaChave  = (iso) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: BRT });
const diaLongo  = (iso) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: BRT, weekday: 'long', day: '2-digit', month: 'long' });
const diaCurto  = (iso) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: BRT, day: '2-digit', month: '2-digit' });
const hora      = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: BRT, hour: '2-digit', minute: '2-digit' });
const diasDesde = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null);
const isoDiasAtras = (n) => new Date(Date.now() - 3 * 3600000 - n * 86400000).toISOString().slice(0, 10);

function rotuloParada(dias) {
  if (dias == null) return { texto: 'sem registro', nivel: 'crit' };
  if (dias === 0) return { texto: 'hoje', nivel: 'ok' };
  if (dias === 1) return { texto: 'ontem', nivel: 'ok' };
  return { texto: `há ${dias} dias`, nivel: dias >= DIAS_PARADA * 2 ? 'crit' : dias >= DIAS_PARADA ? 'warn' : 'ok' };
}

/** Junta ações iguais e consecutivas ("adicionou imagem" ×8). */
function agruparRepetidas(lista) {
  const saida = [];
  for (const e of lista) {
    const ultima = saida[saida.length - 1];
    if (ultima && ultima.frase === e.frase && ultima.campanhaNome === e.campanhaNome) ultima.vezes++;
    else saida.push({ ...e, vezes: 1 });
  }
  return saida;
}

export default function AlteracoesView({ contaFiltroId = null, gestorFiltroNome = 'todos', customNames = {} }) {
  const [dias, setDias] = useState(14);
  const [aba, setAba] = useState('gestores');
  const [gestorSel, setGestorSel] = useState('todos');
  const [contaSel, setContaSel] = useState('todas');
  const [categoriaSel, setCategoriaSel] = useState('todas');
  const [mostrarSistema, setMostrarSistema] = useState(false);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [vinculando, setVinculando] = useState(null);

  async function carregar() {
    try {
      const desde = isoDiasAtras(dias - 1);
      const ate = isoDiasAtras(0);
      const json = await apiFetch(`/dashboard/alteracoes?desde=${desde}&ate=${ate}`);
      setDados(json);
      setErro(null);
    } catch (e) {
      setErro(e.message ?? 'Não foi possível carregar as alterações.');
    }
  }
  useEffect(() => { carregar(); }, [dias]); // eslint-disable-line react-hooks/exhaustive-deps

  // Conta escolhida na barra lateral vira filtro aqui.
  useEffect(() => {
    if (!contaFiltroId || !dados) return;
    const c = dados.contas.find((x) => x.id === contaFiltroId);
    if (c) { setContaSel(c.identificador); setAba('linha'); }
  }, [contaFiltroId, dados]);

  // Filtro de gestor da barra lateral (por nome) acompanha, quando casar.
  useEffect(() => {
    if (!dados) return;
    if (gestorFiltroNome === 'todos' || gestorFiltroNome === 'sem-gestor') { setGestorSel('todos'); return; }
    const g = dados.gestores.find((x) => x.nome === gestorFiltroNome);
    if (g) setGestorSel(g.id);
  }, [gestorFiltroNome, dados]);

  const modelo = useMemo(() => (dados ? montarModelo(dados, customNames) : null), [dados, customNames]);

  const visiveis = useMemo(() => {
    if (!modelo) return [];
    return modelo.eventos.filter((e) => {
      if (!mostrarSistema && (e.sistema || e.oculto)) return false;
      if (contaSel !== 'todas' && e.contaId !== contaSel) return false;
      if (categoriaSel !== 'todas' && e.categoria !== categoriaSel) return false;
      if (gestorSel === SEM_VINCULO && (e.sistema || e.gestorId)) return false;
      if (gestorSel.startsWith('autor:') && `autor:${e.autorId}` !== gestorSel) return false;
      if (gestorSel !== 'todos' && gestorSel !== SEM_VINCULO && !gestorSel.startsWith('autor:') && e.gestorId !== gestorSel) return false;
      return true;
    });
  }, [modelo, mostrarSistema, contaSel, categoriaSel, gestorSel]);

  async function vincular(autor, gestorId) {
    if (!gestorId) return;
    setVinculando(autor.autorId);
    try {
      await apiFetch('/dashboard/alteracoes/autores', {
        method: 'PATCH',
        body: JSON.stringify({ autorId: autor.autorId, autorNome: autor.autorNome, gestorId }),
      });
      await carregar();
    } catch (e) {
      setErro(e.message ?? 'Não foi possível vincular o autor.');
    } finally {
      setVinculando(null);
    }
  }

  if (erro) return <div className="alt-estado alt-estado--erro">{erro}</div>;
  if (!modelo) return <div className="alt-estado">Carregando alterações…</div>;

  const { kpis, porGestor, porConta, autoresSemVinculo, contas, gestores, categorias } = modelo;

  return (
    <div className="alt">
      {/* ── Cabeçalho ── */}
      <header className="alt-head">
        <div>
          <h1 className="alt-titulo">Alterações nas contas</h1>
          <p className="alt-sub">Quem fez o quê, em qual conta e quando. Lido do histórico da Meta toda madrugada.</p>
        </div>
        <div className="alt-periodos">
          {PERIODOS.map((p) => (
            <button key={p.dias} className={`alt-chip${dias === p.dias ? ' alt-chip--ativo' : ''}`} onClick={() => setDias(p.dias)}>{p.rotulo}</button>
          ))}
        </div>
      </header>

      {/* ── Indicadores ── */}
      <section className="alt-kpis">
        <Kpi valor={kpis.acoes} rotulo="ações de gestores" sub={`em ${dias} dias`} />
        <Kpi valor={kpis.gestoresAtivos} rotulo="pessoas atuando" sub={kpis.semVinculo ? `${kpis.semVinculo} sem vínculo` : 'todas vinculadas'} nivel={kpis.semVinculo ? 'warn' : null} />
        <Kpi valor={`${kpis.contasTocadas}/${contas.length}`} rotulo="contas com alguma ação" sub="no período" />
        <Kpi valor={kpis.contasParadas} rotulo={`contas paradas há ${DIAS_PARADA}+ dias`} sub="sem ação humana" nivel={kpis.contasParadas ? 'crit' : 'ok'} />
      </section>

      {/* ── Autores sem vínculo ── */}
      {autoresSemVinculo.length > 0 && (
        <section className="alt-vinculo">
          <div className="alt-vinculo-head">
            <strong>Quem é quem?</strong>
            <span>
              {gestores.length
                ? 'Usuários da Meta que ainda não estão ligados a um gestor. Vincular reatribui todo o histórico.'
                : 'Usuários da Meta vistos nas contas. Para vinculá-los, cadastre os gestores (Perfil da conta → gestor responsável).'}
            </span>
          </div>
          <div className="alt-vinculo-lista">
            {autoresSemVinculo.map((a) => (
              <div key={a.autorId} className="alt-vinculo-item">
                <span className="alt-vinculo-nome">{a.autorNome}</span>
                <span className="alt-vinculo-meta">{a.eventos} eventos · {a.contas.length} conta{a.contas.length > 1 ? 's' : ''} · último {diaCurto(a.ultimoEm)}</span>
                {gestores.length > 0 ? (
                  <select
                    className="alt-select"
                    defaultValue=""
                    disabled={vinculando === a.autorId}
                    onChange={(ev) => vincular(a, ev.target.value)}
                  >
                    <option value="" disabled>{vinculando === a.autorId ? 'Vinculando…' : 'Vincular a…'}</option>
                    {gestores.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
                  </select>
                ) : <span className="alt-fraco">sem gestor cadastrado</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Abas + filtros ── */}
      <div className="alt-barra">
        <nav className="alt-abas">
          <button className={`alt-aba${aba === 'gestores' ? ' alt-aba--ativa' : ''}`} onClick={() => setAba('gestores')}>Por gestor</button>
          <button className={`alt-aba${aba === 'contas' ? ' alt-aba--ativa' : ''}`} onClick={() => setAba('contas')}>Por conta</button>
          <button className={`alt-aba${aba === 'linha' ? ' alt-aba--ativa' : ''}`} onClick={() => setAba('linha')}>Linha do tempo</button>
        </nav>
        <div className="alt-filtros">
          <select className="alt-select" value={gestorSel} onChange={(e) => setGestorSel(e.target.value)}>
            <option value="todos">Todos os gestores</option>
            {gestores.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
            {autoresSemVinculo.map((a) => <option key={a.autorId} value={`autor:${a.autorId}`}>{a.autorNome} (sem vínculo)</option>)}
          </select>
          <select className="alt-select" value={contaSel} onChange={(e) => setContaSel(e.target.value)}>
            <option value="todas">Todas as contas</option>
            {contas.map((c) => <option key={c.identificador} value={c.identificador}>{c.nomeExibido}</option>)}
          </select>
          <select className="alt-select" value={categoriaSel} onChange={(e) => setCategoriaSel(e.target.value)}>
            <option value="todas">Todas as categorias</option>
            {Object.entries(categorias).filter(([k]) => k !== 'sistema').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label className="alt-toggle">
            <input type="checkbox" checked={mostrarSistema} onChange={(e) => setMostrarSistema(e.target.checked)} />
            automáticos da Meta
          </label>
        </div>
      </div>

      {aba === 'gestores' && <TabelaGestores linhas={porGestor} onVer={(id) => { setGestorSel(id); setAba('linha'); }} />}
      {aba === 'contas'   && <TabelaContas linhas={porConta} onVer={(ident) => { setContaSel(ident); setAba('linha'); }} />}
      {aba === 'linha'    && <LinhaDoTempo eventos={visiveis} contas={contas} mostrarSistema={mostrarSistema} />}
    </div>
  );
}

/* ───────────────────────────── modelo ───────────────────────────── */

export function montarModelo(dados, customNames) {
  const contas = dados.contas.map((c) => ({ ...c, nomeExibido: customNames[c.id] ?? c.nome }));
  const nomeConta = new Map(contas.map((c) => [c.identificador, c.nomeExibido]));
  const eventos = dados.eventos.map((e) => ({ ...e, contaNome: nomeConta.get(e.contaId) ?? e.contaId }));
  const humanos = eventos.filter((e) => !e.sistema && !e.oculto);
  const gestores = dados.gestores;
  const nomeGestor = new Map(gestores.map((g) => [g.id, g.nome]));

  // ── por gestor ──
  // Uma linha por gestor cadastrado e uma por autor da Meta ainda sem vínculo:
  // quem trabalha aparece mesmo antes de o cadastro existir.
  const base = (nome, semVinculo) => ({ nome, semVinculo, acoes: 0, dias: new Set(), contasTocadas: new Set(), ultima: null, categorias: {} });
  const acum = new Map(gestores.map((g) => [g.id, base(g.nome, false)]));
  for (const e of humanos) {
    const k = e.gestorId && acum.has(e.gestorId) ? e.gestorId : `autor:${e.autorId}`;
    if (!acum.has(k)) acum.set(k, base(e.autorNome, true));
    const a = acum.get(k);
    a.acoes++; a.dias.add(diaChave(e.ocorridaEm)); a.contasTocadas.add(e.contaId);
    a.categorias[e.categoria] = (a.categorias[e.categoria] ?? 0) + 1;
    if (!a.ultima || e.ocorridaEm > a.ultima.ocorridaEm) a.ultima = e;
  }
  const porGestor = [...acum.entries()].map(([id, a]) => {
    // Gestor: as contas sob sua responsabilidade. Autor sem vínculo: as contas
    // em que ele foi o último a mexer — é o que dá para saber sem cadastro.
    const atendidas = a.semVinculo
      ? contas.filter((c) => c.ultimaAcao && `autor:${c.ultimaAcao.autorId}` === id)
      : contas.filter((c) => c.gestorId === id);
    const paradas = atendidas.filter((c) => { const d = diasDesde(c.ultimaAcao?.ocorridaEm); return d == null || d >= DIAS_PARADA; });
    return {
      id,
      nome: a.nome,
      semVinculo: a.semVinculo,
      atendidas: atendidas.length,
      contasTocadas: a.contasTocadas.size,
      acoes: a.acoes,
      diasAtivos: a.dias.size,
      ultima: a.ultima,
      paradas,
      categorias: Object.entries(a.categorias).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([c, n]) => `${dados.categorias[c] ?? c} ${n}`),
    };
  }).filter((g) => !g.semVinculo || g.acoes > 0)
    .sort((x, y) => y.acoes - x.acoes);

  // ── por conta ──
  const porContaAcum = new Map(contas.map((c) => [c.identificador, { acoes: 0, autores: {}, categorias: {} }]));
  for (const e of humanos) {
    const a = porContaAcum.get(e.contaId); if (!a) continue;
    a.acoes++;
    const autor = e.gestorId ? nomeGestor.get(e.gestorId) ?? e.autorNome : e.autorNome;
    a.autores[autor] = (a.autores[autor] ?? 0) + 1;
    a.categorias[e.categoria] = (a.categorias[e.categoria] ?? 0) + 1;
  }
  const porConta = contas.map((c) => {
    const a = porContaAcum.get(c.identificador);
    const dias = diasDesde(c.ultimaAcao?.ocorridaEm);
    return {
      identificador: c.identificador,
      nome: c.nomeExibido,
      responsavel: c.gerenteResponsavel || '—',
      acoes: a.acoes,
      autorPrincipal: Object.entries(a.autores).sort((x, y) => y[1] - x[1])[0]?.[0] ?? null,
      categorias: Object.entries(a.categorias).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, n]) => `${dados.categorias[k] ?? k} ${n}`),
      ultimaAcao: c.ultimaAcao,
      diasParada: dias,
      parada: rotuloParada(dias),
    };
  }).sort((x, y) => (y.diasParada ?? 9999) - (x.diasParada ?? 9999));

  const autoresSemVinculo = dados.autores.filter((a) => !a.gestorId);

  const kpis = {
    acoes: humanos.length,
    gestoresAtivos: new Set(humanos.map((e) => e.gestorId ?? `autor:${e.autorId}`)).size,
    semVinculo: autoresSemVinculo.length,
    contasTocadas: new Set(humanos.map((e) => e.contaId)).size,
    contasParadas: porConta.filter((c) => c.diasParada == null || c.diasParada >= DIAS_PARADA).length,
  };

  return { eventos, kpis, porGestor, porConta, autoresSemVinculo, contas, gestores, categorias: dados.categorias };
}

/* ───────────────────────────── blocos ───────────────────────────── */

function Kpi({ valor, rotulo, sub, nivel }) {
  return (
    <div className={`alt-kpi${nivel ? ` alt-kpi--${nivel}` : ''}`}>
      <span className="alt-kpi-valor">{valor}</span>
      <span className="alt-kpi-rotulo">{rotulo}</span>
      {sub && <span className="alt-kpi-sub">{sub}</span>}
    </div>
  );
}

export function TabelaGestores({ linhas, onVer }) {
  if (!linhas.length) return <div className="alt-estado">Nenhum gestor cadastrado. Cadastre em Perfil da conta.</div>;
  return (
    <table className="alt-tabela">
      <thead>
        <tr>
          <th>Gestor</th>
          <th className="alt-n" title="Gestor: contas sob sua responsabilidade. Sem vínculo: contas em que foi o último a mexer">Contas</th>
          <th className="alt-n">Com ação</th>
          <th className="alt-n">Ações</th>
          <th className="alt-n">Dias ativos</th>
          <th>Última ação</th>
          <th>Contas paradas</th>
          <th>Mais fez</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {linhas.map((g) => (
          <tr key={g.id} className={g.semVinculo ? 'alt-linha--aviso' : ''}>
            <td className="alt-forte">{g.nome}{g.semVinculo && <span className="alt-fraco alt-tag"> sem vínculo</span>}</td>
            <td className="alt-n">{g.atendidas}</td>
            <td className="alt-n">{g.contasTocadas}</td>
            <td className="alt-n alt-forte">{g.acoes}</td>
            <td className="alt-n">{g.diasAtivos}</td>
            <td>{g.ultima ? <><span>{diaCurto(g.ultima.ocorridaEm)} {hora(g.ultima.ocorridaEm)}</span><span className="alt-fraco"> · {g.ultima.contaNome}</span></> : <span className="alt-fraco">nenhuma</span>}</td>
            <td>
              {g.paradas.length === 0 ? <span className="alt-ok">nenhuma</span>
                : <span className="alt-crit">{g.paradas.map((c) => c.nomeExibido).join(', ')}</span>}
            </td>
            <td className="alt-fraco">{g.categorias.join(' · ') || '—'}</td>
            <td><button className="alt-link" onClick={() => onVer(g.id)}>ver ações</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function TabelaContas({ linhas, onVer }) {
  return (
    <table className="alt-tabela">
      <thead>
        <tr>
          <th>Conta</th>
          <th>Responsável</th>
          <th>Última ação humana</th>
          <th className="alt-n">Ações no período</th>
          <th>Quem mais mexeu</th>
          <th>Mais fez</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {linhas.map((c) => (
          <tr key={c.identificador}>
            <td className="alt-forte">{c.nome}</td>
            <td>{c.responsavel}</td>
            <td>
              <span className={`alt-selo alt-selo--${c.parada.nivel}`}>{c.parada.texto}</span>
              {c.ultimaAcao && <span className="alt-fraco"> {diaCurto(c.ultimaAcao.ocorridaEm)} · {c.ultimaAcao.autorNome}: {c.ultimaAcao.frase}</span>}
            </td>
            <td className="alt-n alt-forte">{c.acoes}</td>
            <td>{c.autorPrincipal ?? <span className="alt-fraco">—</span>}</td>
            <td className="alt-fraco">{c.categorias.join(' · ') || '—'}</td>
            <td><button className="alt-link" onClick={() => onVer(c.identificador)}>ver ações</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function LinhaDoTempo({ eventos, mostrarSistema }) {
  if (!eventos.length) return <div className="alt-estado">Nenhuma alteração com esses filtros.</div>;

  // dia → conta → autor → eventos (os eventos chegam do mais novo para o mais antigo)
  const dias = new Map();
  for (const e of eventos) {
    const d = diaChave(e.ocorridaEm);
    if (!dias.has(d)) dias.set(d, { iso: e.ocorridaEm, contas: new Map() });
    const contas = dias.get(d).contas;
    if (!contas.has(e.contaId)) contas.set(e.contaId, { nome: e.contaNome, autores: new Map() });
    const autores = contas.get(e.contaId).autores;
    const autor = e.sistema ? 'Meta (automático)' : e.autorNome;
    if (!autores.has(autor)) autores.set(autor, []);
    autores.get(autor).push(e);
  }

  return (
    <div className="alt-linha">
      {[...dias.entries()].map(([d, dia]) => (
        <section key={d} className="alt-dia">
          <h2 className="alt-dia-titulo">{diaLongo(dia.iso)}</h2>
          {[...dia.contas.entries()].map(([ident, conta]) => (
            <div key={ident} className="alt-conta">
              <h3 className="alt-conta-nome">{conta.nome}</h3>
              {[...conta.autores.entries()].map(([autor, lista]) => {
                const sistema = lista[0].sistema;
                const ordenada = [...lista].reverse(); // cronológica dentro do dia
                return (
                  <div key={autor} className={`alt-autor${sistema ? ' alt-autor--sistema' : ''}`}>
                    <div className="alt-autor-head">
                      <span className="alt-autor-nome">{autor}</span>
                      <span className="alt-autor-n">{lista.length} {lista.length === 1 ? 'evento' : 'eventos'}</span>
                    </div>
                    <ul className="alt-acoes">
                      {agruparRepetidas(ordenada).map((e, i) => (
                        <li key={e.id ?? i} className={`alt-acao alt-acao--${e.categoria}${e.oculto ? ' alt-acao--oculta' : ''}`}>
                          <span className="alt-acao-hora">{hora(e.ocorridaEm)}</span>
                          <span className="alt-acao-frase">
                            {e.frase}{e.vezes > 1 ? <span className="alt-vezes"> ×{e.vezes}</span> : null}
                            {e.campanhaNome && e.objetoTipo !== 'campanha' && e.objetoTipo !== 'conta' && (
                              <span className="alt-fraco"> · campanha {e.campanhaNome}</span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          ))}
        </section>
      ))}
      {!mostrarSistema && <p className="alt-rodape">Eventos automáticos da Meta (cobranças, aprovações, públicos) e ajustes menores estão ocultos. Ative "automáticos da Meta" para vê-los.</p>}
    </div>
  );
}
