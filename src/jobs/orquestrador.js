/**
 * Orquestrador — agenda os jobs periódicos (node-cron) e inicializa os
 * workers BullMQ que consomem as filas de investigação e relatório.
 *
 * Cron (horário do servidor):
 * - Coleta de métricas: a cada hora, no minuto 5
 * - Alerta de saldo de orçamento: a cada hora, no minuto 10 (após coleta)
 * - Alerta de erros de entrega (issues_info): a cada hora, no minuto 15
 * - Detecção de anomalias: a cada hora, no minuto 20 (após a coleta)
 * - Sincronização de entidades: diariamente às 01:00 (antes dos baselines)
 * - Atualização de baselines: diariamente às 02:00
 * - Resumo diário WhatsApp: todos os dias às 08:00
 * - Relatório semanal IA: segundas-feiras às 08:00
 * - Limpeza de dados antigos: diariamente às 03:00
 */
import cron from 'node-cron';
import { executarColetaMetricas } from './coleta-metricas.job.js';
import { executarDeteccaoAnomalias } from './deteccao-anomalias.job.js';
import { executarSincronizacaoEntidades } from './sincronizar-entidades.job.js';
import { executarAtualizacaoBaselines } from './atualizar-baselines.job.js';
import { enfileirarRelatoriosSemanais, criarWorkerRelatorio } from './relatorio-semanal.job.js';
import { executarLimpezaDadosAntigos } from './limpeza-dados-antigos.job.js';
import { executarAlertaOrcamento } from './alerta-orcamento.job.js';
import { executarAlertaEntrega } from './alerta-entrega.job.js';
import { executarAlertaPerformance } from './alerta-performance.job.js';
import { executarResumoDiario } from './resumo-diario.job.js';
import { criarWorkersInvestigacao } from './investigacao.job.js';
import { logger } from '../infra/logger.js';

const TAREFAS_CRON = [
  { nome: 'coleta-metricas', expressao: '5 * * * *', executar: executarColetaMetricas },
  { nome: 'alerta-orcamento', expressao: '10 * * * *', executar: executarAlertaOrcamento },
  { nome: 'alerta-entrega', expressao: '15 * * * *', executar: executarAlertaEntrega },
  { nome: 'deteccao-anomalias', expressao: '20 * * * *', executar: executarDeteccaoAnomalias },
  { nome: 'alerta-performance', expressao: '25 * * * *', executar: executarAlertaPerformance },
  { nome: 'sincronizar-entidades', expressao: '0 1 * * *', executar: executarSincronizacaoEntidades },
  { nome: 'atualizar-baselines', expressao: '0 2 * * *', executar: executarAtualizacaoBaselines },
  { nome: 'resumo-diario', expressao: '0 8 * * *', executar: executarResumoDiario },
  { nome: 'relatorio-semanal', expressao: '0 8 * * 1', executar: enfileirarRelatoriosSemanais },
  { nome: 'limpeza-dados-antigos', expressao: '0 3 * * *', executar: executarLimpezaDadosAntigos },
];

/**
 * Inicia os workers BullMQ e agenda as tarefas cron.
 * @returns {{ workers: Array, tarefasCron: Array }} referências para shutdown gracioso
 */
export function iniciarOrquestrador() {
  const workers = [...criarWorkersInvestigacao(), criarWorkerRelatorio()];

  const tarefasCron = TAREFAS_CRON.map(({ nome, expressao, executar }) =>
    cron.schedule(expressao, async () => {
      logger.info({ msg: 'Executando job agendado', job: nome });
      try {
        await executar();
      } catch (erro) {
        logger.error({ msg: 'Job agendado falhou', job: nome, erro: erro.message });
      }
    })
  );

  logger.info({ msg: 'Orquestrador iniciado', totalWorkers: workers.length, totalTarefasCron: tarefasCron.length });

  return { workers, tarefasCron };
}

/** Para todos os workers e tarefas cron — usado em shutdown gracioso. */
export async function encerrarOrquestrador({ workers, tarefasCron }) {
  for (const tarefa of tarefasCron) {
    tarefa.stop();
  }
  for (const worker of workers) {
    await worker.close();
  }
  logger.info({ msg: 'Orquestrador encerrado' });
}
