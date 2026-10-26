/**
 * Backfill do registro de alterações: coleta N dias do histórico da Meta para
 * todas as contas ativas (ou uma só) e grava em `alteracoes_conta`. É o mesmo
 * mecanismo do job diário, aplicado a um período maior. Idempotente.
 *
 * Uso: npm run coletar-alteracoes -- [--dias=30] [--conta=identificador]
 */
import { conectarMongo } from '../src/infra/mongo.js';
import { executarScript } from './_contexto.js';
import { Conta } from '../src/dominio/conta.modelo.js';
import { coletarAlteracoesConta } from '../src/core/alteracoes/coletor-alteracoes.servico.js';
import { dataBRT } from '../src/shared/utils.js';

function argumento(nome, padrao = null) {
  const arg = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return arg ? arg.split('=')[1] : padrao;
}

async function main() {
  const dias = Number(argumento('dias', 30));
  const identificador = argumento('conta');
  if (!Number.isInteger(dias) || dias < 1 || dias > 365) throw new Error('--dias deve ser um inteiro de 1 a 365');

  await conectarMongo();
  const contas = await Conta.find(identificador ? { identificador } : { ativo: true });
  if (!contas.length) throw new Error('Nenhuma conta encontrada para o filtro informado');

  const intervalo = { since: dataBRT(dias), until: dataBRT(0) };
  console.log(`Coletando alterações de ${intervalo.since} a ${intervalo.until} para ${contas.length} conta(s)\n`);

  for (const conta of contas) {
    const r = await coletarAlteracoesConta(String(conta._id), intervalo);
    console.log(`${r.falhas ? 'ERRO' : 'OK  '} ${conta.identificador.padEnd(24)} eventos ${String(r.eventos).padStart(5)}  falhas ${r.falhas}`);
  }
}

executarScript(main);
