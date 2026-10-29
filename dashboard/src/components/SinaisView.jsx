import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api.js';
import './SinaisView.css';

/**
 * Painel de sinais: o que está vazando, o que está por vir e onde realocar.
 *
 * Três camadas, da mais resumida para a mais detalhada:
 * 1. Indicadores, previsões e prioridades do dia — cabe numa tela.
 * 2. Uma linha por conta (acordeão, fechado por padrão).
 * 3. Dentro da conta: a leitura da IA como camada principal; os sinais crus
 *    ficam atrás de "ver os N sinais".
 *
 * Nenhum cálculo além de somas: frase, explicação, sugestão e prioridades
 * vêm prontas do backend, para painel e IA lerem o mesmo.
 */

const ORDEM_SEV = { alta: 0, media: 1, baixa: 2 };
const TIPOS_PREVISAO = ['fadiga_iminente', 'queda_performance', 'fadiga_criativo'];
const ROTULO_ORIGEM = { meta: 'objetivo do conjunto na Meta', onboarding: 'perfil da conta', dados: 'o que tem dado', proxy: 'cliques no link (sem objetivo claro)' };
const ROTULO_METRICA = {
  conversions: 'compras', leads: 'leads', messaging_conversations_started: 'conversas',
  landing_page_views: 'visualizações da página', video_thruplay_watched_actions: 'ThruPlays', inline_link_clicks: 'cliques no link',
};
const ROTULO_TENDENCIA = { melhorando: 'melhorando', estavel: 'estável', piorando: 'piorando', sem_base: 'sem base' };
const ROTULO_NATUREZA = { vazando: 'vazando', recuperavel: 'recuperáveis', projetado: 'projetados' };

const brl = (v) => `R$ ${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const brl0 = (v) => `R$ ${Math.round(Number(v ?? 0)).toLocaleString('pt-BR')}`;
const diaLongo = (iso) => (iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }) : '');
const isoDiasAtras = (iso, n) => new Date(new Date(iso + 'T12:00:00Z').getTime() - n * 86400000).toISOString().slice(0, 10);

function impactoTexto(p) {
  if (p.impactoDia == null) return '';
  const pre = p.natureza === 'recuperavel' ? '+' : p.natureza === 'projetado' ? '~' : '';
  return `${pre}${brl0(p.impactoDia)}/dia ${ROTULO_NATUREZA[p.natureza] ?? ''}`.trim();
}

/** Valor em R$/dia de um sinal e sua natureza, na mesma convenção da leitura. */
function valorSinal(s) {
  if (s.desperdicioDia != null) return { texto: `${brl(s.desperdicioDia)}/dia`, classe: 'crit' };
  if (s.economiaDia != null) return { texto: `+${brl(s.economiaDia)}/dia`, classe: 'ok' };
  if (s.evidencia?.extraProjetadoDia != null) return { texto: `~${brl(s.evidencia.extraProjetadoDia)}/dia`, classe: 'muted' };
  return null;
}

/** "Em N dias" ou "custo projetado": o que a previsão antecipa, em poucas palavras. */
function horizontePrevisao(s) {
  const e = s.evidencia ?? {};
  if (s.tipo === 'fadiga_iminente' && e.diasAteSaturar != null) return `satura em ${e.diasAteSaturar} ${e.diasAteSaturar === 1 ? 'dia' : 'dias'}`;
  if (s.tipo === 'queda_performance' && e.custoProjetado7d != null) return `próxima semana a ${brl(e.custoProjetado7d)}`;
  if (s.tipo === 'fadiga_criativo' && e.frequencia7d != null) return `frequência ${Number(e.frequencia7d).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}`;
  return null;
}

export default function SinaisView({ contaFiltroId = null, customNames = {} }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [contaSel, setContaSel] = useState('todas');
  const [soAlta, setSoAlta] = useState(false);
  const [abertas, setAbertas] = useState(() => new Set());

  useEffect(() => {
    let vivo = true;
    apiFetch('/dashboard/sinais')
      .then((json) => { if (vivo) { setDados(json); setErro(null); } })
      .catch((e) => { if (vivo) setErro(e.message ?? 'Não foi possível carregar os sinais.'); });
    return () => { vivo = false; };
  }, []);

  // Conta escolhida na barra lateral vira filtro aqui e abre sozinha.
  useEffect(() => {
    if (!contaFiltroId || !dados) return;
    const c = dados.contas.find((x) => x.id === contaFiltroId);
    if (c) { setContaSel(c.identificador); setAbertas(new Set([c.identificador])); }
  }, [contaFiltroId, dados]);

  const modelo = useMemo(() => (dados ? montarModelo(dados, customNames) : null), [dados, customNames]);

  function focar(identificador) {
    setContaSel(identificador);
    setAbertas(new Set([identificador]));
  }
  function alternar(identificador) {
    setAbertas((prev) => {
      const next = new Set(prev);
      if (next.has(identificador)) next.delete(identificador); else next.add(identificador);
      return next;
    });
  }

  if (erro) return <div className="sn-estado sn-estado--erro">{erro}</div>;
  if (!modelo) return <div className="sn-estado">Carregando sinais…</div>;

  const { dia, kpis, porConta, contas, rotulos, prioridadesDia, previsoes, comLeitura } = modelo;
  const blocos = porConta
    .filter((b) => contaSel === 'todas' || b.identificador === contaSel)
    .map((b) => ({ ...b, sinaisVisiveis: soAlta ? b.sinais.filter((s) => s.severidade === 'alta') : b.sinais }))
    .filter((b) => b.sinaisVisiveis.length > 0);

  return (
    <div className="sn">
      <header className="sn-head">
        <div>
          <h1 className="sn-titulo">Sinais</h1>
          <p className="sn-sub">
            {dia
              ? <>Rodada de <strong>{diaLongo(dia)}</strong>, com dados fechados até anteontem. {comLeitura} {comLeitura === 1 ? 'conta lida' : 'contas lidas'} pela IA.</>
              : 'O que está vazando, o que está por vir e onde realocar.'}
          </p>
        </div>
      </header>

      {!dia ? (
        <div className="sn-estado">
          Nenhuma rodada gravada ainda. O motor roda todo dia às 04:00; para gerar agora, no servidor: <code>npm run sinais -- --gravar</code>
        </div>
      ) : (
        <>
          <section className="sn-kpis">
            <Kpi valor={`${brl0(kpis.desperdicio)}/dia`} rotulo="vazando" sub={deltaTexto(kpis.desperdicio, kpis.desperdicioOntem)} nivel={kpis.desperdicio > 0 ? 'crit' : 'ok'} />
            <Kpi valor={`${brl0(kpis.recuperavel)}/dia`} rotulo="recuperáveis" sub="realocando orçamento" nivel={kpis.recuperavel > 0 ? 'accent' : null} />
            <Kpi valor={kpis.previsoes} rotulo={kpis.previsoes === 1 ? 'previsão' : 'previsões'} sub="para agir antes" />
            <Kpi valor={`${kpis.contasComSinal}/${contas.length}`} rotulo="contas com sinal" sub={`${kpis.altos} de severidade alta`} nivel={kpis.altos > 0 ? 'crit' : null} />
          </section>

          {contaSel === 'todas' && previsoes.length > 0 && (
            <section className="sn-bloco">
              <header className="sn-bloco-head">
                <h2 className="sn-bloco-titulo">Previsões</h2>
                <span className="sn-bloco-sub">Ainda não custou nada. É onde dá para agir antes.</span>
              </header>
              <table className="sn-tabela">
                <thead>
                  <tr><th>Conta</th><th>O que vem</th><th>Onde</th><th>Horizonte</th></tr>
                </thead>
                <tbody>
                  {previsoes.map((s) => (
                    <tr key={s.id} className="sn-tr--link" onClick={() => focar(s.contaId)}>
                      <td className="sn-td-conta">{s.contaNome}</td>
                      <td><span className="sn-tipo-forte">{s.tipoRotulo}</span><span className="sn-td-frase">{s.frase}</span></td>
                      <td className="sn-td-onde"><Caminho s={s} /></td>
                      <td className="sn-td-hor">{horizontePrevisao(s) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {contaSel === 'todas' && prioridadesDia.length > 0 && (
            <section className="sn-bloco">
              <header className="sn-bloco-head">
                <h2 className="sn-bloco-titulo">Prioridades do dia</h2>
                <span className="sn-bloco-sub">A primeira prioridade de cada conta, pela leitura da IA.</span>
              </header>
              <table className="sn-tabela">
                <thead>
                  <tr><th>#</th><th>Conta</th><th>Prioridade</th><th>Impacto</th><th>Tendência</th></tr>
                </thead>
                <tbody>
                  {prioridadesDia.map((p, i) => (
                    <tr key={p.identificador} className="sn-tr--link" onClick={() => focar(p.identificador)}>
                      <td className="sn-td-n">{i + 1}</td>
                      <td className="sn-td-conta">{p.contaNome}</td>
                      <td>{p.titulo}</td>
                      <td className="sn-td-imp">{p.impactoDia != null && <span className={`sn-imp sn-imp--${p.natureza}`}>{impactoTexto(p)}</span>}</td>
                      <td><Tendencia t={p.tendencia} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <div className="sn-barra">
            <h2 className="sn-bloco-titulo">Por conta</h2>
            <div className="sn-filtros">
              <select className="sn-select" value={contaSel} onChange={(e) => { setContaSel(e.target.value); if (e.target.value !== 'todas') setAbertas(new Set([e.target.value])); }}>
                <option value="todas">Todas as contas</option>
                {contas.map((c) => <option key={c.identificador} value={c.identificador}>{c.nomeExibido}</option>)}
              </select>
              <label className="sn-toggle">
                <input type="checkbox" checked={soAlta} onChange={(e) => setSoAlta(e.target.checked)} />
                só severidade alta
              </label>
            </div>
          </div>

          {blocos.length === 0 ? (
            <div className="sn-estado">Nenhum sinal com esses filtros.{contaSel !== 'todas' ? ' Esta conta está limpa na última rodada.' : ''}</div>
          ) : (
            <div className="sn-lista">
              {blocos.map((b) => (
                <BlocoConta key={b.identificador} bloco={b} rotulos={rotulos} aberta={abertas.has(b.identificador)} onAlternar={() => alternar(b.identificador)} />
              ))}
            </div>
          )}
          <p className="sn-rodape">
            Só a categoria desperdício entra em "vazando". Previsões ainda não custaram nada; orçamento é ganho possível. Janelas terminam anteontem porque o último dia ainda recebe atribuição.
          </p>
        </>
      )}
    </div>
  );
}

/* ───────────────────────────── modelo ───────────────────────────── */

export function montarModelo(dados, customNames) {
  const contas = dados.contas.map((c) => ({ ...c, nomeExibido: customNames[c.id] ?? c.nome }));
  const porIdent = new Map(contas.map((c) => [c.identificador, c]));
  const dia = dados.dia;
  const ontem = dia ? isoDiasAtras(dia, 1) : null;
  const serieOntem = new Map(dados.serie.filter((p) => p.dia === ontem).map((p) => [p.contaId, p.desperdicioDia]));
  const leituras = dados.leituras ?? {};

  const grupos = new Map();
  for (const s of dados.sinais) {
    if (!grupos.has(s.contaId)) grupos.set(s.contaId, []);
    grupos.get(s.contaId).push(s);
  }

  const porConta = [...grupos.entries()].map(([ident, sinais]) => {
    const conta = porIdent.get(ident);
    const desperdicio = sinais.filter((s) => s.categoria === 'desperdicio').reduce((t, s) => t + (s.desperdicioDia ?? 0), 0);
    const recuperavel = sinais.reduce((t, s) => t + (s.economiaDia ?? 0), 0);
    return {
      identificador: ident,
      nome: conta?.nomeExibido ?? ident,
      gestor: conta?.gerenteResponsavel ?? '',
      desperdicio,
      desperdicioOntem: serieOntem.get(ident) ?? null,
      recuperavel,
      altos: sinais.filter((s) => s.severidade === 'alta').length,
      previsoes: sinais.filter((s) => s.categoria === 'previsao').length,
      leitura: leituras[ident] ?? null,
      sinais: [...sinais].sort((a, b) => (ORDEM_SEV[a.severidade] - ORDEM_SEV[b.severidade]) || ((b.desperdicioDia ?? b.economiaDia ?? 0) - (a.desperdicioDia ?? a.economiaDia ?? 0))),
    };
  }).sort((a, b) => (b.desperdicio - a.desperdicio) || (b.altos - a.altos) || (b.sinais.length - a.sinais.length));

  const porCategoria = {};
  for (const s of dados.sinais) porCategoria[s.categoria] = (porCategoria[s.categoria] ?? 0) + 1;

  // Previsões: sempre visíveis, independentes da ordem da leitura. Fadiga que
  // já aconteceu (criativo saturado) entra junto: é o que a previsão evita.
  const ordemPrev = { fadiga_criativo: 0, queda_performance: 1, fadiga_iminente: 2 };
  const previsoes = dados.sinais
    .filter((s) => TIPOS_PREVISAO.includes(s.tipo))
    .map((s) => ({ ...s, contaNome: porIdent.get(s.contaId)?.nomeExibido ?? s.contaId }))
    .sort((a, b) => (ordemPrev[a.tipo] - ordemPrev[b.tipo]) || (ORDEM_SEV[a.severidade] - ORDEM_SEV[b.severidade]) || ((a.evidencia?.diasAteSaturar ?? 99) - (b.evidencia?.diasAteSaturar ?? 99)));

  // Prioridades do dia: a primeira de cada conta, da de maior impacto para a
  // menor. Determinístico: nenhuma chamada a mais, só ordenação.
  const ORDEM_NAT = { vazando: 0, recuperavel: 1, projetado: 2 };
  const prioridadesDia = porConta
    .filter((b) => b.leitura?.prioridades?.length)
    .map((b) => ({ ...b.leitura.prioridades[0], contaNome: b.nome, identificador: b.identificador, tendencia: b.leitura.tendencia }))
    .sort((a, b) => ((ORDEM_NAT[a.natureza] ?? 3) - (ORDEM_NAT[b.natureza] ?? 3)) || ((b.impactoDia ?? 0) - (a.impactoDia ?? 0)));

  const kpis = {
    desperdicio: porConta.reduce((t, b) => t + b.desperdicio, 0),
    desperdicioOntem: ontem ? [...serieOntem.values()].reduce((t, v) => t + v, 0) : null,
    recuperavel: porConta.reduce((t, b) => t + b.recuperavel, 0),
    altos: dados.sinais.filter((s) => s.severidade === 'alta').length,
    total: dados.sinais.length,
    previsoes: previsoes.length,
    contasComSinal: porConta.length,
    porCategoria,
  };

  return { dia, kpis, porConta, contas, previsoes, prioridadesDia, comLeitura: porConta.filter((b) => b.leitura).length, rotulos: dados.rotulos ?? { tipos: {}, categorias: {} } };
}

function deltaTexto(hoje, ontem) {
  if (ontem == null) return 'sem rodada anterior';
  const d = hoje - ontem;
  if (Math.abs(d) < 1) return 'igual a ontem';
  return `${d > 0 ? '+' : '−'}${brl0(Math.abs(d))} vs. ontem`;
}

/* ───────────────────────────── componentes ───────────────────────────── */

function Kpi({ valor, rotulo, sub, nivel }) {
  return (
    <div className={`sn-kpi${nivel ? ` sn-kpi--${nivel}` : ''}`}>
      <span className="sn-kpi-valor">{valor}</span>
      <span className="sn-kpi-rotulo">{rotulo}</span>
      {sub && <span className="sn-kpi-sub">{sub}</span>}
    </div>
  );
}

function Tendencia({ t }) {
  if (!t || t === 'sem_base') return <span className="sn-fraco">—</span>;
  return <span className={`sn-tend sn-tend--${t}`}>{ROTULO_TENDENCIA[t]}</span>;
}

export function Caminho({ s, compacto = false }) {
  if (s.nivel === 'conta') return <span className="sn-cam sn-cam--conta">conta inteira</span>;
  const partes = [];
  if (s.campanhaNome) partes.push({ k: 'campanha', v: s.campanhaNome });
  if (s.nivel === 'adset') partes.push({ k: 'conjunto', v: s.entidadeNome });
  if (s.nivel === 'ad') {
    if (s.conjuntoNome) partes.push({ k: 'conjunto', v: s.conjuntoNome });
    partes.push({ k: 'anúncio', v: s.entidadeNome });
  }
  const titulo = partes.map((p) => `${p.k} "${p.v}"`).join(' › ');
  return (
    <span className={`sn-cam${compacto ? ' sn-cam--compacto' : ''}`} title={titulo}>
      {partes.map((p, i) => (
        <span key={p.k} className="sn-cam-item">
          {i > 0 && <span className="sn-cam-sep">›</span>}
          <span className="sn-cam-k">{p.k}</span> <span className="sn-cam-v">{p.v}</span>
        </span>
      ))}
    </span>
  );
}

function BlocoConta({ bloco, rotulos, aberta, onAlternar }) {
  const n = bloco.sinaisVisiveis.length;
  return (
    <section className={`sn-conta${aberta ? ' sn-conta--aberta' : ''}`}>
      <button className="sn-conta-head" onClick={onAlternar} aria-expanded={aberta}>
        <span className="sn-conta-seta" aria-hidden="true">›</span>
        <span className="sn-conta-nome">{bloco.nome}</span>
        {bloco.gestor && <span className="sn-conta-gestor">{bloco.gestor}</span>}
        <span className="sn-conta-tot">
          {bloco.desperdicio > 0 && <span className="sn-tot sn-tot--crit">{brl0(bloco.desperdicio)}/dia vazando</span>}
          {bloco.recuperavel > 0 && <span className="sn-tot sn-tot--ok">+{brl0(bloco.recuperavel)}/dia</span>}
          {bloco.previsoes > 0 && <span className="sn-tot">{bloco.previsoes} {bloco.previsoes === 1 ? 'previsão' : 'previsões'}</span>}
          <Tendencia t={bloco.leitura?.tendencia} />
          <span className="sn-tot sn-tot--n">{n} {n === 1 ? 'sinal' : 'sinais'}</span>
        </span>
      </button>

      {aberta && (
        <div className="sn-conta-corpo">
          {bloco.leitura ? <Leitura l={bloco.leitura} /> : <p className="sn-sem-leitura">Sem leitura da IA para esta conta nesta rodada.</p>}
          <details className="sn-sinais">
            <summary>Ver {n === 1 ? 'o sinal' : `os ${n} sinais`}</summary>
            <div className="sn-cards">
              {bloco.sinaisVisiveis.map((s) => <CardSinal key={s.id} s={s} rotulos={rotulos} />)}
            </div>
          </details>
        </div>
      )}
    </section>
  );
}

function Leitura({ l }) {
  return (
    <div className="sn-leitura">
      <p className="sn-leitura-resumo">{l.resumo}</p>
      {l.prioridades?.length > 0 && (
        <ol className="sn-prios">
          {l.prioridades.map((p) => (
            <li key={p.ordem} className="sn-prio">
              <span className="sn-prio-n">{p.ordem}</span>
              <div className="sn-prio-corpo">
                <div className="sn-prio-head">
                  <span className="sn-prio-tit">{p.titulo}</span>
                  {p.impactoDia != null && <span className={`sn-imp sn-imp--${p.natureza}`}>{impactoTexto(p)}</span>}
                </div>
                {p.onde && <div className="sn-prio-onde" title={p.onde}>{p.onde}</div>}
                <p className="sn-prio-acao">{p.acao}</p>
                {p.porque && (
                  <details className="sn-porque">
                    <summary>Por quê</summary>
                    <p>{p.porque}</p>
                  </details>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      {l.observacao && <p className="sn-leitura-obs"><strong>Obs.</strong> {l.observacao}</p>}
    </div>
  );
}

function CardSinal({ s, rotulos }) {
  const valor = valorSinal(s);
  const metrica = s.metricaResultado ? ROTULO_METRICA[s.metricaResultado] ?? s.metricaResultado : null;
  return (
    <article className="sn-card">
      <div className="sn-card-top">
        <span className={`sn-sev sn-sev--${s.severidade}`}>{s.severidade}</span>
        <span className="sn-card-tipo">{s.tipoRotulo ?? rotulos.tipos[s.tipo] ?? s.tipo}</span>
        <span className="sn-card-cat">{rotulos.categorias[s.categoria] ?? s.categoria}</span>
        {valor && <span className={`sn-valor sn-valor--${valor.classe}`}>{valor.texto}</span>}
      </div>
      <Caminho s={s} compacto />
      <p className="sn-frase">{s.frase}</p>
      <details className="sn-mais">
        <summary>Detalhes</summary>
        {s.sugestao && <p><strong>O que fazer.</strong> {s.sugestao}</p>}
        {s.explicacao && <p><strong>Como chegamos nisso.</strong> {s.explicacao}</p>}
        {metrica && s.origemResultado && <p className="sn-fraco">Resultado avaliado: {metrica}, definido por {ROTULO_ORIGEM[s.origemResultado] ?? s.origemResultado}.</p>}
      </details>
    </article>
  );
}
