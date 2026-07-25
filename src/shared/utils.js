/**
 * Funções utilitárias compartilhadas (estatística, datas, formatação).
 */

// BRT = UTC-3, sem horário de verão (Brasil aboliu em 2019)
const BRT_MS = 3 * 60 * 60 * 1000;

/**
 * Retorna o início do dia N dias atrás no fuso BRT (GMT-3), como Date UTC.
 *   inicioDiaBRT(0)  → hoje 00:00 BRT     = hoje 03:00 UTC
 *   inicioDiaBRT(1)  → ontem 00:00 BRT    = ontem 03:00 UTC
 *   inicioDiaBRT(-1) → amanhã 00:00 BRT   = amanhã 03:00 UTC
 */
export function inicioDiaBRT(diasAtras = 0) {
  const brt = new Date(Date.now() - BRT_MS); // relógio no "fuso BRT"
  brt.setUTCHours(0, 0, 0, 0);               // meia-noite BRT
  if (diasAtras) brt.setUTCDate(brt.getUTCDate() - diasAtras);
  return new Date(brt.getTime() + BRT_MS);   // de volta para UTC
}

/**
 * Retorna o início do mês corrente (dia 1) no fuso BRT, como Date UTC.
 */
export function inicioMesBRT() {
  const brt = new Date(Date.now() - BRT_MS);
  brt.setUTCDate(1);
  brt.setUTCHours(0, 0, 0, 0);
  return new Date(brt.getTime() + BRT_MS);
}

/**
 * Dia da semana atual em BRT (0 = domingo … 6 = sábado).
 */
export function diaDaSemananaBRT() {
  return new Date(Date.now() - BRT_MS).getUTCDay();
}

/** Calcula a média de um array de números. */
export function calcularMedia(valores) {
  if (!valores || valores.length === 0) return 0;
  const soma = valores.reduce((acc, v) => acc + v, 0);
  return soma / valores.length;
}

/** Calcula o desvio padrão (populacional) de um array de números. */
export function calcularDesvioPadrao(valores, media = null) {
  if (!valores || valores.length < 2) return 0;
  const m = media ?? calcularMedia(valores);
  const somaQuadrados = valores.reduce((acc, v) => acc + (v - m) ** 2, 0);
  return Math.sqrt(somaQuadrados / valores.length);
}

/** Calcula estatísticas básicas (média, desvio, mín, máx, n) de um array. */
export function calcularEstatisticas(valores) {
  const numeros = (valores || []).map(Number).filter((v) => !Number.isNaN(v));
  if (numeros.length === 0) {
    return { media: 0, desvioPadrao: 0, minimo: 0, maximo: 0, quantidade: 0 };
  }
  const media = calcularMedia(numeros);
  return {
    media,
    desvioPadrao: calcularDesvioPadrao(numeros, media),
    minimo: Math.min(...numeros),
    maximo: Math.max(...numeros),
    quantidade: numeros.length,
  };
}

/** Calcula quantos desvios padrão um valor está distante da média. */
export function calcularMagnitudeDesvios(valor, media, desvioPadrao) {
  if (!desvioPadrao || desvioPadrao === 0) return 0;
  return Math.abs(valor - media) / desvioPadrao;
}

/** Arredonda um número para N casas decimais. */
export function arredondar(numero, casas = 2) {
  const fator = 10 ** casas;
  return Math.round((Number(numero) || 0) * fator) / fator;
}

/** Formata um valor monetário em BRL ou USD pra exibição. */
export function formatarMoeda(valor, moeda = 'BRL') {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: moeda,
  }).format(Number(valor) || 0);
}

/** Formata um percentual (0.0512 -> "5.12%"). */
export function formatarPercentual(valor, casas = 2) {
  return `${arredondar((Number(valor) || 0) * 100, casas)}%`;
}

/** Pausa a execução por N milissegundos. Útil em retries com backoff. */
export function aguardar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executa uma função assíncrona com retry e backoff exponencial.
 * @param {Function} fn - função assíncrona a executar
 * @param {Object} opcoes - { tentativas, esperaBaseMs, fatorBackoff }
 */
export async function comRetry(fn, opcoes = {}) {
  const { tentativas = 3, esperaBaseMs = 500, fatorBackoff = 2 } = opcoes;
  let ultimoErro;

  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    try {
      return await fn(tentativa);
    } catch (erro) {
      ultimoErro = erro;
      if (tentativa < tentativas) {
        const espera = esperaBaseMs * fatorBackoff ** (tentativa - 1);
        await aguardar(espera);
      }
    }
  }

  throw ultimoErro;
}

/** Retorna a data atual no formato ISO truncado em horas (chave de deduplicação). */
export function chaveHoraAtual(data = new Date()) {
  const d = new Date(data);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

/**
 * Arredonda uma data para o múltiplo de N minutos mais próximo (pra baixo).
 * Usado pra garantir idempotência na persistência de métricas: execuções
 * do mesmo "tick" de coleta geram o mesmo timestamp `coletada_em`.
 */
export function arredondarParaIntervalo(data = new Date(), minutos = 5) {
  const d = new Date(data);
  const ms = minutos * 60 * 1000;
  return new Date(Math.floor(d.getTime() / ms) * ms);
}
