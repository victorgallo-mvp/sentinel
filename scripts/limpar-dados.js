/**
 * Roda a limpeza de dados antigos agora, sem esperar o cron das 03:00, e
 * opcionalmente compacta a tabela de métricas em disco.
 *
 * A limpeza normal (DELETE + VACUUM ANALYZE) libera espaço para o próprio
 * Postgres reusar, mas o arquivo em disco não encolhe — e é o tamanho em disco
 * que a Supabase cobra. `--vacuum-full` reescreve a tabela do zero: precisa de
 * espaço livre equivalente ao tamanho final e trava a tabela enquanto roda
 * (minutos, para alguns GB). Rode fora do horário de uso.
 *
 * Uso: npm run limpar-dados -- [--vacuum-full]
 */
import { executarScript } from './_contexto.js';
import { conectarMongo } from '../src/infra/mongo.js';
import { executarLimpezaDadosAntigos } from '../src/jobs/limpeza-dados-antigos.job.js';
import { query } from '../src/infra/postgres.js';

async function tamanho() {
  const r = await query(`SELECT pg_size_pretty(pg_total_relation_size('metricas_serie_temporal')) AS t, (SELECT count(*) FROM metricas_serie_temporal)::int AS n`);
  return `${r.rows[0].t} em ${r.rows[0].n.toLocaleString('pt-BR')} linhas`;
}

async function main() {
  await conectarMongo(); // a limpeza também apaga registros antigos do Mongo
  console.log(`Antes:  ${await tamanho()}`);
  await executarLimpezaDadosAntigos();
  console.log(`Depois: ${await tamanho()} (espaço liberado para reuso; o arquivo em disco só encolhe com --vacuum-full)`);

  if (process.argv.includes('--vacuum-full')) {
    console.log('VACUUM FULL metricas_serie_temporal — pode levar alguns minutos…');
    const inicio = Date.now();
    await query('VACUUM FULL ANALYZE metricas_serie_temporal');
    console.log(`Compactada em ${Math.round((Date.now() - inicio) / 1000)}s: ${await tamanho()}`);
  }
}

executarScript(main);
