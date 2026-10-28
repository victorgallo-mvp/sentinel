/**
 * Leitura diária: junta os sinais do dia de uma conta num JSON compacto, pede
 * a leitura ao modelo e persiste em `leituras_conta`. Roda depois do motor de
 * sinais; conta sem sinal não gera chamada nem linha.
 *
 * O impacto em R$/dia de cada prioridade é somado AQUI a partir dos sinais que
 * o modelo citou — o modelo só escolhe e explica, nunca calcula.
 */
import { Conta } from '../../dominio/conta.modelo.js';
import { query } from '../../infra/postgres.js';
import { config } from '../../config/index.js';
import { resolverObjetivosConta } from '../../config/objetivos.config.js';
import { ROTULO_RESULTADO } from './resolucao-resultado.js';
import { ROTULO_TIPO, ROTULO_CATEGORIA, listarSinais } from './consulta-sinais.servico.js';
import { caminhoSinal } from './motor-sinais.servico.js';
import { lerSinais } from './leitura-diaria.agente.js';
import { dataBRT } from '../../shared/utils.js';
import { logger } from '../../infra/logger.js';
import { ErroNaoEncontrado } from '../../shared/erros.js';

const n2 = (v) => (v == null ? null : Number(Number(v).toFixed(2)));
const isoDiasAntes = (iso, n) => new Date(new Date(`${iso}T12:00:00Z`).getTime() - n * 86400000).toISOString().slice(0, 10);

/** Identidade de um sinal dentro do dia: casa com a chave única de `sinais_conta`. */
export const chaveSinal = (s) => `${s.tipo}|${s.entidadeId}`;

/** R$/dia que o sinal representa: desperdício, ganho possível ou custo projetado. */
export function valorDiaSinal(s) {
  if (s.desperdicioDia != null) return { valorDia: n2(s.desperdicioDia), natureza: 'vazando' };
  const economia = s.economiaDia ?? s.evidencia?.economiaDia;
  if (economia != null) return { valorDia: n2(economia), natureza: 'recuperavel' };
  const projetado = s.evidencia?.extraProjetadoDia;
  if (projetado != null) return { valorDia: n2(projetado), natureza: 'projetado' };
  return { valorDia: null, natureza: null };
}

/**
 * Monta o JSON enviado ao modelo. Aceita sinais vindos do banco (listarSinais)
 * ou direto do motor (gerarSinaisConta); os dois têm os mesmos campos de texto.
 *
 * @param {Object} o
 * @param {Object} o.conta - Conta (lean)
 * @param {string} o.dia - YYYY-MM-DD
 * @param {Array} o.sinais
 * @param {number|null} o.vazandoOntemDia
 * @param {Object|null} o.leituraAnterior - {resumo, prioridades} de ontem
 */
export function montarEntradaLeitura({ conta, dia, sinais, vazandoOntemDia = null, leituraAnterior = null }) {
  const objetivos = resolverObjetivosConta(conta.perfil).map((o) => o.rotulo ?? o.chave);
  const porCategoria = {};
  for (const s of sinais) porCategoria[s.categoria] = (porCategoria[s.categoria] ?? 0) + 1;
  const vazandoDia = sinais.filter((s) => s.categoria === 'desperdicio').reduce((t, s) => t + (s.desperdicioDia ?? 0), 0);
  const recuperavelDia = sinais.reduce((t, s) => t + (s.economiaDia ?? s.evidencia?.economiaDia ?? 0), 0);

  return {
    dia,
    conta: {
      nome: conta.nome,
      gestor: conta.perfil?.gerenteResponsavel || null,
      // Só quando existem: lista vazia virava "a conta não tem objetivo" na leitura.
      ...(objetivos.length ? { objetivosDeclarados: objetivos } : {}),
    },
    totais: {
      sinais: sinais.length,
      porCategoria,
      vazandoDia: n2(vazandoDia),
      vazandoOntemDia: n2(vazandoOntemDia),
      recuperavelDia: n2(recuperavelDia),
    },
    sinais: sinais.map((s, i) => {
      const { valorDia, natureza } = valorDiaSinal(s);
      return {
        ref: `s${i + 1}`,
        categoria: ROTULO_CATEGORIA[s.categoria] ?? s.categoria,
        tipo: ROTULO_TIPO[s.tipo] ?? s.tipo,
        severidade: s.severidade,
        onde: caminhoSinal(s),
        resultado: s.metricaResultado ? (ROTULO_RESULTADO[s.metricaResultado] ?? s.metricaResultado) : null,
        frase: s.frase,
        explicacao: s.explicacao ?? null,
        sugestao: s.sugestao ?? null,
        valorDia,
        natureza,
      };
    }),
    leituraAnterior: leituraAnterior
      ? { resumo: leituraAnterior.resumo, prioridades: (leituraAnterior.prioridades ?? []).map((p) => p.titulo) }
      : null,
  };
}

/**
 * Amarra as prioridades do modelo aos sinais reais e soma o impacto.
 * @returns {Array<{ordem, titulo, onde, porque, acao, sinais: Array<{tipo, entidadeId}>, impactoDia, natureza}>}
 */
export function amarrarPrioridades(prioridades, entrada, sinais) {
  const porRef = new Map(entrada.sinais.map((e, i) => [e.ref, sinais[i]]));
  return prioridades.map((p) => {
    const citados = p.refs.map((r) => porRef.get(r)).filter(Boolean);
    const vazando = citados.filter((s) => s.desperdicioDia != null).reduce((t, s) => t + s.desperdicioDia, 0);
    const recuperavel = citados.reduce((t, s) => t + (s.economiaDia ?? s.evidencia?.economiaDia ?? 0), 0);
    const projetado = citados.filter((s) => s.desperdicioDia == null && s.evidencia?.extraProjetadoDia != null).reduce((t, s) => t + s.evidencia.extraProjetadoDia, 0);
    const [impactoDia, natureza] = vazando > 0 ? [vazando, 'vazando'] : recuperavel > 0 ? [recuperavel, 'recuperavel'] : projetado > 0 ? [projetado, 'projetado'] : [null, null];
    return {
      ordem: p.ordem,
      titulo: p.titulo,
      onde: p.onde,
      porque: p.porque,
      acao: p.acao,
      sinais: citados.map((s) => ({ tipo: s.tipo, entidadeId: s.entidadeId, severidade: s.severidade })),
      impactoDia: n2(impactoDia),
      natureza,
    };
  });
}

/** Última leitura de uma conta antes de `dia` (para continuidade). */
export async function leituraAnteriorDe(contaIdentificador, dia) {
  const r = await query(
    `SELECT to_char(gerado_em, 'YYYY-MM-DD') AS dia, resumo, prioridades FROM leituras_conta
     WHERE conta_id = $1 AND gerado_em < $2 ORDER BY gerado_em DESC LIMIT 1`,
    [contaIdentificador, dia]
  );
  return r.rows[0] ?? null;
}

/** Vazamento (categoria desperdício) de um dia específico. */
export async function vazandoNoDia(contaIdentificador, dia) {
  const r = await query(
    `SELECT COALESCE(SUM(desperdicio_dia) FILTER (WHERE categoria = 'desperdicio'), 0)::float AS v, COUNT(*)::int AS n
     FROM sinais_conta WHERE conta_id = $1 AND gerado_em = $2`,
    [contaIdentificador, dia]
  );
  return r.rows[0]?.n > 0 ? r.rows[0].v : null;
}

/**
 * Gera a leitura de uma conta para um dia. Se `sinais` não vier, lê do banco.
 * @returns {Promise<{dia, leitura: Object|null, motivo?: string}>}
 */
export async function gerarLeituraConta(contaId, { dia = dataBRT(0), sinais = null } = {}) {
  const conta = await Conta.findById(contaId).lean();
  if (!conta) throw new ErroNaoEncontrado(`Conta ${contaId} não encontrada`);

  const lista = sinais ?? await listarSinais([conta.identificador], dia);
  if (!lista.length) return { dia, leitura: null, motivo: 'sem sinais' };

  // Continuidade (ontem e leitura anterior) é desejável, não obrigatória: se
  // a consulta falhar, a leitura sai sem base de comparação em vez de não sair.
  const ontem = isoDiasAntes(dia, 1);
  const [vazandoOntemDia, anterior] = await Promise.all([
    vazandoNoDia(conta.identificador, ontem).catch((e) => { logger.warn({ msg: 'Sem vazamento de ontem para comparar', conta: conta.identificador, erro: e.message }); return null; }),
    leituraAnteriorDe(conta.identificador, dia).catch((e) => { logger.warn({ msg: 'Sem leitura anterior para continuidade', conta: conta.identificador, erro: e.message }); return null; }),
  ]);

  const entrada = montarEntradaLeitura({ conta, dia, sinais: lista, vazandoOntemDia, leituraAnterior: anterior });
  const resposta = await lerSinais(entrada);
  const prioridades = amarrarPrioridades(resposta.prioridades, entrada, lista);

  return {
    dia,
    leitura: {
      contaId: conta.identificador,
      resumo: resposta.resumo,
      tendencia: resposta.tendencia,
      prioridades,
      observacao: resposta.observacao,
      totalSinais: lista.length,
      vazandoDia: entrada.totais.vazandoDia ?? 0,
      recuperavelDia: entrada.totais.recuperavelDia ?? 0,
      entrada,
      modelo: resposta.modelo,
      custoUsd: resposta.custoUsd,
    },
  };
}

export async function persistirLeitura(dia, l) {
  await query(
    `INSERT INTO leituras_conta (conta_id, gerado_em, resumo, tendencia, prioridades, observacao, total_sinais, vazando_dia, recuperavel_dia, entrada, modelo, custo_usd)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (conta_id, gerado_em) DO UPDATE SET
       resumo = EXCLUDED.resumo, tendencia = EXCLUDED.tendencia, prioridades = EXCLUDED.prioridades, observacao = EXCLUDED.observacao,
       total_sinais = EXCLUDED.total_sinais, vazando_dia = EXCLUDED.vazando_dia, recuperavel_dia = EXCLUDED.recuperavel_dia,
       entrada = EXCLUDED.entrada, modelo = EXCLUDED.modelo, custo_usd = EXCLUDED.custo_usd, criado_em = now()`,
    [l.contaId, dia, l.resumo, l.tendencia, JSON.stringify(l.prioridades), l.observacao, l.totalSinais, l.vazandoDia, l.recuperavelDia,
      JSON.stringify(l.entrada), l.modelo, l.custoUsd]
  );
}

/**
 * Leituras de um dia para o painel.
 * @returns {Promise<Map<string, Object>>} identificador → leitura
 */
export async function listarLeituras(contaIds, dia) {
  const mapa = new Map();
  if (!contaIds.length || !dia) return mapa;
  const r = await query(
    `SELECT conta_id, resumo, tendencia, prioridades, observacao, total_sinais, vazando_dia::float AS vazando_dia,
            recuperavel_dia::float AS recuperavel_dia, modelo, criado_em
     FROM leituras_conta WHERE conta_id = ANY($1) AND gerado_em = $2`,
    [contaIds, dia]
  );
  for (const x of r.rows) {
    mapa.set(x.conta_id, {
      resumo: x.resumo, tendencia: x.tendencia, prioridades: x.prioridades ?? [], observacao: x.observacao,
      totalSinais: x.total_sinais, vazandoDia: x.vazando_dia, recuperavelDia: x.recuperavel_dia, modelo: x.modelo, criadoEm: x.criado_em,
    });
  }
  return mapa;
}

export const leituraAtiva = () => config.iaLeituraSinaisAtiva;
