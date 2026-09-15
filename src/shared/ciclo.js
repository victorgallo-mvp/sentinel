/**
 * Ciclo de faturamento do cliente.
 *
 * O gasto "do mês" raramente coincide com o mês-calendário: cada cliente fecha
 * num dia próprio (do 10 ao 10, do 15 ao 15). Estas funções resolvem a janela
 * vigente a partir desse dia, sempre em BRT.
 */

const BRT_MS = 3 * 60 * 60 * 1000;

/**
 * `janela_horas` sob a qual o agregado do ciclo é gravado em
 * `metricas_serie_temporal`. O valor 1 estava livre — as demais janelas em uso
 * são 24 (diária), 168 (7d), 720 (30d) e 744 (mês-calendário).
 */
export const JANELA_CICLO_HORAS = 1;

/** Último dia do mês (1-12) de um ano — trata anos bissextos. */
function ultimoDiaDoMes(ano, mes) {
  return new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
}

/**
 * Ancora o dia de virada dentro de um mês concreto.
 * Dia 31 em abril vira 30; dia 30 em fevereiro vira 28 (ou 29). É a regra usual
 * de cobrança: quando o dia não existe, usa-se o último do mês.
 */
function ancorarDia(ano, mes, diaDesejado) {
  return Math.min(diaDesejado, ultimoDiaDoMes(ano, mes));
}

/**
 * Janela do ciclo vigente em `referencia`.
 *
 * O ciclo COMEÇA no dia de virada e termina na véspera da virada seguinte —
 * "do 10 ao 10" quer dizer de 10/09 a 09/10, com o dia 10/10 já pertencendo ao
 * ciclo seguinte. `until` é inclusivo, no formato que a Meta espera em
 * `time_range`.
 *
 * @param {number} diaInicio - 1 a 31 (1 = mês-calendário)
 * @param {Date} [referencia] - momento de referência (padrão: agora)
 * @returns {{since: string, until: string, inicio: Date, fim: Date}} datas ISO (YYYY-MM-DD)
 */
export function janelaCicloAtual(diaInicio = 1, referencia = new Date()) {
  const dia = Number.isInteger(diaInicio) && diaInicio >= 1 && diaInicio <= 31 ? diaInicio : 1;

  // Trabalha no "calendário BRT" deslocando o instante e usando métodos UTC.
  const brt = new Date(referencia.getTime() - BRT_MS);
  const ano = brt.getUTCFullYear();
  const mes = brt.getUTCMonth();
  const hoje = brt.getUTCDate();

  // Se ainda não chegou no dia de virada deste mês, o ciclo começou no mês passado.
  const viradaEsteMes = ancorarDia(ano, mes, dia);
  const comecouMesAnterior = hoje < viradaEsteMes;

  const anoIni = comecouMesAnterior && mes === 0 ? ano - 1 : ano;
  const mesIni = comecouMesAnterior ? (mes === 0 ? 11 : mes - 1) : mes;
  const inicio = new Date(Date.UTC(anoIni, mesIni, ancorarDia(anoIni, mesIni, dia)));

  // Fim = véspera da próxima virada.
  const anoFim = mesIni === 11 ? anoIni + 1 : anoIni;
  const mesFim = mesIni === 11 ? 0 : mesIni + 1;
  const proximaVirada = new Date(Date.UTC(anoFim, mesFim, ancorarDia(anoFim, mesFim, dia)));
  const fim = new Date(proximaVirada.getTime() - 24 * 60 * 60 * 1000);

  return {
    since: inicio.toISOString().slice(0, 10),
    until: fim.toISOString().slice(0, 10),
    inicio,
    fim,
  };
}

/** Rótulo curto do ciclo para exibição: "10/09 a 09/10". */
export function rotuloCiclo(diaInicio = 1, referencia = new Date()) {
  const { inicio, fim } = janelaCicloAtual(diaInicio, referencia);
  const br = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${br(inicio)} a ${br(fim)}`;
}
