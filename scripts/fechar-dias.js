/**
 * Refaz o snapshot de 24h de um intervalo de dias para TODAS as contas ativas,
 * com o valor final que a Meta reporta hoje. É o mesmo mecanismo do job diário
 * de fechamento, aplicado a um período escolhido — serve para preencher dias em
 * que a coleta ficou parada (ex.: 02 a 08/09/2026) ou para corrigir o histórico
 * que ficou com o corte das 23h.
 *
 * Idempotente: cada dia é gravado com carimbo fixo (23:59 BRT), então rodar de
 * novo atualiza as mesmas linhas.
 *
 * Uso: npm run fechar-dias -- --desde=2026-09-02 --ate=2026-09-08 [--conta=identificador]
 */
import { conectarMongo } from '../src/infra/mongo.js';
import { executarScript } from './_contexto.js';
import { Conta } from '../src/dominio/conta.modelo.js';
import { coletarFechamentoDiasConta } from '../src/core/coleta/coletor-metricas.servico.js';

// A Meta devolve uma linha por entidade e dia; em contas com centenas de anúncios,
// lotes de 7 dias mantêm cada resposta em poucas páginas.
const DIAS_POR_LOTE = 7;

function argumento(nome) {
  const arg = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return arg ? arg.split('=')[1] : null;
}

function somarDias(dataIso, dias) {
  const d = new Date(`${dataIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const desde = argumento('desde');
  const ate = argumento('ate');
  const identificador = argumento('conta');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(ate ?? '') || desde > ate) {
    throw new Error('Informe --desde=YYYY-MM-DD e --ate=YYYY-MM-DD (desde <= ate)');
  }

  await conectarMongo();
  const filtro = identificador ? { identificador } : { ativo: true };
  const contas = await Conta.find(filtro);
  if (!contas.length) throw new Error('Nenhuma conta encontrada para o filtro informado');

  console.log(`Fechando ${desde} a ${ate} para ${contas.length} conta(s)\n`);

  for (const conta of contas) {
    const totais = { linhas: 0, ignoradas: 0, falhas: 0 };
    for (let ini = desde; ini <= ate; ini = somarDias(ini, DIAS_POR_LOTE)) {
      const fim = somarDias(ini, DIAS_POR_LOTE - 1) < ate ? somarDias(ini, DIAS_POR_LOTE - 1) : ate;
      const r = await coletarFechamentoDiasConta(String(conta._id), { since: ini, until: fim });
      totais.linhas += r.linhas; totais.ignoradas += r.ignoradas; totais.falhas += r.falhas;
    }
    console.log(`${totais.falhas ? 'ERRO' : 'OK  '} ${conta.identificador.padEnd(24)} linhas ${String(totais.linhas).padStart(6)}  ignoradas ${String(totais.ignoradas).padStart(5)}  falhas ${totais.falhas}`);
  }
}

executarScript(main);
