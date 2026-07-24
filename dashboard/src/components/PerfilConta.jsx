import { useState, useEffect } from 'react';
import './PerfilConta.css';

const API_URL = import.meta.env.VITE_API_URL ?? '';

function getToken() {
  const params = new URLSearchParams(window.location.search);
  return params.get('token') ?? sessionStorage.getItem('dash_token') ?? '';
}

const OBJETIVOS_OPTS = [
  { chave: 'conversao', nome: 'Conversões / Vendas' },
  { chave: 'mensagem',  nome: 'Mensagens (WhatsApp)' },
  { chave: 'lead',      nome: 'Leads / Formulário' },
  { chave: 'trafego',   nome: 'Tráfego / Cliques' },
  { chave: 'alcance',   nome: 'Alcance' },
];

const OPERADOR_OPTS = [
  { valor: 'acima_de',  nome: 'acima de' },
  { valor: 'abaixo_de', nome: 'abaixo de' },
];

const JANELA_OPTS = [
  { valor: '1d',  nome: 'Hoje' },
  { valor: '7d',  nome: '7 dias' },
  { valor: '30d', nome: '30 dias' },
];

const UNIDADE_SUFIXO = { multiplier: 'x', percent: '%', currency: 'R$', decimal: '×', integer: '' };

function sufixoMetrica(unidade) {
  return UNIDADE_SUFIXO[unidade] ?? '';
}

/** Onboarding/perfil da conta: gerente, investimento mensal, objetivos, contas e metas. */
export default function PerfilConta({ conta, onSalvo }) {
  const p = conta.perfil ?? {};
  const objInicial = (ordem) => (p.objetivos ?? []).find((o) => o.ordem === ordem)?.chave ?? '';

  // ── Perfil básico ────────────────────────────────────────────────────────
  const [gerente, setGerente] = useState(p.gerenteResponsavel ?? '');
  const [investimento, setInvestimento] = useState(p.investimentoMensalPlanejado ?? '');
  const [obj, setObj] = useState([objInicial(1), objInicial(2), objInicial(3)]);
  const [salvandoPerfil, setSalvandoPerfil] = useState(false);
  const [msgPerfil, setMsgPerfil] = useState('');

  // ── Seleção de contas de anúncio ─────────────────────────────────────────
  const [contasDisponiveis, setContasDisponiveis] = useState(null); // null = carregando
  const [contasSelecionadas, setContasSelecionadas] = useState(new Set(conta.metaConfig?.contasAnuncioIds ?? []));
  const [salvandoContas, setSalvandoContas] = useState(false);
  const [msgContas, setMsgContas] = useState('');
  const [erroContas, setErroContas] = useState('');

  // ── Metas personalizadas ─────────────────────────────────────────────────
  const [catalogoMetas, setCatalogoMetas] = useState([]);
  const [metas, setMetas] = useState(p.metasPersonalizadas ?? []);
  const [novaMeta, setNovaMeta] = useState({ metrica: '', operador: 'acima_de', valor: '', janela: '7d' });
  const [salvandoMetas, setSalvandoMetas] = useState(false);
  const [msgMetas, setMsgMetas] = useState('');

  const token = getToken();

  useEffect(() => {
    // Carregar contas disponíveis na BM
    fetch(`${API_URL}/dashboard/contas/${conta.id}/contas-anuncio?token=${token}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((d) => {
        setContasDisponiveis(d.contas ?? []);
        setContasSelecionadas(new Set(
          (d.contas ?? []).filter((c) => c.selecionada).map((c) => c.id)
        ));
      })
      .catch(() => setErroContas('Falha ao carregar contas disponíveis'));

    // Carregar catálogo de métricas para metas
    fetch(`${API_URL}/dashboard/metricas/catalogo-metas?token=${token}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((d) => setCatalogoMetas(d.metricas ?? []))
      .catch(() => {});
  }, [conta.id]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const setObjetivo = (i, v) => setObj((prev) => {
    const novo = [...prev];
    novo[i] = v;
    if (!v) for (let j = i + 1; j < 3; j++) novo[j] = '';
    return novo;
  });

  const opcoes = (idx) => OBJETIVOS_OPTS.filter((o) => !obj.some((c, j) => j !== idx && c === o.chave));

  const toggleConta = (id) => setContasSelecionadas((prev) => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const adicionarMeta = () => {
    if (!novaMeta.metrica || !novaMeta.valor || Number(novaMeta.valor) <= 0) return;
    setMetas((prev) => [
      ...prev,
      { metrica: novaMeta.metrica, operador: novaMeta.operador, valor: Number(novaMeta.valor), janela: novaMeta.janela, ativo: true },
    ]);
    setNovaMeta({ metrica: '', operador: 'acima_de', valor: '', janela: '7d' });
  };

  const removerMeta = (idx) => setMetas((prev) => prev.filter((_, i) => i !== idx));

  const toggleMetaAtivo = (idx) => setMetas((prev) =>
    prev.map((m, i) => i === idx ? { ...m, ativo: !m.ativo } : m)
  );

  // ── Salvar perfil básico ──────────────────────────────────────────────────
  async function salvarPerfil() {
    setSalvandoPerfil(true);
    setMsgPerfil('');
    const objetivos = obj.map((chave, i) => (chave ? { ordem: i + 1, chave } : null)).filter(Boolean);
    try {
      const res = await fetch(`${API_URL}/dashboard/contas/${conta.id}/perfil?token=${token}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gerenteResponsavel: gerente,
          investimentoMensalPlanejado: investimento === '' ? null : Number(investimento),
          objetivos,
        }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setMsgPerfil('Salvo ✓');
      onSalvo?.();
    } catch {
      setMsgPerfil('Erro ao salvar');
    } finally {
      setSalvandoPerfil(false);
    }
  }

  // ── Salvar seleção de contas ──────────────────────────────────────────────
  async function salvarContas() {
    if (contasSelecionadas.size === 0) { setMsgContas('Selecione ao menos uma conta'); return; }
    setSalvandoContas(true);
    setMsgContas('');
    try {
      const res = await fetch(`${API_URL}/dashboard/contas/${conta.id}/contas-anuncio?token=${token}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contasAnuncioIds: [...contasSelecionadas] }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setMsgContas('Salvo ✓');
      onSalvo?.();
    } catch {
      setMsgContas('Erro ao salvar');
    } finally {
      setSalvandoContas(false);
    }
  }

  // ── Salvar metas personalizadas ───────────────────────────────────────────
  async function salvarMetas() {
    setSalvandoMetas(true);
    setMsgMetas('');
    try {
      const res = await fetch(`${API_URL}/dashboard/contas/${conta.id}/metas?token=${token}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metasPersonalizadas: metas }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setMsgMetas('Salvo ✓');
      onSalvo?.();
    } catch {
      setMsgMetas('Erro ao salvar');
    } finally {
      setSalvandoMetas(false);
    }
  }

  const rotulos = ['Objetivo principal', 'Objetivo secundário', 'Objetivo terciário'];

  const metricaAtual = catalogoMetas.find((m) => m.chave === novaMeta.metrica);

  return (
    <div className="pc-form">

      {/* ── Perfil básico ──────────────────────────────────────────────── */}
      <div className="pc-secao-titulo">Perfil</div>
      <div className="pc-linha">
        <label className="pc-campo">
          <span>Gerente responsável</span>
          <input value={gerente} onChange={(e) => setGerente(e.target.value)} placeholder="Nome do gestor" />
        </label>
        <label className="pc-campo">
          <span>Investimento mensal (R$)</span>
          <input
            type="number" min="0" step="100"
            value={investimento}
            onChange={(e) => setInvestimento(e.target.value)}
            placeholder="ex.: 5000"
          />
        </label>
      </div>

      <div className="pc-objetivos">
        {[0, 1, 2].map((i) => (
          <label key={i} className="pc-campo">
            <span>{rotulos[i]}</span>
            <select
              value={obj[i]}
              disabled={i > 0 && !obj[i - 1]}
              onChange={(e) => setObjetivo(i, e.target.value)}
            >
              <option value="">{i === 0 ? 'Selecione…' : '(nenhum)'}</option>
              {opcoes(i).map((o) => (
                <option key={o.chave} value={o.chave}>{o.nome}</option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <div className="pc-acao">
        <button className="pc-salvar" onClick={salvarPerfil} disabled={salvandoPerfil}>
          {salvandoPerfil ? 'Salvando…' : 'Salvar perfil'}
        </button>
        {msgPerfil && <span className="pc-msg">{msgPerfil}</span>}
      </div>

      {/* ── Contas de anúncio monitoradas ──────────────────────────────── */}
      <div className="pc-divisor" />
      <div className="pc-secao-titulo">Contas de anúncio monitoradas</div>

      {erroContas && <span className="pc-msg-erro">{erroContas}</span>}

      {contasDisponiveis === null && !erroContas && (
        <span className="pc-msg">Carregando contas…</span>
      )}

      {contasDisponiveis !== null && (
        <>
          <div className="pc-contas-lista">
            {contasDisponiveis.length === 0 && (
              <span className="pc-msg">Nenhuma conta de anúncio encontrada na BM</span>
            )}
            {contasDisponiveis.map((c) => (
              <label key={c.id} className="pc-conta-item">
                <input
                  type="checkbox"
                  checked={contasSelecionadas.has(c.id)}
                  onChange={() => toggleConta(c.id)}
                />
                <span className="pc-conta-nome">{c.nome || c.id}</span>
                <span className="pc-conta-id">{c.id}</span>
              </label>
            ))}
          </div>
          <div className="pc-acao">
            <button className="pc-salvar" onClick={salvarContas} disabled={salvandoContas}>
              {salvandoContas ? 'Salvando…' : 'Salvar seleção'}
            </button>
            {msgContas && <span className="pc-msg">{msgContas}</span>}
          </div>
        </>
      )}

      {/* ── Metas e alertas personalizados ──────────────────────────────── */}
      <div className="pc-divisor" />
      <div className="pc-secao-titulo">Metas e alertas</div>
      <p className="pc-subtitulo">
        Defina thresholds para receber alerta quando uma métrica ficar fora do objetivo.
      </p>

      {metas.length > 0 && (
        <div className="pc-metas-lista">
          {metas.map((m, i) => {
            const cat = catalogoMetas.find((c) => c.chave === m.metrica);
            const suf = sufixoMetrica(cat?.unidade);
            return (
              <div key={i} className={`pc-meta-item${m.ativo ? '' : ' pc-meta-inativa'}`}>
                <span className="pc-meta-desc">
                  {cat?.nome ?? m.metrica} {m.operador === 'acima_de' ? '>' : '<'}{' '}
                  {suf === 'R$' ? `R$ ${m.valor}` : `${m.valor}${suf}`}
                  {' · '}{JANELA_OPTS.find((j) => j.valor === m.janela)?.nome ?? m.janela}
                </span>
                <div className="pc-meta-acoes">
                  <button className="pc-btn-mini" onClick={() => toggleMetaAtivo(i)}>
                    {m.ativo ? 'Pausar' : 'Ativar'}
                  </button>
                  <button className="pc-btn-mini pc-btn-remover" onClick={() => removerMeta(i)}>✕</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="pc-nova-meta">
        <select
          className="pc-select-meta"
          value={novaMeta.metrica}
          onChange={(e) => {
            const cat = catalogoMetas.find((c) => c.chave === e.target.value);
            setNovaMeta((p) => ({
              ...p,
              metrica: e.target.value,
              operador: cat?.operadorPadrao ?? 'acima_de',
              janela: cat?.janelas?.[0] ?? '7d',
            }));
          }}
        >
          <option value="">Escolha a métrica…</option>
          {catalogoMetas.map((m) => (
            <option key={m.chave} value={m.chave}>{m.nome}</option>
          ))}
        </select>

        <select
          className="pc-select-meta"
          value={novaMeta.operador}
          onChange={(e) => setNovaMeta((p) => ({ ...p, operador: e.target.value }))}
        >
          {OPERADOR_OPTS.map((o) => (
            <option key={o.valor} value={o.valor}>{o.nome}</option>
          ))}
        </select>

        <input
          className="pc-input-meta"
          type="number" min="0" step="any"
          placeholder={metricaAtual ? `valor em ${sufixoMetrica(metricaAtual.unidade) || metricaAtual.unidade}` : 'valor'}
          value={novaMeta.valor}
          onChange={(e) => setNovaMeta((p) => ({ ...p, valor: e.target.value }))}
        />

        <select
          className="pc-select-meta"
          value={novaMeta.janela}
          onChange={(e) => setNovaMeta((p) => ({ ...p, janela: e.target.value }))}
        >
          {(metricaAtual?.janelas ?? ['1d', '7d', '30d']).map((j) => (
            <option key={j} value={j}>{JANELA_OPTS.find((o) => o.valor === j)?.nome ?? j}</option>
          ))}
        </select>

        <button
          className="pc-salvar"
          onClick={adicionarMeta}
          disabled={!novaMeta.metrica || !novaMeta.valor}
        >
          Adicionar
        </button>
      </div>

      <div className="pc-acao">
        <button className="pc-salvar" onClick={salvarMetas} disabled={salvandoMetas}>
          {salvandoMetas ? 'Salvando…' : 'Salvar metas'}
        </button>
        {msgMetas && <span className="pc-msg">{msgMetas}</span>}
      </div>

    </div>
  );
}
