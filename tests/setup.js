/**
 * Setup global do Vitest — garante que `src/config/index.js` valide com
 * sucesso mesmo sem um `.env` real (necessário pra importar módulos que
 * dependem de `config`, mesmo em testes que não tocam banco/rede).
 */
process.env.MONGO_URI ??= 'mongodb://localhost:27017/sentinela-ads-test';
process.env.DATABASE_URL ??= 'postgresql://usuario:senha@localhost:5432/sentinela_ads_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.ANTHROPIC_API_KEY ??= 'sk-ant-test';
