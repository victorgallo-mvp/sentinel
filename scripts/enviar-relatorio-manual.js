/**
 * Gera o relatório semanal da conta padrão imediatamente e envia via
 * WhatsApp — útil pra testar o template/conteúdo sem esperar o cron de
 * segunda-feira.
 *
 * Uso: npm run enviar-relatorio-manual
 *      npm run enviar-relatorio-manual -- --dias=7
 */
import { obterContaPadrao, executarScript } from './_contexto.js';
import { lerArgumentos } from './_simulador.js';
import { gerarRelatorioSemanal, enviarRelatorioWhatsapp } from '../src/core/relatorio/gerador-semanal.servico.js';

async function main() {
  const conta = await obterContaPadrao();
  const args = lerArgumentos();

  const dias = args.dias ? Number(args.dias) : 7;
  const periodoFim = new Date();
  const periodoInicio = new Date(periodoFim.getTime() - dias * 24 * 60 * 60 * 1000);

  console.log(`Gerando relatório de ${periodoInicio.toISOString()} a ${periodoFim.toISOString()}...`);
  const relatorio = await gerarRelatorioSemanal(String(conta._id), { inicio: periodoInicio, fim: periodoFim });

  console.log(`\nRelatório gerado: ${relatorio._id}`);
  console.log(`Custo: US$ ${relatorio.custoTokensUsd.toFixed(4)} (${relatorio.modeloUsado})`);
  console.log(`Google Sheets atualizado: ${relatorio.googleSheetsAtualizado}`);
  console.log(`\n--- Resumo ---\n${relatorio.resumoTexto}\n`);

  await enviarRelatorioWhatsapp(relatorio, conta);
  console.log('Mensagem de WhatsApp enviada.');
}

executarScript(main);
