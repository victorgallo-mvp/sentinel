/**
 * Espelha a coleção `entidades` do MongoDB na tabela `entidades` do Postgres.
 *
 * `metricas_serie_temporal` guarda apenas `entidade_id`. Sem esta dimensão,
 * quem consulta o Postgres direto — relatórios, BI, agentes de IA — não
 * consegue dizer de que campanha é cada linha, e nada pode ser agrupado por
 * nome. Com ela, basta um JOIN por `entidade_id`.
 *
 * Idempotente: é um upsert do estado atual, seguro de rodar quantas vezes for.
 */
import { Entidade } from '../../dominio/entidade.modelo.js';
import { Conta } from '../../dominio/conta.modelo.js';
import { query } from '../../infra/postgres.js';
import { logger } from '../../infra/logger.js';

const TAMANHO_LOTE = 500;

/**
 * @param {Object} [opcoes]
 * @param {import('mongoose').Types.ObjectId} [opcoes.contaId] - limita a uma conta
 * @returns {Promise<{sincronizadas: number}>}
 */
export async function sincronizarDimensaoEntidades({ contaId } = {}) {
  const filtroConta = contaId ? { _id: contaId } : { ativo: true };
  const contas = await Conta.find(filtroConta).select('identificador nome').lean();
  const nomePorConta = new Map(contas.map((c) => [String(c._id), c]));
  if (!contas.length) return { sincronizadas: 0 };

  const entidades = await Entidade.find({ contaId: { $in: contas.map((c) => c._id) } }).lean();
  let sincronizadas = 0;

  for (let i = 0; i < entidades.length; i += TAMANHO_LOTE) {
    const lote = entidades.slice(i, i + TAMANHO_LOTE);
    const valores = [];
    const placeholders = [];
    let p = 1;

    for (const e of lote) {
      const conta = nomePorConta.get(String(e.contaId));
      if (!conta) continue; // entidade de conta inativa ou removida
      placeholders.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, now())`);
      valores.push(
        String(e._id), conta.identificador, conta.nome, e.tipo, e.nome ?? '(sem nome)',
        e.metaId ?? null, e.hierarquia?.contaAnuncioId ?? null,
        e.hierarquia?.campanhaId ?? null, e.hierarquia?.adsetId ?? null,
        e.objetivo ?? null, e.optimizationGoal ?? null, e.status ?? null,
        Boolean(e.configuracoes?.monitorada)
      );
    }
    if (!placeholders.length) continue;

    await query(
      `INSERT INTO entidades
         (entidade_id, conta_id, conta_nome, entidade_tipo, nome, meta_id, conta_anuncio_id,
          campanha_meta_id, adset_meta_id, objetivo, optimization_goal, status, monitorada, atualizada_em)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (entidade_id) DO UPDATE SET
         conta_id = EXCLUDED.conta_id,
         conta_nome = EXCLUDED.conta_nome,
         entidade_tipo = EXCLUDED.entidade_tipo,
         nome = EXCLUDED.nome,
         meta_id = EXCLUDED.meta_id,
         conta_anuncio_id = EXCLUDED.conta_anuncio_id,
         campanha_meta_id = EXCLUDED.campanha_meta_id,
         adset_meta_id = EXCLUDED.adset_meta_id,
         objetivo = EXCLUDED.objetivo,
         optimization_goal = EXCLUDED.optimization_goal,
         status = EXCLUDED.status,
         monitorada = EXCLUDED.monitorada,
         atualizada_em = now()`,
      valores
    );
    sincronizadas += placeholders.length;
  }

  // Linhas do nível conta: existem em metricas_serie_temporal (entidade_id =
  // act_...) mas não na coleção `entidades` do MongoDB, porque não são
  // entidades monitoradas. Entram aqui para o JOIN dos relatórios funcionar.
  const linhasConta = [];
  const valoresConta = [];
  let q = 1;
  for (const conta of contas) {
    const doc = await Conta.findById(conta._id).select('identificador nome metaConfig.contasAnuncioIds').lean();
    for (const act of doc?.metaConfig?.contasAnuncioIds ?? []) {
      linhasConta.push(`($${q++}, $${q++}, $${q++}, 'account', $${q++}, $${q++}, $${q++}, NULL, NULL, NULL, NULL, NULL, true, now())`);
      valoresConta.push(act, doc.identificador, doc.nome, `${doc.nome} (conta de anúncio)`, act, act);
    }
  }
  if (linhasConta.length) {
    await query(
      `INSERT INTO entidades
         (entidade_id, conta_id, conta_nome, entidade_tipo, nome, meta_id, conta_anuncio_id,
          campanha_meta_id, adset_meta_id, objetivo, optimization_goal, status, monitorada, atualizada_em)
       VALUES ${linhasConta.join(', ')}
       ON CONFLICT (entidade_id) DO UPDATE SET
         conta_id = EXCLUDED.conta_id, conta_nome = EXCLUDED.conta_nome,
         nome = EXCLUDED.nome, atualizada_em = now()`,
      valoresConta
    );
    sincronizadas += linhasConta.length;
  }

  logger.info({ msg: 'Dimensão de entidades sincronizada', sincronizadas, niveisConta: linhasConta.length });
  return { sincronizadas };
}
