/**
 * Prova do registro de alterações: lê o histórico da Meta de uma conta e
 * imprime uma linha do tempo legível, por dia e por autor. Não grava nada.
 *
 * Uso: npm run listar-alteracoes -- --conta=dilson-piscinas [--dias=30] [--sistema]
 *   --sistema  mostra também os eventos automáticos da Meta linha a linha
 */
import { conectarMongo } from '../src/infra/mongo.js';
import { executarScript } from './_contexto.js';
import { Conta } from '../src/dominio/conta.modelo.js';
import { config } from '../src/config/index.js';
import { traduzirEvento, CATEGORIAS } from '../src/core/alteracoes/dicionario-meta.js';

const CAMPOS = 'event_time,event_type,translated_event_type,actor_id,actor_name,application_name,object_id,object_name,object_type,extra_data';

function argumento(nome, padrao = null) {
  const arg = process.argv.find((a) => a.startsWith(`--${nome}=`));
  return arg ? arg.split('=')[1] : padrao;
}

async function buscarAtividades(contaAnuncioId, token, since, until) {
  const url = new URL(`https://graph.facebook.com/${config.meta.apiVersion}/${contaAnuncioId}/activities`);
  url.searchParams.set('fields', CAMPOS);
  url.searchParams.set('since', since);
  url.searchParams.set('until', until);
  url.searchParams.set('limit', '500');
  url.searchParams.set('access_token', token);
  const todos = [];
  let proxima = url.toString();
  while (proxima) {
    const resposta = await (await fetch(proxima)).json();
    if (resposta.error) throw new Error(`Meta: ${resposta.error.message}`);
    todos.push(...resposta.data);
    proxima = resposta.paging?.next ?? null;
  }
  return todos;
}

const BRT = 'America/Sao_Paulo';
const diaBRT = (iso) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: BRT, weekday: 'short', day: '2-digit', month: '2-digit' });
const horaBRT = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: BRT, hour: '2-digit', minute: '2-digit' });
const chaveDia = (iso) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: BRT });

async function main() {
  const identificador = argumento('conta');
  const dias = Number(argumento('dias', 30));
  const mostrarSistema = process.argv.includes('--sistema');
  if (!identificador) throw new Error('Informe --conta=identificador');

  await conectarMongo();
  const conta = await Conta.findOne({ identificador });
  if (!conta) throw new Error(`Conta "${identificador}" não encontrada`);
  const token = conta.metaConfig?.systemUserToken || config.meta.systemUserToken;

  const until = new Date();
  const since = new Date(until.getTime() - dias * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10);

  const eventos = [];
  for (const contaAnuncioId of conta.metaConfig.contasAnuncioIds) {
    const lista = await buscarAtividades(contaAnuncioId, token, fmt(since), fmt(until));
    eventos.push(...lista.map((e) => ({ ...e, contaAnuncioId, ...traduzirEvento(e) })));
  }
  eventos.sort((a, b) => a.event_time.localeCompare(b.event_time));

  console.log(`# Alterações — ${conta.nome} — ${fmt(since)} a ${fmt(until)} (${eventos.length} eventos)\n`);

  // Linha do tempo: dia → autor → ações
  const porDia = new Map();
  for (const e of eventos) {
    const d = chaveDia(e.event_time);
    if (!porDia.has(d)) porDia.set(d, new Map());
    const autor = e.sistema ? 'Meta (automático)' : e.actor_name;
    if (!porDia.get(d).has(autor)) porDia.get(d).set(autor, []);
    porDia.get(d).get(autor).push(e);
  }

  for (const [dia, autores] of [...porDia.entries()].sort()) {
    const primeiro = [...autores.values()][0][0];
    console.log(`## ${diaBRT(primeiro.event_time)}`);
    for (const [autor, acoes] of autores) {
      const humanas = acoes.filter((a) => !a.sistema);
      if (humanas.length) {
        console.log(`  ${autor} — ${humanas.length} ${humanas.length === 1 ? 'ação' : 'ações'}`);
        const visiveis = humanas.filter((a) => !a.oculto);
        const ocultas = humanas.length - visiveis.length;
        for (const a of agruparRepetidas(visiveis)) console.log(`    ${horaBRT(a.event_time)}  ${a.frase}${a.vezes > 1 ? ` (×${a.vezes})` : ''}`);
        if (ocultas) console.log(`    (+${ocultas} ajustes menores: ${resumirTipos(humanas.filter((a) => a.oculto))})`);
      } else {
        const faturamento = acoes.filter((a) => a.categoria === 'faturamento');
        const outros = acoes.filter((a) => a.categoria !== 'faturamento');
        const partes = [];
        for (const f of faturamento) partes.push(f.frase);
        if (outros.length) partes.push(`${outros.length} automáticos (${resumirTipos(outros)})`);
        console.log(`  Meta: ${partes.join('; ')}`);
        if (mostrarSistema) for (const a of outros) console.log(`    ${horaBRT(a.event_time)}  ${a.frase}`);
      }
    }
    console.log('');
  }

  // Resumo por autor e categoria
  console.log('# Resumo\n');
  const porAutor = new Map();
  for (const e of eventos) {
    const autor = e.sistema ? 'Meta (automático)' : e.actor_name;
    if (!porAutor.has(autor)) porAutor.set(autor, { total: 0, dias: new Set(), categorias: {} });
    const r = porAutor.get(autor);
    r.total++; r.dias.add(chaveDia(e.event_time)); r.categorias[e.categoria] = (r.categorias[e.categoria] ?? 0) + 1;
  }
  for (const [autor, r] of porAutor) {
    const cats = Object.entries(r.categorias).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${CATEGORIAS[c] ?? c} ${n}`).join(', ');
    console.log(`${autor}: ${r.total} eventos em ${r.dias.size} dias — ${cats}`);
  }
  const humanos = eventos.filter((e) => !e.sistema);
  if (humanos.length) {
    const ultimo = humanos[humanos.length - 1];
    const semAcao = Math.floor((Date.now() - new Date(ultimo.event_time)) / 86400000);
    console.log(`\nÚltima ação humana: ${diaBRT(ultimo.event_time)} ${horaBRT(ultimo.event_time)} por ${ultimo.actor_name} (${semAcao} dia(s) atrás)`);
  } else {
    console.log('\nNenhuma ação humana no período.');
  }
}

/** Junta ações iguais e consecutivas do mesmo autor ("adicionou imagem" ×8). */
function agruparRepetidas(lista) {
  const saida = [];
  for (const a of lista) {
    const ultima = saida[saida.length - 1];
    if (ultima && ultima.frase === a.frase) ultima.vezes++;
    else saida.push({ ...a, vezes: 1 });
  }
  return saida;
}

function resumirTipos(lista) {
  const n = {};
  for (const a of lista) n[a.translated_event_type ?? a.event_type] = (n[a.translated_event_type ?? a.event_type] ?? 0) + 1;
  return Object.entries(n).map(([t, k]) => `${t.toLowerCase()} ×${k}`).join(', ');
}

executarScript(main);
