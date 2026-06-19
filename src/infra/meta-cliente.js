/**
 * Inicialização de baixo nível do SDK oficial da Meta
 * (`facebook-nodejs-business-sdk`). Expõe a API configurada com o
 * System User Token — usada pelo wrapper de alto nível em
 * `src/core/coleta/meta-api.cliente.js`.
 */
import bizSdk from 'facebook-nodejs-business-sdk';
import { config } from '../config/index.js';

const { FacebookAdsApi } = bizSdk;

/**
 * Inicializa a Meta Marketing API com o token fornecido.
 * Sempre reinicializa — sem singleton — pra suportar múltiplas contas
 * com tokens distintos. Workers BullMQ rodam com concurrency=1, então
 * não há race condition no estado global do SDK.
 *
 * @param {string} [token] - token da conta; usa META_SYSTEM_USER_TOKEN do .env se omitido
 */
export function obterApiMeta(token) {
  const accessToken = token || config.meta.systemUserToken;
  if (!accessToken) throw new Error('Token Meta não configurado');
  const api = FacebookAdsApi.init(accessToken);
  if (config.ambiente === 'development') api.setDebug(true);
  return api;
}

export { bizSdk };
