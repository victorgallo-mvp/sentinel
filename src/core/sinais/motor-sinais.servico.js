/**
 * Motor de sinais: monta as janelas de cada entidade a partir da série
 * diária, resolve o que é "resultado" para ela, aplica as regras e devolve
 * os achados com evidência e custo por dia. Determinístico; a IA entra depois,
 * em cima desta saída.
 *
 * Janelas (todas terminam ANTEONTEM — o último dia ainda recebe atribuição):
 *   tres      = 3 dias      recente = 7 dias
 *   trintaDias = 30 dias    base    = os 30 dias anteriores à janela recente
 */
import { Conta } from '../../dominio/conta.modelo.js';
import { Entidade } from '../../dominio/entidade.modelo.js';
import { carregarSerieDiaria, carregarFrequencia7d, carregarAlteracoesRecentes } from './series.js';
import { mapaObjetivoOtimizacao, resolverResultado } from './resolucao-resultado.js';
import { REGRAS_ENTIDADE, CATEGORIA_SINAL, ritmoPlanejado } from './regras.js';
import { buscarGastoMes } from '../analise/veredito.servico.js';
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
  const iniTrinta = inicioDiaBRT(31);
  const iniBase = inicioDiaBRT(38);

  const [series, freq7, alteracoes] = await Promise.all([
    carregarSerieDiaria(ids, iniBase, fim),
    carregarFrequencia7d(ids),
    carregarAlteracoesRecentes(conta.identificador, inicioDiaBRT(7)),
  ]);

  const goals = mapaObjetivoOtimizacao(entidades);
  const nomeCampanha = new Map(entidades.filter((e) => e.tipo === 'campaign').map((e) => [e.metaId, e.nome]));
  const sinais = [];

  // Conjuntos antes de anúncios: um anúncio só é apontado se o conjunto dele
  // não foi — senão o mesmo gasto aparece duas vezes.
  const ordemNivel = { campaign: 0, adset: 1, ad: 2 };
  const ordenadas = [...entidades].sort((a, b) => ordemNivel[a.tipo] - ordemNivel[b.tipo]);
  const adsetsApontados = new Set(); // `${tipoSinal}|${adsetMetaId}`

  for (const e of ordenadas) {
    const id = String(e._id);
    const serie = series.get(id);
    if (!serie?.length) continue;
    const regras = REGRAS_ENTIDADE[e.tipo] ?? [];
    if (!regras.length) continue;

    const trintaDias = somarJanela(serie, iniTrinta, fim);
    if (!(trintaDias.spend > 0)) continue; // sem gasto em 30 dias: nada a avaliar

    const metricasComDado = new Set(Object.entries(trintaDias).filter(([, v]) => v > 0).map(([k]) => k));
    const resultado = resolverResultado({ optimizationGoal: goals.get(id) ?? null, perfil: conta.perfil, metricasComDado });
    const contexto = {
      tres: somarJanela(serie, iniTres, fim),
      recente: somarJanela(serie, iniRecente, fim),
      base: somarJanela(serie, iniBase, iniRecente),
      trintaDias,
      resultado,
      frequencia7d: freq7.get(id)?.frequency ?? null,
      alteracoes7d: alteracoes.get(e.metaId) ?? [],
    };

    for (const regra of regras) {
      const s = regra(contexto);
      if (!s) continue;
      if (e.tipo === 'adset') adsetsApontados.add(`${s.tipo}|${e.metaId}`);
      if (e.tipo === 'ad' && adsetsApontados.has(`${s.tipo}|${e.hierarquia?.adsetId}`)) continue;
      sinais.push({
        ...s,
        categoria: CATEGORIA_SINAL[s.tipo] ?? 'desperdicio',
        nivel: e.tipo,
        entidadeId: id,
        entidadeNome: e.nome,
        campanhaNome: e.tipo === 'campaign' ? e.nome : nomeCampanha.get(e.hierarquia?.campanhaId) ?? null,
        metricaResultado: resultado.metrica,
        origemResultado: resultado.origem,
      });
    }
  }

  // Nível conta: ritmo contra o planejado (só no mês-calendário, por enquanto).
  const planejado = conta.perfil?.investimentoMensalPlanejado;
  const diaInicioCiclo = conta.configuracoes?.diaInicioCiclo ?? 1;
  if (planejado > 0 && diaInicioCiclo === 1) {
    const campanhas = entidades.filter((e) => e.tipo === 'campaign');
    const gastoMes = await buscarGastoMes(campanhas.map((c) => String(c._id)), 1);
    const gasto7 = campanhas.reduce((s, c) => s + (somarJanela(series.get(String(c._id)) ?? [], iniRecente, fim).spend ?? 0), 0);
    const hoje = new Date(`${dataBRT(0)}T12:00:00Z`);
    const diasNoMes = new Date(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1, 0).getDate();
    const s = ritmoPlanejado({ gastoMes, mediaDiaria7d: gasto7 / 7, diaDoMes: hoje.getUTCDate(), diasNoMes, planejado });
    if (s) sinais.push({ ...s, categoria: CATEGORIA_SINAL[s.tipo], nivel: 'conta', entidadeId: conta.identificador, entidadeNome: conta.nome, campanhaNome: null, metricaResultado: null, origemResultado: null });
  }

  const ordem = { alta: 0, media: 1, baixa: 2 };
  sinais.sort((a, b) => (ordem[a.severidade] - ordem[b.severidade]) || ((b.desperdicioDia ?? 0) - (a.desperdicioDia ?? 0)));
  return { dia: dataBRT(0), sinais };
}

/** Substitui os sinais do dia da conta pelos recém-gerados. */
export async function persistirSinais(contaIdentificador, dia, sinais) {
  await query('DELETE FROM sinais_conta WHERE conta_id = $1 AND gerado_em = $2', [contaIdentificador, dia]);
  if (!sinais.length) return 0;

  const colunas = ['conta_id', 'gerado_em', 'tipo', 'nivel', 'entidade_id', 'entidade_nome', 'campanha_nome', 'metrica_resultado', 'origem_resultado', 'severidade', 'desperdicio_dia', 'frase', 'evidencia'];
  const valores = [];
  const placeholders = sinais.map((s, li) => {
    valores.push(contaIdentificador, dia, s.tipo, s.nivel, s.entidadeId, s.entidadeNome ?? null, s.campanhaNome ?? null,
      s.metricaResultado ?? null, s.origemResultado ?? null, s.severidade, s.desperdicioDia ?? null, s.frase, JSON.stringify(s.evidencia ?? {}));
    return `(${colunas.map((_, ci) => `$${li * colunas.length + ci + 1}`).join(', ')})`;
  });
  await query(
    `INSERT INTO sinais_conta (${colunas.join(', ')}) VALUES ${placeholders.join(', ')}
     ON CONFLICT (conta_id, gerado_em, tipo, entidade_id) DO UPDATE SET
       severidade = EXCLUDED.severidade, desperdicio_dia = EXCLUDED.desperdicio_dia,
       frase = EXCLUDED.frase, evidencia = EXCLUDED.evidencia`,
    valores
  );
  return sinais.length;
}
