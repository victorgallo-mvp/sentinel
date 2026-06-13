/**
 * Job de relatório semanal — cron enfileira um job por conta ativa na fila
 * `RELATORIO`; o worker gera o relatório (agente + HTML + Sheets) e envia
 * o resumo via WhatsApp.
 */
import { Conta } from '../dominio/conta.modelo.js';
import { FILAS, criarWorker, adicionarJob } from '../infra/fila.js';
import { gerarRelatorioSemanal, enviarRelatorioWhatsapp } from '../core/relatorio/gerador-semanal.servico.js';
import { logger } from '../infra/logger.js';

/** Enfileira a geração do relatório semanal para todas as contas ativas. */
export async function enfileirarRelatoriosSemanais() {
  const contas = await Conta.find({ ativo: true });
  logger.info({ msg: 'Enfileirando relatórios semanais', totalContas: contas.length });

  for (const conta of contas) {
    await adicionarJob(FILAS.RELATORIO, 'relatorio-semanal', { contaId: String(conta._id) });
  }
}

/** Cria o worker que processa a fila `RELATORIO`. */
export function criarWorkerRelatorio() {
  return criarWorker(FILAS.RELATORIO, async (job) => {
    const { contaId } = job.data;

    const relatorio = await gerarRelatorioSemanal(contaId);

    const conta = await Conta.findById(contaId);
    try {
      await enviarRelatorioWhatsapp(relatorio, conta);
    } catch (erro) {
      logger.error({ msg: 'Relatório gerado mas falhou ao enviar via WhatsApp', contaId, relatorioId: String(relatorio._id), erro: erro.message });
    }

    return { relatorioId: String(relatorio._id) };
  });
}
