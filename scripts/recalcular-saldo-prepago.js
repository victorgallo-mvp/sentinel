/**
 * Recalcula e persiste o snapshot de saldo pré-pago de TODAS as contas pré-pagas,
 * usando a lógica corrigida (saldo via funding_source_details + runway por orçamento
 * diário previsto). NÃO envia nenhuma notificação — apenas atualiza o que o dashboard
 * exibe. Útil após mudanças na lógica de saldo, para corrigir valores antigos errados.
 *
 * Uso: npm run recalcular-saldo
 */
import { conectarMongo } from '../src/infra/mongo.js';
import { executarScript } from './_contexto.js';
import { recalcularSnapshotsSaldoPrepago } from '../src/core/alertas/alerta-orcamento.servico.js';

async function main() {
  await conectarMongo();

  console.log('Recalculando snapshots de saldo de todas as contas pré-pagas (sem notificar)...\n');
  const resultado = await recalcularSnapshotsSaldoPrepago();

  if (!resultado.length) {
    console.log('Nenhuma conta pré-paga ativa encontrada.');
    return;
  }

  for (const r of resultado) {
    if (r.erro) {
      console.log(`✗ ${r.conta} (${r.contaAnuncioId}) — erro: ${r.erro}`);
    } else if (r.ignorado) {
      console.log(`– ${r.conta} (${r.contaAnuncioId}) — ${r.ignorado}`);
    } else if (r.nivel === 'bloqueado') {
      console.log(`🚨 ${r.conta} (${r.contaAnuncioId}) — bloqueada: ${r.motivoBloqueio}`);
    } else {
      const saldo = r.saldoReais != null ? `R$ ${r.saldoReais.toFixed(2)}` : '—';
      const ritmo = r.ritmoHora != null ? `R$ ${r.ritmoHora.toFixed(2)}/h` : '—';
      const runway = r.runwayHoras != null ? `~${Math.round(r.runwayHoras)}h` : '—';
      console.log(`✓ ${r.conta} (${r.contaAnuncioId}) — ${r.nivel} · saldo ${saldo} · ritmo ${ritmo} · autonomia ${runway}`);
    }
  }

  console.log(`\n${resultado.length} conta(s) de anúncio processada(s).`);
}

executarScript(main);
