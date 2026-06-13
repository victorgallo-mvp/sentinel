/**
 * Testa o agente investigador de ponta a ponta, de forma síncrona (sem
 * depender dos workers BullMQ rodando): cria (ou usa) uma anomalia, roda a
 * triagem (Haiku) e, se aprovada, roda a investigação completa (Sonnet com
 * tool use) — imprimindo diagnóstico, recomendação, tools chamadas e custo.
 *
 * Por padrão NÃO envia notificação via WhatsApp — use --notificar pra enviar.
 *
 * Uso: npm run testar-agente -- --metrica=spend --direcao=aumento --magnitude=5
 *      npm run testar-agente -- --anomalia=<anomaliaId> --notificar
 */
import { obterContaPadrao, executarScript } from './_contexto.js';
import { criarAnomaliaSimulada, lerArgumentos } from './_simulador.js';
import { triarAnomalia } from '../src/core/ia/triagem.servico.js';
import { investigarAnomalia } from '../src/core/agente/investigador.agente.js';
import { processarNotificacao } from '../src/core/notificacao/processador.servico.js';
import { Investigacao } from '../src/dominio/investigacao.modelo.js';

async function main() {
  const conta = await obterContaPadrao();
  const args = lerArgumentos();

  let anomaliaId = args.anomalia;

  if (!anomaliaId) {
    const { anomalia, entidade } = await criarAnomaliaSimulada(conta, {
      metaIdEntidade: args.entidade,
      metrica: args.metrica,
      direcao: args.direcao,
      magnitude: args.magnitude ? Number(args.magnitude) : undefined,
      janelaMedicao: args.janela,
    });
    anomaliaId = String(anomalia._id);
    console.log(`Anomalia simulada criada: ${anomaliaId} (${entidade.nome}, ${anomalia.metrica}, ${anomalia.magnitudeDesvios.toFixed(2)} desvios)\n`);
  }

  console.log('--- Triagem (Haiku) ---');
  const triagem = await triarAnomalia(anomaliaId);
  console.log(`merece: ${triagem.merece}`);
  console.log(`motivo: ${triagem.motivo}`);

  if (!triagem.merece) {
    console.log('\nTriagem decidiu que a anomalia NÃO merece investigação. Encerrando.');
    return;
  }

  console.log('\n--- Investigação (Sonnet, tool use) ---');
  const investigacaoId = await investigarAnomalia(anomaliaId);
  const investigacao = await Investigacao.findById(investigacaoId);

  console.log(`Iterações: ${investigacao.iteracoes}`);
  console.log(`Custo: US$ ${investigacao.custoTokensUsd.toFixed(4)} (${investigacao.modeloUsado})`);

  console.log(`\nTools chamadas:`);
  for (const t of investigacao.toolsChamadas) {
    console.log(`  [${t.iteracao}] ${t.nome} (${t.duracaoMs}ms)`);
  }

  console.log(`\nDiagnóstico:`);
  console.log(JSON.stringify(investigacao.diagnostico, null, 2));

  console.log(`\nDecidiu notificar: ${investigacao.decidiuNotificar}`);
  if (investigacao.decidiuNotificar) {
    console.log('Recomendação:');
    console.log(JSON.stringify(investigacao.recomendacao, null, 2));

    if (args.notificar !== undefined) {
      console.log('\n--- Enviando notificação via WhatsApp (--notificar) ---');
      await processarNotificacao(investigacaoId);
      console.log('Notificação processada.');
    } else {
      console.log('\n(Notificação NÃO enviada — use --notificar pra enviar de fato via WhatsApp)');
    }
  } else {
    console.log(`Motivo de não notificar: ${investigacao.motivoNaoNotificar}`);
  }
}

executarScript(main);
