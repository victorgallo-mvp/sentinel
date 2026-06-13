/**
 * Faz o backfill de histórico de métricas (janela 24h, granularidade diária)
 * para cada entidade monitorada da conta padrão. Necessário pra que
 * `calcularBaselinesConta` tenha o mínimo de observações antes de a
 * detecção de anomalias começar a rodar de verdade.
 *
 * Limitação conhecida: popula apenas a janela 24h (granularidade diária).
 * As janelas 1h/6h vão sendo preenchidas naturalmente pela coleta horária
 * (`coleta-metricas.job.js`) a partir de agora.
 *
 * Uso: npm run popular-historico -- --dias=21
 */
import { obterContaPadrao, executarScript } from './_contexto.js';
import { Entidade } from '../src/dominio/entidade.modelo.js';
import { obterInsights } from '../src/core/coleta/meta-api.cliente.js';
import { normalizarLinhaInsight } from '../src/core/coleta/normalizador.js';
import { persistirMetricas } from '../src/core/coleta/coletor-metricas.servico.js';
import { DIAS_HISTORICO_BASELINE_PADRAO } from '../src/config/thresholds-padrao.js';
import { aguardar } from '../src/shared/utils.js';

const PAUSA_ENTRE_ENTIDADES_MS = 300; // evita rajadas contra o rate limit da Meta API

function obterArgumentoDias() {
  const arg = process.argv.find((a) => a.startsWith('--dias='));
  return arg ? Number(arg.split('=')[1]) : DIAS_HISTORICO_BASELINE_PADRAO;
}

function formatarData(data) {
  return data.toISOString().slice(0, 10);
}

async function main() {
  const conta = await obterContaPadrao();
  const dias = obterArgumentoDias();

  const ate = new Date();
  ate.setDate(ate.getDate() - 1); // até ontem — hoje ainda está sendo coletado pelo job horário

  const desde = new Date(ate);
  desde.setDate(desde.getDate() - (dias - 1));

  const timeRange = { since: formatarData(desde), until: formatarData(ate) };

  const entidades = await Entidade.find({ contaId: conta._id, 'configuracoes.monitorada': true });
  console.log(`Populando histórico de ${entidades.length} entidades — período ${timeRange.since} a ${timeRange.until}\n`);

  let totalLinhas = 0;

  for (const entidade of entidades) {
    try {
      const linhas = await obterInsights(entidade.tipo, entidade.metaId, { timeRange, timeIncrement: 1 });

      for (const linha of linhas) {
        const coletadaEm = new Date(`${linha.date_stop}T12:00:00Z`);
        await persistirMetricas(conta, entidade, normalizarLinhaInsight(linha), 24, coletadaEm);
        totalLinhas++;
      }

      console.log(`OK   ${entidade.tipo.padEnd(8)} ${entidade.nome} — ${linhas.length} dias`);
    } catch (erro) {
      console.error(`ERRO ${entidade.tipo.padEnd(8)} ${entidade.nome}: ${erro.message}`);
    }

    await aguardar(PAUSA_ENTRE_ENTIDADES_MS);
  }

  console.log(`\nConcluído — ${totalLinhas} linhas diárias persistidas.`);
  console.log('Agora calcule os baselines via POST /admin/disparar/baselines (ou aguarde o cron diário).');
}

executarScript(main);
