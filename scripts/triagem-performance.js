/**
 * Roda a triagem de performance sob demanda.
 *
 * Uso:
 *   npm run triagem                          # todas as contas, grava
 *   npm run triagem -- --conta=alemao-performance
 *   npm run triagem -- --ensaio              # não grava, só mostra
 */
import { conectarMongo } from '../src/infra/mongo.js';
import { executarScript } from './_contexto.js';
import { executarTriagemPerformance } from '../src/core/analise/triagem-performance.servico.js';

async function main() {
  await conectarMongo();
  const arg = (nome) => process.argv.find((a) => a.startsWith(`--${nome}=`))?.split('=')[1];
  const ensaio = process.argv.includes('--ensaio');

  const { analisadas, custoTotalUsd, resultados } = await executarTriagemPerformance({
    identificador: arg('conta'),
    persistir: !ensaio,
  });

  for (const a of resultados ?? []) {
    console.log(`\n=== ${a.conta} === [${a.situacao}]`);
    console.log(`  ${a.resumo}`);
    for (const f of a.fatores) console.log(`   - ${f}`);
    if (a.acao) console.log(`  Ação: ${a.acao}`);
  }
  console.log(`\n${analisadas} conta(s) analisada(s). Custo: US$${custoTotalUsd.toFixed(4)}${ensaio ? ' (ensaio — nada gravado)' : ''}`);
}

executarScript(main);
