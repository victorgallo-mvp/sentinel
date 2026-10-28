/**
 * Roda a leitura diária por IA agora e imprime o resultado, por conta.
 * Não grava a menos que receba --gravar.
 *
 * Uso: npm run leitura -- [--conta=identificador] [--gravar] [--memoria]
 *   --memoria  gera os sinais na hora (sem ler sinais_conta); útil antes de
 *              a rodada do dia estar gravada ou para testar calibração
 */
import { conectarMongo } from '../src/infra/mongo.js';
import { executarScript } from './_contexto.js';
import { Conta } from '../src/dominio/conta.modelo.js';
import { gerarSinaisConta } from '../src/core/sinais/motor-sinais.servico.js';
import { gerarLeituraConta, persistirLeitura } from '../src/core/sinais/leitura-diaria.servico.js';

function argumento(nome) {
  const arg = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return arg ? arg.split('=')[1] : null;
}
const reais = (v) => (v == null ? '—' : `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const ROTULO_NATUREZA = { vazando: 'vazando', recuperavel: 'recuperáveis', projetado: 'projetados' };

async function main() {
  const identificador = argumento('conta');
  const gravar = process.argv.includes('--gravar');
  const memoria = process.argv.includes('--memoria');

  await conectarMongo();
  const contas = await Conta.find(identificador ? { identificador } : { ativo: true }).sort({ nome: 1 });
  if (!contas.length) throw new Error('Nenhuma conta encontrada');

  let custo = 0;
  for (const conta of contas) {
    const opcoes = {};
    if (memoria) {
      const { dia, sinais } = await gerarSinaisConta(String(conta._id));
      opcoes.dia = dia;
      opcoes.sinais = sinais;
    }
    const { dia, leitura, motivo } = await gerarLeituraConta(String(conta._id), opcoes);
    if (!leitura) { console.log(`\n## ${conta.nome} — ${motivo}`); continue; }
    if (gravar) await persistirLeitura(dia, leitura);
    custo += leitura.custoUsd ?? 0;

    console.log(`\n## ${conta.nome} — ${leitura.totalSinais} sinais · ${reais(leitura.vazandoDia)}/dia vazando · tendência: ${leitura.tendencia} · US$ ${leitura.custoUsd.toFixed(4)}`);
    console.log(`\n  ${leitura.resumo}`);
    for (const p of leitura.prioridades) {
      const impacto = p.impactoDia != null ? ` · ${reais(p.impactoDia)}/dia ${ROTULO_NATUREZA[p.natureza] ?? ''}` : '';
      console.log(`\n  ${p.ordem}. ${p.titulo}${impacto}`);
      if (p.onde) console.log(`     Onde: ${p.onde}`);
      console.log(`     Por quê: ${p.porque}`);
      console.log(`     Ação: ${p.acao}`);
      console.log(`     Sinais: ${p.sinais.map((s) => s.tipo).join(', ')}`);
    }
    if (leitura.observacao) console.log(`\n  Obs.: ${leitura.observacao}`);
  }
  console.log(`\n# ${contas.length} conta(s), US$ ${custo.toFixed(4)}${gravar ? ' — gravado' : ' — não gravado (use --gravar)'}`);
}

executarScript(main);
