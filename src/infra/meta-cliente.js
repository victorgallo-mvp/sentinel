/**
 * Inicialização de baixo nível do SDK oficial da Meta
 * (`facebook-nodejs-business-sdk`). Expõe a API configurada com o
 * System User Token — usada pelo wrapper de alto nível em
 * `src/core/coleta/meta-api.cliente.js`.
 */
import bizSdk from 'facebook-nodejs-business-sdk';
import { config } from '../config/index.js';
import { logger } from './logger.js';

const { FacebookAdsApi } = bizSdk;

let apiInicializada = null;

/**
 * Retorna a instância da Meta Marketing API configurada com o token do
 * System User. Idempotente — inicializa apenas uma vez.
 */
export function obterApiMeta() {
  if (!apiInicializada) {
    if (!config.meta.systemUserToken) {
      throw new Error('META_SYSTEM_USER_TOKEN não configurado');
    }

    apiInicializada = FacebookAdsApi.init(config.meta.systemUserToken);

    // Em desenvolvimento, habilita modo debug pra ver requests/responses
    if (config.ambiente === 'development') {
      apiInicializada.setDebug(true);
    }

    logger.info({ msg: 'Meta Marketing API inicializada', versao: config.meta.apiVersion });
  }

  return apiInicializada;
}

export { bizSdk };
