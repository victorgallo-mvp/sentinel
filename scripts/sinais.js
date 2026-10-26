/**
 * Roda o motor de sinais agora e imprime os achados, por conta. Não grava a
 * menos que receba --gravar. Serve para calibrar limiares olhando dados reais.
 *
 * Uso: npm run sinais -- [--conta=identificador] [--gravar]
 */
import { conectarMongo } from '../src/infra/mongo.js';
import { executarScript } from './_contexto.js';
import { Conta } from '../src/dominio/conta.modelo.js';
import { gerarSinaisConta, persistirSinais } from '../src/core/sinais/motor-sinais.servico.js';

function argumento(nome) {
  const arg = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return arg ? arg.split('=')[1] : null;
}

const reais = (v) => (v == null ? '—' : `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

async function main() {
  const identificador = argumento('conta');
  const gravar = process.argv.includes('--gravar');

  await conectarMongo();
  const contas = await Conta.find(identificador ? { identificador } : { ativo: true }).sort({ nome: 1 });
  if (!contas.length) throw new Error('Nenhuma conta encontrada');

  let totalDia = 0;
  let totalSinais = 0;
  for (const conta of contas) {
    const { dia, sinais } = await gerarSinaisConta(String(conta._id));
    if (gravar) await persistirSinais(conta.identificador, dia, sinais);
    const desperdicio = sinais.reduce((s, x) => s + (x.desperdicioDia ?? 0), 0);
    totalDia += desperdicio;
    totalSinais += sinais.length;

    console.log(`\n## ${conta.nome} — ${sinais.length} sinal(is), ${reais(desperdicio)}/dia estimado`);
    for (const s of sinais) {
      const onde = s.nivel === 'conta' ? 'conta' : `${s.nivel} "${(s.entidadeNome ?? '').slice(0, 38)}"${s.campanhaNome && s.nivel !== 'campaign' ? ` · camp. ${s.campanhaNome.slice(0, 24)}` : ''}`;
      console.log(`  [${s.severidade.padEnd(5)}] ${(s.categoria ?? '').padEnd(11)} ${s.tipo.padEnd(26)} ${reais(s.desperdicioDia).padStart(12)}/dia  ${onde}`);
      console.log(`          ${s.frase}${s.origemResultado ? `  (resultado = ${s.metricaResultado}, via ${s.origemResultado})` : ''}`);
    }
  }
  console.log(`\n# ${contas.length} conta(s), ${totalSinais} sinais, ${reais(totalDia)}/dia vazando${gravar ? ' — gravado' : ' — não gravado (use --gravar)'}`);
}

executarScript(main);
