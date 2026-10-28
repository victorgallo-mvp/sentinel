/**
 * Roda o motor de sinais agora e imprime os achados, por conta. Não grava a
 * menos que receba --gravar. Serve para calibrar limiares olhando dados reais.
 *
 * Uso: npm run sinais -- [--conta=identificador] [--gravar] [--curto]
 *   --curto  só a frase e o caminho (sem explicação e sugestão)
 */
import { conectarMongo } from '../src/infra/mongo.js';
import { executarScript } from './_contexto.js';
import { Conta } from '../src/dominio/conta.modelo.js';
import { gerarSinaisConta, persistirSinais, caminhoSinal } from '../src/core/sinais/motor-sinais.servico.js';

function argumento(nome) {
  const arg = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return arg ? arg.split('=')[1] : null;
}

const reais = (v) => (v == null ? '—' : `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const ROTULO_CATEGORIA = { desperdicio: 'DESPERDÍCIO', risco: 'RISCO', operacao: 'OPERAÇÃO', orcamento: 'ORÇAMENTO', previsao: 'PREVISÃO' };

async function main() {
  const identificador = argumento('conta');
  const gravar = process.argv.includes('--gravar');
  const curto = process.argv.includes('--curto');

  await conectarMongo();
  const contas = await Conta.find(identificador ? { identificador } : { ativo: true }).sort({ nome: 1 });
  if (!contas.length) throw new Error('Nenhuma conta encontrada');

  let totalDia = 0;
  let totalSinais = 0;
  const porCategoria = {};
  for (const conta of contas) {
    const { dia, sinais } = await gerarSinaisConta(String(conta._id));
    if (gravar) await persistirSinais(conta.identificador, dia, sinais);
    const desperdicio = sinais.reduce((s, x) => s + (x.desperdicioDia ?? 0), 0);
    const ganho = sinais.reduce((s, x) => s + (x.evidencia?.economiaDia ?? 0), 0);
    totalDia += desperdicio;
    totalSinais += sinais.length;
    for (const s of sinais) porCategoria[s.categoria] = (porCategoria[s.categoria] ?? 0) + 1;

    console.log(`\n## ${conta.nome} — ${sinais.length} sinal(is), ${reais(desperdicio)}/dia vazando${ganho > 0 ? `, ${reais(ganho)}/dia recuperáveis por realocação` : ''}`);
    for (const s of sinais) {
      const custo = s.desperdicioDia != null ? `${reais(s.desperdicioDia)}/dia` : s.evidencia?.economiaDia != null ? `+${reais(s.evidencia.economiaDia)}/dia possível` : '';
      console.log(`\n  [${s.severidade.toUpperCase()}] ${ROTULO_CATEGORIA[s.categoria] ?? s.categoria} · ${s.tipo}${custo ? ` · ${custo}` : ''}`);
      console.log(`  Onde: ${caminhoSinal(s)}`);
      console.log(`  O quê: ${s.frase}${s.origemResultado ? ` (resultado = ${s.metricaResultado}, via ${s.origemResultado})` : ''}`);
      if (!curto && s.explicacao) console.log(`  Como: ${s.explicacao}`);
      if (!curto && s.sugestao) console.log(`  Fazer: ${s.sugestao}`);
    }
  }
  const resumoCat = Object.entries(porCategoria).map(([c, n]) => `${n} ${ROTULO_CATEGORIA[c]?.toLowerCase() ?? c}`).join(', ');
  console.log(`\n# ${contas.length} conta(s), ${totalSinais} sinais (${resumoCat}), ${reais(totalDia)}/dia vazando${gravar ? ' — gravado' : ' — não gravado (use --gravar)'}`);
}

executarScript(main);
