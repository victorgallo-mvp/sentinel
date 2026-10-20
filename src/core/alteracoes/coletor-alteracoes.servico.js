/**
 * Coleta do registro de alterações: lê o histórico da Meta de cada conta de
 * anúncio, traduz e classifica cada evento (dicionário), resolve a campanha e
 * o gestor, e grava em `alteracoes_conta`.
 *
 * Idempotente por `chave` (hash do evento), então o job diário relê os
 * últimos dias com folga e nada duplica. Falha em uma conta de anúncio não
 * impede as demais.
 */
import { createHash } from 'node:crypto';
import { Conta } from '../../dominio/conta.modelo.js';
import { Entidade } from '../../dominio/entidade.modelo.js';
import { Gestor } from '../../dominio/gestor.modelo.js';
import { listarAtividadesConta } from '../coleta/meta-api.cliente.js';
import { traduzirEvento, OBJETO } from './dicionario-meta.js';
import { query } from '../../infra/postgres.js';
import { logger } from '../../infra/logger.js';
import { ErroNaoEncontrado } from '../../shared/erros.js';

const LINHAS_POR_INSERT = 500;

/** Hash determinístico do evento — a Meta não devolve id. */
export function chaveEvento(contaAnuncioId, e) {
  const base = [contaAnuncioId, e.event_time, e.event_type, e.object_id ?? '', e.actor_id ?? '', typeof e.extra_data === 'string' ? e.extra_data : JSON.stringify(e.extra_data ?? null)].join('|');
  return createHash('sha1').update(base).digest('hex');
}

/** Normaliza nomes para comparar autor da Meta com o cadastro do gestor. */
export function normalizarNome(nome) {
  return String(nome ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Resolve o gestor de um autor: primeiro pelo vínculo explícito (`metaAtores`),
 * depois pelo nome igual ao cadastro. Devolve o id do gestor ou null.
 */
export function resolverGestor(gestores, autorId, autorNome) {
  if (!autorId || String(autorId) === '0') return null;
  for (const g of gestores) {
    if ((g.metaAtores ?? []).some((a) => String(a.id) === String(autorId))) return String(g._id);
  }
  const alvo = normalizarNome(autorNome);
  if (!alvo) return null;
  const porNome = gestores.find((g) => normalizarNome(g.nome) === alvo);
  return porNome ? String(porNome._id) : null;
}

/**
 * Mapa metaId → { campanhaId, campanhaNome } a partir das entidades da conta.
 * Campanha aponta para si mesma; conjunto e anúncio apontam para a campanha pai.
 */
async function mapaCampanhas(contaId) {
  const entidades = await Entidade.find({ contaId }).select('metaId tipo nome hierarquia.campanhaId').lean();
  const nomeCampanha = new Map(entidades.filter((e) => e.tipo === 'campaign').map((e) => [e.metaId, e.nome]));
  const mapa = new Map();
  for (const e of entidades) {
    const campanhaId = e.tipo === 'campaign' ? e.metaId : e.hierarquia?.campanhaId ?? null;
    mapa.set(e.metaId, { campanhaId, campanhaNome: campanhaId ? nomeCampanha.get(campanhaId) ?? null : null });
  }
  return mapa;
}

/** Converte um evento bruto numa linha pronta para o banco. */
export function montarLinha(conta, contaAnuncioId, evento, gestores, campanhas) {
  const t = traduzirEvento(evento);
  const campanha = campanhas.get(String(evento.object_id)) ?? {};
  return {
    conta_id: conta.identificador,
    conta_anuncio_id: contaAnuncioId,
    chave: chaveEvento(contaAnuncioId, evento),
    ocorrida_em: new Date(evento.event_time),
    autor_id: evento.actor_id != null ? String(evento.actor_id) : null,
    autor_nome: evento.actor_name ?? null,
    aplicacao: evento.application_name ?? null,
    gestor_id: t.sistema ? null : resolverGestor(gestores, evento.actor_id, evento.actor_name),
    sistema: t.sistema,
    oculto: t.oculto,
    categoria: t.categoria,
    tipo: evento.event_type,
    frase: t.frase,
    objeto_tipo: OBJETO[evento.object_type] ?? evento.object_type?.toLowerCase() ?? null,
    objeto_id: evento.object_id != null ? String(evento.object_id) : null,
    objeto_nome: evento.object_name ?? null,
    campanha_id: campanha.campanhaId ?? null,
    campanha_nome: campanha.campanhaNome ?? null,
    dados: JSON.stringify(evento),
  };
}

const COLUNAS = [
  'conta_id', 'conta_anuncio_id', 'chave', 'ocorrida_em', 'autor_id', 'autor_nome', 'aplicacao', 'gestor_id',
  'sistema', 'oculto', 'categoria', 'tipo', 'frase', 'objeto_tipo', 'objeto_id', 'objeto_nome',
  'campanha_id', 'campanha_nome', 'dados',
];

async function gravarLinhas(linhas) {
  for (let inicio = 0; inicio < linhas.length; inicio += LINHAS_POR_INSERT) {
    const lote = linhas.slice(inicio, inicio + LINHAS_POR_INSERT);
    const valores = [];
    const placeholders = lote.map((linha, li) => {
      valores.push(...COLUNAS.map((c) => linha[c]));
      return `(${COLUNAS.map((_, ci) => `$${li * COLUNAS.length + ci + 1}`).join(', ')})`;
    });
    // Em conflito, atualiza o que a tradução ou o vínculo podem ter mudado —
    // reprocessar com um dicionário melhor corrige o histórico já gravado.
    await query(
      `INSERT INTO alteracoes_conta (${COLUNAS.join(', ')})
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (chave) DO UPDATE SET
         frase = EXCLUDED.frase, categoria = EXCLUDED.categoria, oculto = EXCLUDED.oculto,
         sistema = EXCLUDED.sistema, objeto_tipo = EXCLUDED.objeto_tipo,
         campanha_id = COALESCE(EXCLUDED.campanha_id, alteracoes_conta.campanha_id),
         campanha_nome = COALESCE(EXCLUDED.campanha_nome, alteracoes_conta.campanha_nome),
         gestor_id = COALESCE(alteracoes_conta.gestor_id, EXCLUDED.gestor_id)`,
      valores
    );
  }
}

/**
 * Coleta e grava as alterações de uma conta num intervalo de datas (inclusivo).
 * @param {string} contaId - ObjectId da Conta
 * @param {{ since: string, until: string }} intervalo - 'YYYY-MM-DD'
 */
export async function coletarAlteracoesConta(contaId, { since, until }) {
  const conta = await Conta.findById(contaId);
  if (!conta) throw new ErroNaoEncontrado(`Conta ${contaId} não encontrada`);
  const token = conta.metaConfig?.systemUserToken || undefined;

  const [gestores, campanhas] = await Promise.all([
    Gestor.find({ ativo: true }).select('nome metaAtores').lean(),
    mapaCampanhas(conta._id),
  ]);

  let eventos = 0;
  let falhas = 0;
  for (const contaAnuncioId of conta.metaConfig?.contasAnuncioIds ?? []) {
    try {
      const brutos = await listarAtividadesConta(contaAnuncioId, { since, until, token });
      const linhas = brutos.map((e) => montarLinha(conta, contaAnuncioId, e, gestores, campanhas));
      await gravarLinhas(linhas);
      eventos += linhas.length;
    } catch (erro) {
      falhas++;
      logger.error({ msg: 'Falha ao coletar alterações — pulando conta de anúncio', contaId: String(contaId), contaAnuncioId, since, until, erro: erro.message });
    }
  }

  logger.info({ msg: 'Coleta de alterações concluída', contaId: String(contaId), since, until, eventos, falhas });
  return { eventos, falhas };
}

/**
 * Vincula um autor da Meta a um gestor e reatribui o histórico já gravado.
 * @returns {Promise<number>} linhas reatribuídas
 */
export async function vincularAutorAoGestor(gestorId, autorId, autorNome) {
  const gestor = await Gestor.findById(gestorId);
  if (!gestor) throw new ErroNaoEncontrado('Gestor não encontrado');

  // Um autor pertence a um gestor só: remove de qualquer outro antes.
  await Gestor.updateMany({ _id: { $ne: gestor._id } }, { $pull: { metaAtores: { id: String(autorId) } } });
  if (!gestor.metaAtores.some((a) => a.id === String(autorId))) {
    gestor.metaAtores.push({ id: String(autorId), nome: autorNome ?? '' });
    await gestor.save();
  }

  const r = await query(
    `UPDATE alteracoes_conta SET gestor_id = $1 WHERE autor_id = $2 AND sistema = false AND gestor_id IS DISTINCT FROM $1`,
    [String(gestor._id), String(autorId)]
  );
  return r.rowCount;
}
