/**
 * Triagem de performance: a cada 3 dias, monta a tabela comparativa de cada
 * conta, pede a leitura ao modelo e persiste em `analises_conta` (Postgres).
 *
 * Fica no Postgres, junto das métricas, porque quem mais consome isso são os
 * relatórios e agentes que já consultam `metricas_serie_temporal` — assim a
 * leitura e os números que a originaram vivem no mesmo banco e na mesma
 * consulta. A tabela enviada ao modelo é guardada junto, o que torna cada
 * análise auditável em vez de apenas narrada.
 *
 * Falha numa conta não interrompe as demais.
 */
import { Conta } from '../../dominio/conta.modelo.js';
import { Entidade } from '../../dominio/entidade.modelo.js';
import { query } from '../../infra/postgres.js';
import { logger } from '../../infra/logger.js';
import { config } from '../../config/index.js';
import { metricaResultadoEntidade } from '../../config/metricas.config.js';
import { resolverObjetivosConta } from '../../config/objetivos.config.js';
import { montarComparativoConta } from './comparativo-conta.servico.js';
import { analisarPerformance } from './triagem-performance.agente.js';

// Ordem de VALOR DE NEGÓCIO, do fundo do funil para o topo. Desempatar por
// volume seria errado: cliques sempre superam conversões em número absoluto, e
// uma conta de e-commerce acabaria avaliada por cliques.
const PRIORIDADE_RESULTADO = [
  'conversions',
  'leads',
  'messaging_conversations_started',
  'video_thruplay_watched_actions',
  'inline_link_clicks',
  'clicks',
  'reach',
];

/**
 * Métrica de resultado da conta: a de maior valor de negócio entre as que as
 * campanhas declaram E que realmente tem dado.
 *
 * Os dois filtros importam. Uma conta configurada como "conversão" mas sem
 * nenhuma conversão rastreada precisa cair para o que ela de fato mede (o caso
 * do Dilson, que opera por WhatsApp); e uma conta que mede conversões não pode
 * ser avaliada por cliques só porque cliques são mais numerosos (o Alemão).
 */
/** Quais das métricas pedidas realmente têm valor nos últimos 30 dias. */
async function metricasComDado(campanhaIds, metricas) {
  if (!metricas.length) return new Set();
  const r = await query(
    `SELECT metrica FROM metricas_serie_temporal
     WHERE entidade_id = ANY($1) AND metrica = ANY($2) AND janela_horas = 24
       AND coletada_em > now() - interval '30 days'
     GROUP BY metrica HAVING SUM(valor) > 0`,
    [campanhaIds, metricas]
  );
  return new Set(r.rows.map((x) => x.metrica));
}

// Métricas que o sistema usa como ÚLTIMO recurso, quando a campanha não declara
// um objetivo mapeável. Não são escolhas — são desistências, e por isso não
// devem impedir que um resultado de verdade seja considerado.
const PROXIES_FRACOS = new Set(['clicks', 'reach', 'inline_link_clicks']);

async function resolverMetricaResultado(conta, campanhas, campanhaIds) {
  // 1º: o que o operador declarou no perfil da conta. É a intenção explícita e
  // ganha do que as campanhas dizem à Meta — uma conta de WhatsApp costuma ter
  // campanhas OUTCOME_ENGAGEMENT genéricas, que não revelam isso.
  const doPerfil = resolverObjetivosConta(conta.perfil)
    .map((o) => o.metricaResultado)
    .filter(Boolean);
  if (doPerfil.length) {
    const comDadoPerfil = await metricasComDado(campanhaIds, doPerfil);
    const escolhida = doPerfil.find((m) => comDadoPerfil.has(m));
    if (escolhida) return escolhida;
    // Nenhum objetivo declarado produziu resultado: segue para a inferência.
  }

  const declaradas = new Set(campanhas.map((e) => metricaResultadoEntidade(e)));

  // Quando tudo o que as campanhas declaram é proxy fraco, o objetivo real não
  // foi informado à Meta — caso do OUTCOME_ENGAGEMENT sem optimization_goal, que
  // cobre de curtida a conversa de WhatsApp. Aí vale procurar o que a conta de
  // fato produz, em vez de avaliá-la por cliques.
  const soProxy = [...declaradas].every((m) => PROXIES_FRACOS.has(m));
  const candidatas = soProxy
    ? PRIORIDADE_RESULTADO
    : PRIORIDADE_RESULTADO.filter((m) => declaradas.has(m));

  if (candidatas.length <= 1) return candidatas[0] ?? 'clicks';

  const comDado = await metricasComDado(campanhaIds, candidatas);

  // Primeira da prioridade que tenha dado; se nenhuma tiver, a mais valiosa
  // entre as declaradas (a conta simplesmente não produziu resultado).
  return candidatas.find((m) => comDado.has(m))
    ?? candidatas.find((m) => declaradas.has(m))
    ?? 'clicks';
}

async function persistirAnalise(conta, comparativo, analise, metricaResultado) {
  await query(
    `INSERT INTO analises_conta
       (conta_id, conta_nome, situacao, resumo, fatores, acao, metricas, metrica_resultado, modelo, custo_usd)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, $9, $10)`,
    [
      conta.identificador, conta.nome, analise.situacao, analise.resumo,
      JSON.stringify(analise.fatores), analise.acao,
      JSON.stringify(comparativo), metricaResultado,
      analise.modelo, analise.custoUsd,
    ]
  );
}

/**
 * @param {Object} [opcoes]
 * @param {string} [opcoes.identificador] - roda só nessa conta
 * @param {boolean} [opcoes.persistir=true] - false para ensaiar sem gravar
 */
export async function executarTriagemPerformance({ identificador, persistir = true } = {}) {
  if (!config.iaTriagemPerformanceAtiva) {
    logger.info({ msg: 'Triagem de performance desligada (IA_TRIAGEM_PERFORMANCE_ATIVA=false)' });
    return { analisadas: 0, custoTotalUsd: 0 };
  }

  const filtro = { ativo: true, ...(identificador ? { identificador } : {}) };
  const contas = await Conta.find(filtro).lean();
  logger.info({ msg: 'Iniciando triagem de performance', contas: contas.length, modelo: config.modeloTriagemPerformance });

  let analisadas = 0;
  let custoTotalUsd = 0;
  const resultados = [];

  for (const conta of contas) {
    try {
      const campanhas = await Entidade.find({ contaId: conta._id, tipo: 'campaign', 'configuracoes.monitorada': true }).lean();
      const campanhaIds = campanhas.map((e) => String(e._id));
      if (!campanhaIds.length) continue;

      const metricaResultado = await resolverMetricaResultado(conta, campanhas, campanhaIds);
      const comparativo = await montarComparativoConta(conta, campanhaIds, metricaResultado);

      // Sem nenhuma janela comparável, a leitura seria adivinhação.
      if (!comparativo || (!comparativo.seteDias && !comparativo.trintaDias)) {
        logger.warn({ msg: 'Triagem pulada — coleta não cobre nenhum período comparável', conta: conta.nome });
        continue;
      }

      const analise = await analisarPerformance(comparativo);
      if (persistir) await persistirAnalise(conta, comparativo, analise, metricaResultado);

      analisadas++;
      custoTotalUsd += analise.custoUsd;
      resultados.push({ conta: conta.nome, ...analise });
    } catch (erro) {
      logger.error({ msg: 'Falha na triagem de uma conta — seguindo com as demais', conta: conta.nome, erro: erro.message });
    }
  }

  logger.info({ msg: 'Triagem de performance concluída', analisadas, custoTotalUsd: custoTotalUsd.toFixed(4) });
  return { analisadas, custoTotalUsd, resultados };
}

/** Última análise de cada conta, para o dashboard e para quem consulta o banco. */
export async function buscarAnalisesRecentes(identificadores) {
  if (!identificadores?.length) return new Map();
  const r = await query(
    `SELECT DISTINCT ON (conta_id) conta_id, situacao, resumo, fatores, acao, metrica_resultado,
            metricas, analisada_em
     FROM analises_conta WHERE conta_id = ANY($1)
     ORDER BY conta_id, analisada_em DESC`,
    [identificadores]
  );
  return new Map(r.rows.map((x) => [x.conta_id, x]));
}
