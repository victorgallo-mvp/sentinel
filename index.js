/**
 * Ponto de entrada da aplicação Sentinela Ads.
 *
 * Conecta aos bancos de dados, inicia o servidor HTTP (API admin, webhooks,
 * relatórios), os workers BullMQ e os jobs agendados (cron). Configura
 * shutdown gracioso em SIGTERM/SIGINT.
 */
import { conectarMongo, desconectarMongo } from './src/infra/mongo.js';
import { encerrarPostgres } from './src/infra/postgres.js';
import { encerrarRedis } from './src/infra/redis.js';
import { criarServidor } from './src/api/servidor.js';
import { iniciarOrquestrador, encerrarOrquestrador } from './src/jobs/orquestrador.js';
import { executarSincronizacaoEntidades } from './src/jobs/sincronizar-entidades.job.js';
import { config } from './src/config/index.js';
import { logger } from './src/infra/logger.js';

async function main() {
  await conectarMongo();

  const app = criarServidor();
  const servidorHttp = app.listen(config.porta, () => {
    logger.info({ msg: `Servidor HTTP escutando na porta ${config.porta}`, ambiente: config.ambiente });
  });

  const orquestrador = iniciarOrquestrador();

  // Sincroniza entidades logo no boot para puxar novas campanhas/adsets/ads
  // sem esperar pelo próximo cron (que roda a cada 2h)
  setImmediate(async () => {
    try {
      logger.info({ msg: 'Sync de entidades no startup' });
      await executarSincronizacaoEntidades();
      logger.info({ msg: 'Sync de entidades no startup concluído' });
    } catch (erro) {
      logger.error({ msg: 'Sync de entidades no startup falhou', erro: erro.message });
    }
  });

  let encerrando = false;
  const encerrar = async (sinal) => {
    if (encerrando) return;
    encerrando = true;

    logger.info({ msg: `Recebido ${sinal} — encerrando graciosamente...` });

    servidorHttp.close();
    await encerrarOrquestrador(orquestrador);
    await encerrarRedis();
    await encerrarPostgres();
    await desconectarMongo();

    process.exit(0);
  };

  process.on('SIGTERM', () => encerrar('SIGTERM'));
  process.on('SIGINT', () => encerrar('SIGINT'));
}

main().catch((erro) => {
  logger.error({ msg: 'Falha fatal ao iniciar a aplicação', erro: erro.message, stack: erro.stack });
  process.exit(1);
});
