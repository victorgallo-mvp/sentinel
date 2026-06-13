/**
 * Cria uma anomalia sintética e a enfileira para triagem — útil pra testar
 * o pipeline completo (triagem → investigação → notificação) sem esperar
 * um desvio real ser detectado. Requer os workers rodando (`npm start`)
 * pra processar a fila.
 *
 * Uso: npm run simular-anomalia -- --metrica=spend --direcao=aumento --magnitude=4
 *      npm run simular-anomalia -- --entidade=<metaId> --metrica=ctr --direcao=queda
 */
import { obterContaPadrao, executarScript } from './_contexto.js';
import { criarAnomaliaSimulada, lerArgumentos } from './_simulador.js';
import { adicionarJob, FILAS } from '../src/infra/fila.js';

async function main() {
  const conta = await obterContaPadrao();
  const args = lerArgumentos();

  const { anomalia, entidade } = await criarAnomaliaSimulada(conta, {
    metaIdEntidade: args.entidade,
    metrica: args.metrica,
    direcao: args.direcao,
    magnitude: args.magnitude ? Number(args.magnitude) : undefined,
    janelaMedicao: args.janela,
  });

  await adicionarJob(FILAS.TRIAGEM, 'triagem', { anomaliaId: String(anomalia._id) });

  console.log('Anomalia simulada criada e enfileirada para triagem:');
  console.log(`  anomaliaId:  ${anomalia._id}`);
  console.log(`  entidade:    ${entidade.nome} (${entidade.tipo})`);
  console.log(`  métrica:     ${anomalia.metrica}`);
  console.log(`  direção:     ${anomalia.direcao}`);
  console.log(`  valor atual: ${anomalia.valorAtual.toFixed(4)}`);
  console.log(`  baseline:    ${anomalia.baselineMedia.toFixed(4)} ± ${anomalia.baselineDesvio.toFixed(4)}`);
  console.log(`  magnitude:   ${anomalia.magnitudeDesvios.toFixed(2)} desvios padrão`);
  console.log('\nAcompanhe o processamento nos logs do worker (npm start) ou via GET /admin/anomalias.');
}

executarScript(main);
