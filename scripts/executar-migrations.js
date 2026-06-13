/**
 * Aplica as migrations SQL em `postgres/migrations/` em ordem, registrando
 * as já aplicadas em `schema_migrations` (idempotente — pode rodar
 * múltiplas vezes sem efeito colateral).
 *
 * Uso: npm run migrate
 */
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { obterPool, encerrarPostgres } from '../src/infra/postgres.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR_MIGRATIONS = path.resolve(__dirname, '../postgres/migrations');

async function main() {
  const pool = obterPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      nome TEXT PRIMARY KEY,
      aplicada_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const arquivos = (await readdir(DIR_MIGRATIONS)).filter((arquivo) => arquivo.endsWith('.sql')).sort();

  for (const arquivo of arquivos) {
    const { rows } = await pool.query('SELECT 1 FROM schema_migrations WHERE nome = $1', [arquivo]);

    if (rows.length > 0) {
      console.log(`- ${arquivo} (já aplicada)`);
      continue;
    }

    const sql = await readFile(path.join(DIR_MIGRATIONS, arquivo), 'utf-8');
    console.log(`> Aplicando ${arquivo}...`);
    await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations (nome) VALUES ($1)', [arquivo]);
    console.log(`  OK`);
  }

  console.log('\nMigrations concluídas.');
}

main()
  .then(async () => {
    await encerrarPostgres();
    process.exit(0);
  })
  .catch(async (erro) => {
    console.error(`\nErro ao executar migrations: ${erro.message}`);
    await encerrarPostgres();
    process.exit(1);
  });
