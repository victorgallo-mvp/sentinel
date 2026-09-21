/**
 * Espelha a dimensão de entidades (nomes, hierarquia, status) do MongoDB na
 * tabela `entidades` do Postgres, para relatórios que consultam o banco direto.
 *
 * Roda sozinho no job `sincronizar-entidades` a cada 2h; este script serve para
 * forçar a atualização ou popular a tabela pela primeira vez.
 *
 * Uso: npm run sincronizar-dimensao
 */
import { conectarMongo } from '../src/infra/mongo.js';
import { executarScript } from './_contexto.js';
import { sincronizarDimensaoEntidades } from '../src/core/coleta/sincronizar-dimensao.servico.js';

async function main() {
  await conectarMongo();
  const { sincronizadas } = await sincronizarDimensaoEntidades();
  console.log(`${sincronizadas} entidade(s) espelhada(s) no Postgres.`);
}

executarScript(main);
