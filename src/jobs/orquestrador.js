/**
 * Orquestrador — agenda os jobs periódicos (node-cron) e inicializa os
 * workers BullMQ que consomem as filas de investigação e relatório.
 *
 * Cron (horário do servidor):
 * - Health check Evolution API: a cada 5 minutos
 * - Coleta diária: 03:00 BRT — única coleta de métricas (fechamento de 7 dias + agregados de período)
 * - Coleta de alterações: diariamente às 05:00 BRT (histórico de alterações das contas, últimos 3 dias)
 * - Alerta de saldo de orçamento: a cada hora, no minuto 10 (após coleta)
 * - Alerta de erros de entrega (issues_info): a cada hora, no minuto 15
 * - Detecção de anomalias: a cada 2 horas, no minuto 20 (após a coleta)
 * - Sincronização de entidades: a cada 2 horas (minuto 30)
 * - Atualização de baselines: diariamente às 02:00
 * - Resumo de período WhatsApp: segunda 08:00 (cobre qui-dom) e quinta 08:00 (cobre seg-qua)
 * - Relatório semanal IA: segundas-feiras às 08:00
 * - Limpeza de dados antigos: diariamente às 03:00
 */
import cron from 'node-cron';
import { executarColetaDiaria } from './coleta-diaria.job.js';
import { executarColetaAlteracoes } from './coleta-alteracoes.job.js';
import { executarDeteccaoAnomalias } from './deteccao-anomalias.job.js';
import { executarSincronizacaoEntidades } from './sincronizar-entidades.job.js';
import { executarAtualizacaoBaselines } from './atualizar-baselines.job.js';
import { enfileirarRelatoriosSemanais, criarWorkerRelatorio } from './relatorio-semanal.job.js';
import { executarLimpezaDadosAntigos } from './limpeza-dados-antigos.job.js';
import { executarAlertaFimDeSemana } from '../core/alertas/alerta-fim-semana.servico.js';
import { executarTriagemPerformance } from '../core/analise/triagem-performance.servico.js';
import { executarAlertaOrcamento } from './alerta-orcamento.job.js';
import { executarAlertaEntrega } from './alerta-entrega.job.js';
import { executarAlertaPerformance } from './alerta-performance.job.js';
import { executarResumoDiario } from './resumo-diario.job.js';
import { criarWorkersInvestigacao } from './investigacao.job.js';
import { verificarSaudeEvolution } from './health-check-evolution.job.js';
import { config } from '../config/index.js';
import { logger } from '../infra/logger.js';

// `requerIA: true` marca tarefas que dependem do pipeline Anthropic — só são
// agendadas quando IA_INVESTIGACAO_ATIVA está ligado.
const TAREFAS_CRON = [
  { nome: 'health-check-evolution', expressao: '*/5 * * * *', executar: verificarSaudeEvolution },
  // A única coleta de métricas: relê os últimos 7 dias com o valor final da
  // Meta (a atribuição ainda muda por alguns dias) e os agregados de período.
  // 03:00 BRT dá tempo de a Meta fechar o dia anterior.
  { nome: 'coleta-diaria', expressao: '0 3 * * *', executar: executarColetaDiaria, timezone: 'America/Sao_Paulo' },
  // Registro de alterações: quem fez o quê nas contas. Relê 3 dias por folga.
  { nome: 'coleta-alteracoes', expressao: '0 5 * * *', executar: executarColetaAlteracoes, timezone: 'America/Sao_Paulo' },
  { nome: 'alerta-orcamento', expressao: '10 * * * *', executar: executarAlertaOrcamento },
  { nome: 'alerta-entrega', expressao: '15 * * * *', executar: executarAlertaEntrega },
  { nome: 'deteccao-anomalias', expressao: '20 */2 * * *', executar: executarDeteccaoAnomalias, requerIA: true },
  { nome: 'alerta-performance', expressao: '25 * * * *', executar: executarAlertaPerformance },
  { nome: 'sincronizar-entidades', expressao: '30 */2 * * *', executar: executarSincronizacaoEntidades },
  { nome: 'atualizar-baselines', expressao: '0 2 * * *', executar: executarAtualizacaoBaselines },
  { nome: 'resumo-diario', expressao: '0 8 * * 1,4', executar: executarResumoDiario },
  { nome: 'relatorio-semanal', expressao: '0 8 * * 1', executar: enfileirarRelatoriosSemanais, requerIA: true },
  // Triagem de performance: a cada 3 dias, de manhã. Uma chamada por conta,
  // modelo barato — a leitura fica no banco e o dashboard lê de lá.
  { nome: 'triagem-performance', expressao: '0 7 */3 * *', executar: executarTriagemPerformance, timezone: 'America/Sao_Paulo' },
  // Sexta ao meio-dia (BRT): margem para recarregar em horário bancário.
  { nome: 'alerta-fim-semana', expressao: '0 12 * * 5', executar: executarAlertaFimDeSemana, timezone: 'America/Sao_Paulo' },
  { nome: 'limpeza-dados-antigos', expressao: '0 3 * * *', executar: executarLimpezaDadosAntigos },
];

/**
 * Inicia os workers BullMQ e agenda as tarefas cron.
 * @returns {{ workers: Array, tarefasCron: Array }} referências para shutdown gracioso
 */
export function iniciarOrquestrador() {
  const iaAtiva = config.iaInvestigacaoAtiva;

  // Pipeline de IA opcional (controlado por IA_INVESTIGACAO_ATIVA): quando desligado,
  // não sobe os workers de investigação/relatório nem agenda os jobs que chamam a
  // Anthropic — o sistema roda só com os alertas determinísticos, sem custo de IA.
  // `atualizar-baselines` segue rodando (só SQL), então religar a IA é só trocar a env.
  const workers = iaAtiva ? [...criarWorkersInvestigacao(), criarWorkerRelatorio()] : [];

  const tarefasCron = TAREFAS_CRON
    .filter(({ requerIA }) => iaAtiva || !requerIA)
    .map(({ nome, expressao, executar, timezone }) =>
      // `timezone` é opcional: sem ele o node-cron usa o fuso do servidor (UTC no
      // Railway), que é como os jobs antigos sempre rodaram. Jobs cujo horário
      // importa para quem recebe a mensagem declaram o fuso explicitamente.
      cron.schedule(expressao, async () => {
        logger.info({ msg: 'Executando job agendado', job: nome });
        try {
          await executar();
        } catch (erro) {
          logger.error({ msg: 'Job agendado falhou', job: nome, erro: erro.message });
        }
      }, timezone ? { timezone } : undefined)
    );

  if (!iaAtiva) {
    logger.warn({ msg: 'Pipeline de IA desativado (IA_INVESTIGACAO_ATIVA=false) — rodando só alertas por regra' });
  }
  logger.info({ msg: 'Orquestrador iniciado', iaAtiva, totalWorkers: workers.length, totalTarefasCron: tarefasCron.length });

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
