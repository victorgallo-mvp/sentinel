import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api.js';
import './SinaisView.css';

/**
 * Painel de sinais: o que está vazando, o que está por vir e onde realocar,
 * por conta, sempre dizendo de qual campanha › conjunto › anúncio se trata.
 *
 * Lê a última rodada do motor de sinais (04:00 BRT, dados até anteontem).
 * Nenhum cálculo aqui além de somas para os indicadores: frase, explicação
 * e sugestão vêm prontas do backend, para que o painel e a IA leiam o mesmo.
 */

const CATEGORIAS = ['desperdicio', 'previsao', 'orcamento', 'risco', 'operacao'];
const ORDEM_SEV = { alta: 0, media: 1, baixa: 2 };
const ROTULO_ORIGEM = { meta: 'objetivo do conjunto na Meta', onboarding: 'perfil da conta', dados: 'o que tem dado', proxy: 'cliques no link (sem objetivo claro)' };
const ROTULO_METRICA = {
  conversions: 'compras', leads: 'leads', messaging_conversations_started: 'conversas',
  landing_page_views: 'visualizações da página', video_thruplay_watched_actions: 'ThruPlays', inline_link_clicks: 'cliques no link',
};

const ROTULO_TENDENCIA = { melhorando: 'melhorando', estavel: 'estável', piorando: 'piorando', sem_base: 'sem base' };
const ROTULO_NATUREZA = { vazando: 'vazando', recuperavel: 'recuperáveis', projetado: 'projetados' };
function impactoTexto(p) {
  if (p.impactoDia == null) return '';
  const pre = p.natureza === 'recuperavel' ? '+' : p.natureza === 'projetado' ? '~' : '';
  return `${pre}${brl0(p.impactoDia)}/dia ${ROTULO_NATUREZA[p.natureza] ?? ''}`.trim();
}

const brl = (v) => `R$ ${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const brl0 = (v) => `R$ ${Math.round(Number(v ?? 0)).toLocaleString('pt-BR')}`;
const diaLongo = (iso) => (iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }) : '');
const isoDiasAtras = (iso, n) => new Date(new Date(iso + 'T12:00:00Z').getTime() - n * 86400000).toISOString().slice(0, 10);

export default function SinaisView({ contaFiltroId = null, customNames = {} }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [contaSel, setContaSel] = useState('todas');
  const [categoriaSel, setCategoriaSel] = useState('todas');
  const [soAlta, setSoAlta] = useState(false);

  useEffect(() => {
    let vivo = true;
    apiFetch('/dashboard/sinais')
      .then((json) => { if (vivo) { setDados(json); setErro(null); } })
      .catch((e) => { if (vivo) setErro(e.message ?? 'Não foi possível carregar os sinais.'); });
    return () => { vivo = false; };
  }, []);

  // Conta escolhida na barra lateral vira filtro aqui.
  useEffect(() => {
    if (!contaFiltroId || !dados) return;
    const c = dados.contas.find((x) => x.id === contaFiltroId);
    if (c) setContaSel(c.identificador);
  }, [contaFiltroId, dados]);

  const modelo = useMemo(() => (dados ? montarModelo(dados, customNames) : null), [dados, customNames]);

  if (erro) return <div className="sn-estado sn-estado--erro">{erro}</div>;
  if (!modelo) return <div className="sn-estado">Carregando sinais…</div>;

  const { dia, kpis, porConta, contas, rotulos, prioridadesDia, comLeitura } = modelo;

  const blocos = porConta
    .filter((b) => contaSel === 'todas' || b.identificador === contaSel)
    .map((b) => ({
      ...b,
      sinais: b.sinais.filter((s) => (categoriaSel === 'todas' || s.categoria === categoriaSel) && (!soAlta || s.severidade === 'alta')),
    }))
    .filter((b) => b.sinais.length > 0);

  return (
    <div className="sn">
      <header className="sn-head">
        <div>
          <h1 className="sn-titulo">Sinais</h1>
          <p className="sn-sub">
            O que está vazando, o que está por vir e onde realocar, com a campanha, o conjunto e o anúncio de cada achado.
            {dia ? <> Rodada de <strong>{diaLongo(dia)}</strong>, com dados fechados até anteontem.</> : null}
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
            <Kpi valor={`${brl0(kpis.desperdicio)}/dia`} rotulo="vazando agora" sub={deltaTexto(kpis.desperdicio, kpis.desperdicioOntem)} nivel={kpis.desperdicio > 0 ? 'crit' : 'ok'} />
            <Kpi valor={`${brl0(kpis.recuperavel)}/dia`} rotulo="recuperáveis por realocação" sub="movendo orçamento do pior para o melhor" nivel={kpis.recuperavel > 0 ? 'warn' : null} />
            <Kpi valor={kpis.altos} rotulo="sinais de severidade alta" sub={`${kpis.total} sinais no total`} nivel={kpis.altos > 0 ? 'crit' : 'ok'} />
            <Kpi valor={`${kpis.contasComSinal}/${contas.length}`} rotulo="contas com algum sinal" sub={`${kpis.previsoes} ${kpis.previsoes === 1 ? 'previsão' : 'previsões'} para agir antes`} />
          </section>

          {prioridadesDia.length > 0 && contaSel === 'todas' && (
            <section className="sn-dia">
              <div className="sn-dia-head">
                <h2 className="sn-dia-titulo">Prioridades do dia</h2>
                <span className="sn-dia-sub">A primeira prioridade de cada conta, pela leitura da IA sobre os sinais. {comLeitura} {comLeitura === 1 ? 'conta lida' : 'contas lidas'}.</span>
              </div>
              <ol className="sn-dia-lista">
                {prioridadesDia.map((p) => (
                  <li key={p.identificador} className="sn-dia-item">
                    <button className="sn-dia-conta" onClick={() => setContaSel(p.identificador)}>{p.contaNome}</button>
                    <span className="sn-dia-tit">{p.titulo}</span>
                    {p.impactoDia != null && <span className={`sn-imp sn-imp--${p.natureza}`}>{impactoTexto(p)}</span>}
                    {p.tendencia && p.tendencia !== 'sem_base' && <span className={`sn-tend sn-tend--${p.tendencia}`}>{ROTULO_TENDENCIA[p.tendencia]}</span>}
                  </li>
                ))}
              </ol>
            </section>
          )}

          <div className="sn-barra">
            <div className="sn-chips">
              <button className={`sn-chip${categoriaSel === 'todas' ? ' sn-chip--ativo' : ''}`} onClick={() => setCategoriaSel('todas')}>Todas</button>
              {CATEGORIAS.map((c) => (
                <button key={c} className={`sn-chip sn-chip--${c}${categoriaSel === c ? ' sn-chip--ativo' : ''}`} onClick={() => setCategoriaSel(c)}>
                  {rotulos.categorias[c] ?? c} <span className="sn-chip-n">{kpis.porCategoria[c] ?? 0}</span>
                </button>
              ))}
            </div>
            <div className="sn-filtros">
              <select className="sn-select" value={contaSel} onChange={(e) => setContaSel(e.target.value)}>
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
            <div className="sn-estado">Nenhum sinal com esses filtros. {contaSel !== 'todas' ? 'Esta conta está limpa na última rodada.' : ''}</div>
          ) : (
            <div className="sn-lista">
              {blocos.map((b) => <BlocoConta key={b.identificador} bloco={b} rotulos={rotulos} />)}
            </div>
          )}
          <p className="sn-rodape">
            Só a categoria desperdício entra no total "vazando". Previsões ainda não custaram nada; orçamento é ganho possível. Janelas terminam anteontem porque o último dia ainda recebe atribuição.
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

  const grupos = new Map();
  for (const s of dados.sinais) {
    if (!grupos.has(s.contaId)) grupos.set(s.contaId, []);
    grupos.get(s.contaId).push(s);
  }

  const leituras = dados.leituras ?? {};
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
      leitura: leituras[ident] ?? null,
      sinais: [...sinais].sort((a, b) => (ORDEM_SEV[a.severidade] - ORDEM_SEV[b.severidade]) || ((b.desperdicioDia ?? b.economiaDia ?? 0) - (a.desperdicioDia ?? a.economiaDia ?? 0))),
    };
  }).sort((a, b) => (b.desperdicio - a.desperdicio) || (b.altos - a.altos) || (b.sinais.length - a.sinais.length));

  const porCategoria = {};
  for (const s of dados.sinais) porCategoria[s.categoria] = (porCategoria[s.categoria] ?? 0) + 1;

  const kpis = {
    desperdicio: porConta.reduce((t, b) => t + b.desperdicio, 0),
    desperdicioOntem: ontem ? [...serieOntem.values()].reduce((t, v) => t + v, 0) : null,
    recuperavel: porConta.reduce((t, b) => t + b.recuperavel, 0),
    altos: dados.sinais.filter((s) => s.severidade === 'alta').length,
    total: dados.sinais.length,
    previsoes: porCategoria.previsao ?? 0,
    contasComSinal: porConta.length,
    porCategoria,
  };

  // Prioridades do dia: a primeira de cada conta, da de maior impacto para a
  // menor. Deterministico: nenhuma chamada a mais, só ordenação.
  const ORDEM_NAT = { vazando: 0, recuperavel: 1, projetado: 2 };
  const prioridadesDia = porConta
    .filter((b) => b.leitura?.prioridades?.length)
    .map((b) => ({ ...b.leitura.prioridades[0], contaNome: b.nome, identificador: b.identificador, tendencia: b.leitura.tendencia }))
    .sort((a, b) => ((ORDEM_NAT[a.natureza] ?? 3) - (ORDEM_NAT[b.natureza] ?? 3)) || ((b.impactoDia ?? 0) - (a.impactoDia ?? 0)));

  return { dia, kpis, porConta, contas, prioridadesDia, comLeitura: porConta.filter((b) => b.leitura).length, rotulos: dados.rotulos ?? { tipos: {}, categorias: {} } };
}

function deltaTexto(hoje, ontem) {
  if (ontem == null) return 'sem rodada anterior para comparar';
  const d = hoje - ontem;
  if (Math.abs(d) < 1) return 'igual a ontem';
  return `${d > 0 ? '+' : '−'}${brl0(Math.abs(d))} em relação a ontem`;
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

function BlocoConta({ bloco, rotulos }) {
  return (
    <section className="sn-conta">
      <header className="sn-conta-head">
        <div>
          <h2 className="sn-conta-nome">{bloco.nome}</h2>
          {bloco.gestor && <span className="sn-conta-gestor">{bloco.gestor}</span>}
        </div>
        <div className="sn-conta-tot">
          {bloco.desperdicio > 0 && <span className="sn-tot sn-tot--crit">{brl0(bloco.desperdicio)}/dia vazando</span>}
          {bloco.recuperavel > 0 && <span className="sn-tot sn-tot--warn">+{brl0(bloco.recuperavel)}/dia realocando</span>}
          <span className="sn-tot">{bloco.sinais.length} {bloco.sinais.length === 1 ? 'sinal' : 'sinais'}</span>
        </div>
      </header>
      {bloco.leitura && <Leitura l={bloco.leitura} />}
      <div className="sn-cards">
        {bloco.sinais.map((s) => <CardSinal key={s.id} s={s} rotulos={rotulos} />)}
      </div>
    </section>
  );
}

function Leitura({ l }) {
  return (
    <div className="sn-leitura">
      <div className="sn-leitura-head">
        <span className="sn-leitura-k">Leitura do dia</span>
        {l.tendencia && l.tendencia !== 'sem_base' && <span className={`sn-tend sn-tend--${l.tendencia}`}>{ROTULO_TENDENCIA[l.tendencia]}</span>}
      </div>
      <p className="sn-leitura-resumo">{l.resumo}</p>
      {l.prioridades?.length > 0 && (
        <ol className="sn-prios">
          {l.prioridades.map((p) => (
            <li key={p.ordem} className="sn-prio">
              <div className="sn-prio-head">
                <span className="sn-prio-n">{p.ordem}</span>
                <span className="sn-prio-tit">{p.titulo}</span>
                {p.impactoDia != null && <span className={`sn-imp sn-imp--${p.natureza}`}>{impactoTexto(p)}</span>}
              </div>
              {p.onde && <div className="sn-prio-onde">{p.onde}</div>}
              <p className="sn-prio-porque">{p.porque}</p>
              <p className="sn-prio-acao"><span className="sn-fazer-k">Ação</span> {p.acao}</p>
            </li>
          ))}
        </ol>
      )}
      {l.observacao && <p className="sn-leitura-obs"><strong>Obs.</strong> {l.observacao}</p>}
    </div>
  );
}

export function Caminho({ s }) {
  if (s.nivel === 'conta') return <span className="sn-cam"><span className="sn-cam-item sn-cam-item--conta">conta inteira</span></span>;
  const partes = [];
  if (s.campanhaNome) partes.push({ k: 'campanha', v: s.campanhaNome });
  if (s.nivel === 'adset') partes.push({ k: 'conjunto', v: s.entidadeNome });
  if (s.nivel === 'ad') {
    if (s.conjuntoNome) partes.push({ k: 'conjunto', v: s.conjuntoNome });
    partes.push({ k: 'anúncio', v: s.entidadeNome });
  }
  return (
    <span className="sn-cam">
      {partes.map((p, i) => (
        <span key={p.k} className="sn-cam-item">
          {i > 0 && <span className="sn-cam-sep">›</span>}
          <span className="sn-cam-k">{p.k}</span> <span className="sn-cam-v" title={p.v}>{p.v}</span>
        </span>
      ))}
    </span>
  );
}

function CardSinal({ s, rotulos }) {
  const valor = s.desperdicioDia != null
    ? { texto: `${brl(s.desperdicioDia)}/dia`, classe: 'crit' }
    : s.economiaDia != null
      ? { texto: `+${brl(s.economiaDia)}/dia possível`, classe: 'warn' }
      : s.evidencia?.extraProjetadoDia != null
        ? { texto: `~${brl(s.evidencia.extraProjetadoDia)}/dia se continuar`, classe: 'prev' }
        : null;
  const metrica = s.metricaResultado ? ROTULO_METRICA[s.metricaResultado] ?? s.metricaResultado : null;

  return (
    <article className={`sn-card sn-card--${s.categoria}`}>
      <div className="sn-card-top">
        <span className={`sn-sev sn-sev--${s.severidade}`}>{s.severidade}</span>
        <span className={`sn-cat sn-cat--${s.categoria}`}>{rotulos.categorias[s.categoria] ?? s.categoria}</span>
        <span className="sn-tipo">{s.tipoRotulo ?? rotulos.tipos[s.tipo] ?? s.tipo}</span>
        {valor && <span className={`sn-valor sn-valor--${valor.classe}`}>{valor.texto}</span>}
      </div>
      <Caminho s={s} />
      <p className="sn-frase">{s.frase}</p>
      {s.sugestao && (
        <div className="sn-fazer">
          <span className="sn-fazer-k">O que fazer</span>
          <p>{s.sugestao}</p>
        </div>
      )}
      {(s.explicacao || metrica) && (
        <details className="sn-como">
          <summary>Como chegamos nisso</summary>
          {s.explicacao && <p>{s.explicacao}</p>}
          {metrica && s.origemResultado && (
            <p className="sn-como-meta">Resultado avaliado: <strong>{metrica}</strong>, definido por {ROTULO_ORIGEM[s.origemResultado] ?? s.origemResultado}.</p>
          )}
        </details>
      )}
    </article>
  );
}
