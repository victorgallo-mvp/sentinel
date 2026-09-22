/**
 * Monta a tabela comparativa de uma conta: 7d contra os 7d anteriores e 30d
 * contra os 30d anteriores, para as métricas que importam na leitura de
 * performance.
 *
 * É a camada DETERMINÍSTICA da triagem. O modelo classifica e explica em cima
 * desta tabela, mas nunca calcula: número que vai para a tela sai daqui.
 */
import { agregarResultadoPeriodo } from './veredito.servico.js';
import { diasComColeta, COBERTURA_MINIMA } from './cobertura.js';
import { inicioDiaBRT } from '../../shared/utils.js';
import { query } from '../../infra/postgres.js';
import { JANELA_30D_HORAS } from '../../config/janelas.js';

// Componentes crus; tudo o mais é derivado deles, pela mesma regra que o
// dashboard usa (razão recomposta de soma÷soma, nunca média de razões).
const COMPONENTES = [
  'spend', 'impressions', 'clicks', 'inline_link_clicks',
  'purchase_revenue', 'add_to_cart',
];

export function variacaoPct(atual, anterior) {
  if (anterior == null || atual == null) return null;
  if (anterior === 0) return null; // variação a partir de zero não é medida
  return Number((((atual - anterior) / anterior) * 100).toFixed(1));
}

export function dividir(num, den, fator = 1) {
  return den > 0 ? Number(((num / den) * fator).toFixed(4)) : null;
}

/** Soma os componentes de uma janela e deriva as razões. */
async function agregarJanela(campanhaIds, metricaResultado, desde, ate) {
  const metricas = [...new Set([...COMPONENTES, metricaResultado])];
  const valores = Object.fromEntries(
    await Promise.all(metricas.map(async (m) => [m, await agregarResultadoPeriodo(campanhaIds, m, desde, ate)]))
  );

  const resultado = valores[metricaResultado] ?? 0;
  return {
    gasto: Number(valores.spend.toFixed(2)),
    impressoes: valores.impressions,
    resultado,
    custoPorResultado: dividir(valores.spend, resultado),
    ctrLink: dividir(valores.inline_link_clicks, valores.impressions, 100),
    cpcLink: dividir(valores.spend, valores.inline_link_clicks),
    carrinhos: valores.add_to_cart || null,
    receita: valores.purchase_revenue || null,
    roas: dividir(valores.purchase_revenue, valores.spend),
  };
}

/** Compara duas janelas campo a campo, devolvendo valor atual, anterior e variação. */
function compararJanelas(atual, anterior) {
  const saida = {};
  for (const chave of Object.keys(atual)) {
    saida[chave] = {
      atual: atual[chave],
      anterior: anterior[chave],
      variacaoPct: variacaoPct(atual[chave], anterior[chave]),
    };
  }
  return saida;
}

/**
 * Frequência e alcance deduplicados do NÍVEL CONTA — somar campanhas
 * superestima (a mesma pessoa é alcançada por várias). Ponto no tempo, sem
 * comparação: o snapshot de 30d é substituído a cada coleta.
 */
async function frequenciaDaConta(contasAnuncioIds) {
  if (!contasAnuncioIds?.length) return null;
  const r = await query(
    `SELECT DISTINCT ON (entidade_id, metrica) metrica, valor::float AS v
     FROM metricas_serie_temporal
     WHERE entidade_id = ANY($1) AND entidade_tipo = 'account' AND janela_horas = $2
       AND metrica IN ('frequency', 'reach')
     ORDER BY entidade_id, metrica, coletada_em DESC`,
    [contasAnuncioIds, JANELA_30D_HORAS]
  );
  if (!r.rows.length) return null;
  const por = Object.fromEntries(r.rows.map((x) => [x.metrica, x.v]));
  return { frequencia30d: por.frequency ?? null, alcance30d: por.reach ?? null };
}

/**
 * @param {Object} conta - documento Conta
 * @param {string[]} campanhaIds - ids das campanhas monitoradas
 * @param {string} metricaResultado - métrica que conta como resultado desta conta
 * @returns {Promise<Object|null>} tabela comparativa, ou null se a coleta não cobre o período
 */
export async function montarComparativoConta(conta, campanhaIds, metricaResultado) {
  if (!campanhaIds?.length) return null;

  const hoje = inicioDiaBRT(0);
  const janelas = {
    ini7: inicioDiaBRT(7), iniAnt7: inicioDiaBRT(14),
    ini30: inicioDiaBRT(30), iniAnt30: inicioDiaBRT(60),
  };

  // Mesma guarda do veredito: sem coleta suficiente, comparar é inventar.
  const [d7, dAnt7, d30, dAnt30] = await Promise.all([
    diasComColeta(janelas.ini7, hoje),
    diasComColeta(janelas.iniAnt7, janelas.ini7),
    diasComColeta(janelas.ini30, hoje),
    diasComColeta(janelas.iniAnt30, janelas.ini30),
  ]);
  const cobertura = {
    dias7: d7, dias7Anterior: dAnt7, dias30: d30, dias30Anterior: dAnt30,
    comparavel7d: d7 / 7 >= COBERTURA_MINIMA && dAnt7 / 7 >= COBERTURA_MINIMA,
    comparavel30d: d30 / 30 >= COBERTURA_MINIMA && dAnt30 / 30 >= COBERTURA_MINIMA,
  };

  const [a7, b7, a30, b30, freq] = await Promise.all([
    agregarJanela(campanhaIds, metricaResultado, janelas.ini7, hoje),
    agregarJanela(campanhaIds, metricaResultado, janelas.iniAnt7, janelas.ini7),
    agregarJanela(campanhaIds, metricaResultado, janelas.ini30, hoje),
    agregarJanela(campanhaIds, metricaResultado, janelas.iniAnt30, janelas.ini30),
    frequenciaDaConta(conta.metaConfig?.contasAnuncioIds),
  ]);

  const saldo = (conta.saldoPrepago ?? [])
    .filter((s) => (conta.metaConfig?.contasAnuncioIds ?? []).includes(s.contaAnuncioId))
    .map((s) => ({ contaAnuncioId: s.contaAnuncioId, saldoReais: s.saldoReais, nivel: s.nivel, runwayHoras: s.runwayHoras }));

  return {
    conta: conta.nome,
    metricaResultado,
    cobertura,
    seteDias: cobertura.comparavel7d ? compararJanelas(a7, b7) : null,
    trintaDias: cobertura.comparavel30d ? compararJanelas(a30, b30) : null,
    nivelConta: freq,
    saldoPrepago: saldo.length ? saldo : null,
    investimentoMensalPlanejado: conta.perfil?.investimentoMensalPlanejado ?? null,
  };
}
