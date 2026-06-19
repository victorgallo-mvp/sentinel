/**
 * Serviço de descoberta de entidades — lista BMs, contas de anúncio,
 * campanhas, adsets e ads acessíveis com o token configurado, e
 * sincroniza essa hierarquia com a coleção `entidades` no MongoDB.
 *
 * Usado pelo script `descobrir-recursos.js` (modo leitura) e por
 * `configurar-conta.js` (modo sincronização/persistência).
 */
import { listarContasAnuncio, listarCampanhas, listarAdsets, listarAds } from './meta-api.cliente.js';
import { Entidade } from '../../dominio/entidade.modelo.js';
import { logger } from '../../infra/logger.js';

/**
 * Retorna a árvore completa (campanhas > adsets > ads) de uma conta de anúncio,
 * sem persistir nada — usado para exibição em `descobrir-recursos.js`.
 */
export async function descobrirHierarquiaConta(contaAnuncioId, { apenasAtivos = true, token } = {}) {
  const campanhas = await listarCampanhas(contaAnuncioId, { apenasAtivas: apenasAtivos, token });

  const arvore = [];
  for (const campanha of campanhas) {
    const adsets = await listarAdsets(campanha.id, { apenasAtivos, token });
    const adsetsComAds = [];

    for (const adset of adsets) {
      const ads = await listarAds(adset.id, { apenasAtivos, token });
      adsetsComAds.push({ ...adset, ads });
    }

    arvore.push({ ...campanha, adsets: adsetsComAds });
  }

  return arvore;
}

/** Lista as contas de anúncio acessíveis na BM configurada. */
export async function descobrirContasAnuncio(bmId, token) {
  return listarContasAnuncio(bmId, token);
}

/**
 * Sincroniza a hierarquia de uma conta de anúncio com o MongoDB,
 * criando/atualizando documentos `Entidade` (campaign, adset, ad).
 * Novas entidades são criadas com `configuracoes.monitorada = true` por padrão.
 *
 * @param {string} contaId - ObjectId da Conta (MongoDB)
 * @param {string} bmId
 * @param {string} contaAnuncioId - `act_<id>`
 * @returns {Promise<{criadas: number, atualizadas: number, total: number}>}
 */
export async function sincronizarEntidades(contaId, bmId, contaAnuncioId, { apenasAtivos = true, token } = {}) {
  const arvore = await descobrirHierarquiaConta(contaAnuncioId, { apenasAtivos, token });

  let criadas = 0;
  let atualizadas = 0;

  for (const campanha of arvore) {
    const { criada: criadaCampanha } = await upsertEntidade(contaId, {
      tipo: 'campaign',
      metaId: campanha.id,
      nome: campanha.nome,
      hierarquia: { bmId, contaAnuncioId, campanhaId: campanha.id, adsetId: null },
      objetivo: campanha.objetivo,
      status: campanha.statusEfetivo ?? campanha.status,
    });
    criadaCampanha ? criadas++ : atualizadas++;

    for (const adset of campanha.adsets) {
      const { criada: criadaAdset } = await upsertEntidade(contaId, {
        tipo: 'adset',
        metaId: adset.id,
        nome: adset.nome,
        hierarquia: { bmId, contaAnuncioId, campanhaId: campanha.id, adsetId: adset.id },
        objetivo: campanha.objetivo,
        status: adset.statusEfetivo ?? adset.status,
      });
      criadaAdset ? criadas++ : atualizadas++;

      for (const ad of adset.ads) {
        const { criada: criadaAd } = await upsertEntidade(contaId, {
          tipo: 'ad',
          metaId: ad.id,
          nome: ad.nome,
          hierarquia: { bmId, contaAnuncioId, campanhaId: campanha.id, adsetId: adset.id },
          objetivo: campanha.objetivo,
          status: ad.statusEfetivo ?? ad.status,
        });
        criadaAd ? criadas++ : atualizadas++;
      }
    }
  }

  const total = criadas + atualizadas;
  logger.info({ msg: 'Sincronização de entidades concluída', contaAnuncioId, criadas, atualizadas, total });
  return { criadas, atualizadas, total };
}

async function upsertEntidade(contaId, dados) {
  const existente = await Entidade.findOne({ contaId, metaId: dados.metaId, tipo: dados.tipo });

  if (existente) {
    existente.nome = dados.nome;
    existente.status = dados.status;
    existente.objetivo = dados.objetivo;
    existente.hierarquia = dados.hierarquia;
    await existente.save();
    return { criada: false, entidade: existente };
  }

  const nova = await Entidade.create({
    contaId,
    tipo: dados.tipo,
    metaId: dados.metaId,
    nome: dados.nome,
    hierarquia: dados.hierarquia,
    objetivo: dados.objetivo,
    status: dados.status,
    configuracoes: { monitorada: true, sensibilidadeCustom: null, metricasIgnoradas: [] },
  });

  return { criada: true, entidade: nova };
}
