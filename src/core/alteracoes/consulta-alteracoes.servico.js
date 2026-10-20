/**
 * Leitura do registro de alterações para o painel.
 *
 * Devolve os eventos crus do período; a agregação por gestor, por conta e por
 * dia é feita no painel, que precisa cruzar os mesmos eventos de três jeitos
 * e já tem a lista de contas e gestores em mãos.
 */
import { query } from '../../infra/postgres.js';

/** Teto de eventos por consulta: 90 dias de 20 contas cabem com folga. */
const LIMITE_EVENTOS = 20000;

/**
 * Eventos das contas informadas num intervalo [desde, ate).
 * @param {string[]} contaIds - Conta.identificador
 * @param {Date} desde
 * @param {Date} ate
 */
export async function listarAlteracoes(contaIds, desde, ate) {
  if (!contaIds.length) return [];
  const r = await query(
    `SELECT id, conta_id, conta_anuncio_id, ocorrida_em, autor_id, autor_nome, aplicacao, gestor_id,
            sistema, oculto, categoria, tipo, frase, objeto_tipo, objeto_id, objeto_nome, campanha_id, campanha_nome
     FROM alteracoes_conta
     WHERE conta_id = ANY($1) AND ocorrida_em >= $2 AND ocorrida_em < $3
     ORDER BY ocorrida_em DESC
     LIMIT ${LIMITE_EVENTOS}`,
    [contaIds, desde, ate]
  );
  return r.rows.map((x) => ({
    id: Number(x.id),
    contaId: x.conta_id,
    contaAnuncioId: x.conta_anuncio_id,
    ocorridaEm: x.ocorrida_em,
    autorId: x.autor_id,
    autorNome: x.autor_nome,
    aplicacao: x.aplicacao,
    gestorId: x.gestor_id,
    sistema: x.sistema,
    oculto: x.oculto,
    categoria: x.categoria,
    tipo: x.tipo,
    frase: x.frase,
    objetoTipo: x.objeto_tipo,
    objetoId: x.objeto_id,
    objetoNome: x.objeto_nome,
    campanhaId: x.campanha_id,
    campanhaNome: x.campanha_nome,
  }));
}

/**
 * Última ação humana de cada conta, independente do período — para saber há
 * quantos dias ninguém mexe numa conta mesmo quando o painel mostra só uma
 * semana.
 * @returns {Promise<Map<string, {ocorridaEm: Date, autorId: string, autorNome: string, gestorId: string|null, frase: string}>>}
 */
export async function ultimaAcaoHumanaPorConta(contaIds) {
  const mapa = new Map();
  if (!contaIds.length) return mapa;
  const r = await query(
    `SELECT DISTINCT ON (conta_id) conta_id, ocorrida_em, autor_id, autor_nome, gestor_id, frase
     FROM alteracoes_conta
     WHERE conta_id = ANY($1) AND sistema = false AND oculto = false
     ORDER BY conta_id, ocorrida_em DESC`,
    [contaIds]
  );
  for (const x of r.rows) {
    mapa.set(x.conta_id, { ocorridaEm: x.ocorrida_em, autorId: x.autor_id, autorNome: x.autor_nome, gestorId: x.gestor_id, frase: x.frase });
  }
  return mapa;
}

/**
 * Autores humanos vistos nas contas, com o gestor a que estão vinculados (ou
 * null). É a lista que o painel usa para pedir o vínculo.
 */
export async function listarAutores(contaIds) {
  if (!contaIds.length) return [];
  const r = await query(
    `SELECT autor_id, MAX(autor_nome) AS autor_nome, MAX(gestor_id) AS gestor_id,
            COUNT(*)::int AS eventos, MAX(ocorrida_em) AS ultimo_em,
            array_agg(DISTINCT conta_id) AS contas
     FROM alteracoes_conta
     WHERE conta_id = ANY($1) AND sistema = false AND autor_id IS NOT NULL
     GROUP BY autor_id
     ORDER BY MAX(ocorrida_em) DESC`,
    [contaIds]
  );
  return r.rows.map((x) => ({
    autorId: x.autor_id, autorNome: x.autor_nome, gestorId: x.gestor_id,
    eventos: x.eventos, ultimoEm: x.ultimo_em, contas: x.contas,
  }));
}
