import { Conta } from '../dominio/conta.modelo.js';
import { sincronizarEntidades } from '../core/coleta/descobridor-entidades.servico.js';
import { logger } from '../infra/logger.js';
import { sincronizarDimensaoEntidades } from '../core/coleta/sincronizar-dimensao.servico.js';

/**
 * Redescobre campanhas/adsets/ads ativos de cada conta de anúncio e
 * sincroniza com o Mongo, criando `Entidade`s para campanhas novas ou
 * reativadas (monitoradas por padrão) e atualizando as existentes.
 */
export async function executarSincronizacaoEntidades() {
  const contas = await Conta.find({ ativo: true });
  logger.info({ msg: 'Iniciando job de sincronização de entidades', totalContas: contas.length });

  for (const conta of contas) {
    const { bmId, contasAnuncioIds } = conta.metaConfig;

    for (const contaAnuncioId of contasAnuncioIds) {
      try {
        const token = conta.metaConfig?.systemUserToken;
        const resultado = await sincronizarEntidades(String(conta._id), bmId, contaAnuncioId, { token });
        logger.info({ msg: 'Sincronização de entidades concluída', contaId: String(conta._id), contaAnuncioId, ...resultado });
      } catch (erro) {
        logger.error({ msg: 'Falha na sincronização de entidades — seguindo com as demais', contaId: String(conta._id), contaAnuncioId, erro: erro.message });
      }
    }
  }

  // Espelha nomes e hierarquia no Postgres, para relatórios que consultam o
  // banco direto conseguirem agrupar por campanha sem passar pelo MongoDB.
  try {
    await sincronizarDimensaoEntidades();
  } catch (erro) {
    logger.error({ msg: 'Falha ao sincronizar a dimensão de entidades no Postgres', erro: erro.message });
  }
}
