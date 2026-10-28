/**
 * Motor de sinais: monta as janelas de cada entidade a partir da série
 * diária, resolve o que é "resultado" para ela, aplica as regras e devolve
 * os achados com evidência, explicação, sugestão e custo por dia.
 * Determinístico; a IA entra depois, em cima desta saída.
 *
 * Todo sinal identifica de onde fala: campanhaNome › conjuntoNome › entidadeNome
 * (o que couber ao nível), além dos ids da Meta na evidência de contexto.
 *
 * Janelas (todas terminam ANTEONTEM — o último dia ainda recebe atribuição):
 *   tres       = 3 dias     recente = 7 dias     anterior = os 7 dias antes de recente
 *   trintaDias = 30 dias    base    = os 30 dias anteriores à janela recente
 */
import { Conta } from '../../dominio/conta.modelo.js';
import { Entidade } from '../../dominio/entidade.modelo.js';
import { carregarSerieDiaria, carregarFrequencia7d, carregarFrequenciaHistorico, carregarAlteracoesRecentes } from './series.js';
import { mapaObjetivoOtimizacao, resolverResultado } from './resolucao-resultado.js';
import { REGRAS_ENTIDADE, CATEGORIA_SINAL, SUPRIME, LIMIARES, realocacaoOrcamento } from './regras.js';
import { query } from '../../infra/postgres.js';
import { inicioDiaBRT, dataBRT } from '../../shared/utils.js';
import { ErroNaoEncontrado } from '../../shared/erros.js';

/** Soma as métricas dos dias de uma série dentro de [desde, ate). */
export function somarJanela(serie, desde, ate) {
  const soma = {};
  for (const dia of serie) {
    const t = new Date(`${dia.dia}T03:00:00Z`); // 00:00 BRT daquele dia
    if (t < desde || t >= ate) continue;
    for (const [k, v] of Object.entries(dia)) {
      if (k === 'dia') continue;
      soma[k] = (soma[k] ?? 0) + Number(v);
    }
  }
  return soma;
}

/** "Campanha › Conjunto › Anúncio", só com os níveis que o sinal tem. */
export function caminhoSinal(s) {
  if (s.nivel === 'conta') return s.entidadeNome;
  const partes = [];
  if (s.campanhaNome) partes.push(`campanha "${s.campanhaNome}"`);
  if (s.nivel === 'adset') partes.push(`conjunto "${s.entidadeNome}"`);
  if (s.nivel === 'ad') {
    if (s.conjuntoNome) partes.push(`conjunto "${s.conjuntoNome}"`);
    partes.push(`anúncio "${s.entidadeNome}"`);
  }
  return partes.join(' › ');
}

/**
 * Gera os sinais de uma conta para o dia de hoje (BRT).
 * @returns {Promise<{ dia: string, sinais: Array }>}
 */
export async function gerarSinaisConta(contaId) {
  const conta = await Conta.findById(contaId).lean();
  if (!conta) throw new ErroNaoEncontrado(`Conta ${contaId} não encontrada`);

  const entidades = await Entidade.find({ contaId: conta._id, 'configuracoes.monitorada': true })
    .select('_id metaId tipo nome status optimizationGoal hierarquia').lean();
  const ids = entidades.map((e) => String(e._id));

  const fim = inicioDiaBRT(1);          // exclusivo: anteontem inteiro é o último dia
  const iniTres = inicioDiaBRT(4);
  const iniRecente = inicioDiaBRT(8);
  const iniAnterior = inicioDiaBRT(15);
  const iniTrinta = inicioDiaBRT(31);
  const iniBase = inicioDiaBRT(38);

  const [series, freq7, freqHist, alteracoes] = await Promise.all([
    carregarSerieDiaria(ids, iniBase, fim),
    carregarFrequencia7d(ids),
    carregarFrequenciaHistorico(ids),
    carregarAlteracoesRecentes(conta.identificador, inicioDiaBRT(7)),
  ]);

  const goals = mapaObjetivoOtimizacao(entidades);
  const nomePorMetaId = new Map(entidades.map((e) => [e.metaId, e.nome]));
  const idPorMetaId = new Map(entidades.map((e) => [e.metaId, String(e._id)]));

  // Contexto por entidade (janelas + resultado), calculado uma vez.
  const contextos = new Map();
  for (const e of entidades) {
    const serie = series.get(String(e._id));
    if (!serie?.length) continue;
    const trintaDias = somarJanela(serie, iniTrinta, fim);
    if (!(trintaDias.spend > 0)) continue; // sem gasto em 30 dias: nada a avaliar
    const metricasComDado = new Set(Object.entries(trintaDias).filter(([, v]) => v > 0).map(([k]) => k));
    const resultado = resolverResultado({ optimizationGoal: goals.get(String(e._id)) ?? null, perfil: conta.perfil, metricasComDado });
    contextos.set(String(e._id), {
      tres: somarJanela(serie, iniTres, fim),
      recente: somarJanela(serie, iniRecente, fim),
      anterior: somarJanela(serie, iniAnterior, iniRecente),
      base: somarJanela(serie, iniBase, iniRecente),
      trintaDias,
      resultado,
      frequencia7d: freq7.get(String(e._id))?.frequency ?? null,
      frequenciaHistorico: freqHist.get(String(e._id)) ?? [],
      alteracoes7d: alteracoes.get(e.metaId) ?? [],
    });
  }

  // Irmãos: conjuntos da mesma campanha que perseguem a mesma métrica, com
  // gasto e resultado nos 7 dias. Alimenta a realocação e o "melhor irmão"
  // citado no gasto sem resultado.
  const irmaosPorCampanha = new Map(); // `${campanhaId}|${metrica}` → [{metaId, nome, gasto7, resultados7}]
  for (const e of entidades) {
    if (e.tipo !== 'adset') continue;
    const ctx = contextos.get(String(e._id));
    if (!ctx) continue;
    const chave = `${e.hierarquia?.campanhaId}|${ctx.resultado.metrica}`;
    if (!irmaosPorCampanha.has(chave)) irmaosPorCampanha.set(chave, []);
    irmaosPorCampanha.get(chave).push({ metaId: e.metaId, nome: e.nome, gasto7: ctx.recente.spend ?? 0, resultados7: ctx.recente[ctx.resultado.metrica] ?? 0 });
  }
  const melhorIrmaoDe = (adsetMetaId, campanhaId, metrica) => {
    const lista = (irmaosPorCampanha.get(`${campanhaId}|${metrica}`) ?? [])
      .filter((i) => i.metaId !== adsetMetaId && i.gasto7 >= LIMIARES.realocacaoMinGasto7d && i.resultados7 >= LIMIARES.custoMinResultados7d)
      .map((i) => ({ nome: i.nome, metaId: i.metaId, cpr: Number((i.gasto7 / i.resultados7).toFixed(2)), resultados7d: i.resultados7 }));
    return lista.sort((a, b) => a.cpr - b.cpr)[0] ?? null;
  };

  const sinais = [];
  const contextoEntidade = (e) => {
    const adsetMetaId = e.tipo === 'adset' ? e.metaId : e.hierarquia?.adsetId ?? null;
    return {
      nivel: e.tipo,
      entidadeId: String(e._id),
      entidadeNome: e.nome,
      entidadeMetaId: e.metaId,
      campanhaNome: e.tipo === 'campaign' ? e.nome : nomePorMetaId.get(e.hierarquia?.campanhaId) ?? null,
      campanhaMetaId: e.tipo === 'campaign' ? e.metaId : e.hierarquia?.campanhaId ?? null,
      conjuntoNome: e.tipo === 'ad' ? nomePorMetaId.get(adsetMetaId) ?? null : e.tipo === 'adset' ? e.nome : null,
      conjuntoMetaId: e.tipo === 'campaign' ? null : adsetMetaId,
    };
  };

  // Conjuntos antes de anúncios: um anúncio só é apontado se o conjunto dele
  // não foi — senão o mesmo gasto aparece duas vezes.
  const ordemNivel = { campaign: 0, adset: 1, ad: 2 };
  const ordenadas = [...entidades].sort((a, b) => ordemNivel[a.tipo] - ordemNivel[b.tipo]);
  const apontados = new Set(); // `${tipoSinal}|${metaId}`

  for (const e of ordenadas) {
    const ctx = contextos.get(String(e._id));
    if (!ctx) continue;
    const regras = REGRAS_ENTIDADE[e.tipo] ?? [];
    if (!regras.length) continue;

    const entrada = e.tipo === 'adset'
      ? { ...ctx, melhorIrmao: melhorIrmaoDe(e.metaId, e.hierarquia?.campanhaId, ctx.resultado.metrica) }
      : ctx;

    for (const regra of regras) {
      const s = regra(entrada);
      if (!s) continue;
      if (SUPRIME[s.tipo] && apontados.has(`${SUPRIME[s.tipo]}|${e.metaId}`)) continue;
      if (e.tipo === 'ad' && apontados.has(`${s.tipo}|${e.hierarquia?.adsetId}`)) continue;
      apontados.add(`${s.tipo}|${e.metaId}`);
      sinais.push({
        ...s,
        categoria: CATEGORIA_SINAL[s.tipo] ?? 'desperdicio',
        ...contextoEntidade(e),
        metricaResultado: ctx.resultado.metrica,
        origemResultado: ctx.resultado.origem,
      });
    }
  }

  // Nível campanha: realocação entre conjuntos que perseguem o mesmo resultado.
  // Se a campanha mistura métricas (raro), avalia só o grupo de maior gasto:
  // a chave única do sinal é (tipo, entidade).
  const grupoDominante = new Map(); // campanhaMetaId → chave
  for (const [chave, irmaos] of irmaosPorCampanha) {
    const campanhaMetaId = chave.split('|')[0];
    const gasto = irmaos.reduce((t, i) => t + i.gasto7, 0);
    const atual = grupoDominante.get(campanhaMetaId);
    if (!atual || gasto > atual.gasto) grupoDominante.set(campanhaMetaId, { chave, gasto });
  }
  for (const { chave } of grupoDominante.values()) {
    const irmaos = irmaosPorCampanha.get(chave);
    const [campanhaMetaId, metrica] = chave.split('|');
    const campanhaId = idPorMetaId.get(campanhaMetaId);
    if (!campanhaId) continue;
    const resultado = contextos.get(idPorMetaId.get(irmaos[0].metaId))?.resultado;
    const s = realocacaoOrcamento({ irmaos, resultado, unidade: 'conjunto' });
    if (!s) continue;
    sinais.push({
      ...s,
      categoria: CATEGORIA_SINAL[s.tipo],
      nivel: 'campaign',
      entidadeId: campanhaId,
      entidadeNome: nomePorMetaId.get(campanhaMetaId) ?? null,
      entidadeMetaId: campanhaMetaId,
      campanhaNome: nomePorMetaId.get(campanhaMetaId) ?? null,
      campanhaMetaId,
      conjuntoNome: null,
      conjuntoMetaId: null,
      metricaResultado: metrica,
      origemResultado: resultado?.origem ?? null,
    });
  }

  // Nível conta: realocação entre campanhas com a mesma métrica de resultado.
  const campanhasPorMetrica = new Map();
  for (const e of entidades) {
    if (e.tipo !== 'campaign') continue;
    const ctx = contextos.get(String(e._id));
    if (!ctx) continue;
    const chave = ctx.resultado.metrica;
    if (!campanhasPorMetrica.has(chave)) campanhasPorMetrica.set(chave, { resultado: ctx.resultado, lista: [] });
    campanhasPorMetrica.get(chave).lista.push({ metaId: e.metaId, nome: e.nome, gasto7: ctx.recente.spend ?? 0, resultados7: ctx.recente[chave] ?? 0 });
  }
  for (const [metrica, { resultado, lista }] of campanhasPorMetrica) {
    const s = realocacaoOrcamento({ irmaos: lista, resultado, unidade: 'campanha' });
    if (!s) continue;
    sinais.push({
      ...s,
      categoria: CATEGORIA_SINAL[s.tipo],
      nivel: 'conta',
      entidadeId: `${conta.identificador}#${metrica}`, // uma comparação por métrica
      entidadeNome: conta.nome,
      entidadeMetaId: null,
      campanhaNome: null,
      campanhaMetaId: null,
      conjuntoNome: null,
      conjuntoMetaId: null,
      metricaResultado: metrica,
      origemResultado: resultado.origem,
    });
  }

  const ordem = { alta: 0, media: 1, baixa: 2 };
  sinais.sort((a, b) => (ordem[a.severidade] - ordem[b.severidade]) || ((b.desperdicioDia ?? 0) - (a.desperdicioDia ?? 0)));
  return { dia: dataBRT(0), sinais };
}

/** Substitui os sinais do dia da conta pelos recém-gerados. */
export async function persistirSinais(contaIdentificador, dia, sinais) {
  await query('DELETE FROM sinais_conta WHERE conta_id = $1 AND gerado_em = $2', [contaIdentificador, dia]);
  if (!sinais.length) return 0;

  const colunas = ['conta_id', 'gerado_em', 'tipo', 'categoria', 'nivel', 'entidade_id', 'entidade_nome', 'conjunto_nome', 'campanha_nome',
    'metrica_resultado', 'origem_resultado', 'severidade', 'desperdicio_dia', 'frase', 'explicacao', 'sugestao', 'evidencia'];
  const valores = [];
  const placeholders = sinais.map((s, li) => {
    const evidencia = { ...(s.evidencia ?? {}), ids: { entidade: s.entidadeMetaId ?? null, conjunto: s.conjuntoMetaId ?? null, campanha: s.campanhaMetaId ?? null } };
    valores.push(contaIdentificador, dia, s.tipo, s.categoria, s.nivel, s.entidadeId, s.entidadeNome ?? null, s.conjuntoNome ?? null, s.campanhaNome ?? null,
      s.metricaResultado ?? null, s.origemResultado ?? null, s.severidade, s.desperdicioDia ?? null, s.frase, s.explicacao ?? null, s.sugestao ?? null, JSON.stringify(evidencia));
    return `(${colunas.map((_, ci) => `$${li * colunas.length + ci + 1}`).join(', ')})`;
  });
  await query(
    `INSERT INTO sinais_conta (${colunas.join(', ')}) VALUES ${placeholders.join(', ')}
     ON CONFLICT (conta_id, gerado_em, tipo, entidade_id) DO UPDATE SET
       categoria = EXCLUDED.categoria, severidade = EXCLUDED.severidade, desperdicio_dia = EXCLUDED.desperdicio_dia,
       entidade_nome = EXCLUDED.entidade_nome, conjunto_nome = EXCLUDED.conjunto_nome, campanha_nome = EXCLUDED.campanha_nome,
       frase = EXCLUDED.frase, explicacao = EXCLUDED.explicacao, sugestao = EXCLUDED.sugestao, evidencia = EXCLUDED.evidencia`,
    valores
  );
  return sinais.length;
}
