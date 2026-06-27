/**
 * Monta a mensagem rica de WhatsApp enviada ao usuário com o resultado
 * de uma investigação que decidiu notificar.
 */
import { obterMetadadosMetrica } from '../../config/metricas.config.js';
import { arredondar } from '../../shared/utils.js';
import { emojiSeveridade, labelUrgencia, formatarBullets, formatarConfianca } from './formatador-recomendacao.js';

/**
 * @param {Object} investigacao - documento Investigacao (com diagnostico/recomendacao)
 * @param {Object} anomalia - documento Anomalia
 * @param {Object} entidade - documento Entidade
 * @param {Object|null} campanha - campanha pai (quando a entidade é adset/ad)
 */
export function construirMensagem(investigacao, anomalia, entidade, campanha = null) {
  const { diagnostico, recomendacao } = investigacao;
  const metadados = obterMetadadosMetrica(anomalia.metrica);
  const nomeMetrica = metadados?.nome ?? anomalia.metrica;

  const linhas = [];

  // Cabeçalho sempre ancorado na campanha. Se a anomalia for de um adset/ad,
  // a campanha é o título e a entidade afetada aparece como subtítulo.
  const nomeAlvo = campanha?.nome ?? entidade.nome;
  linhas.push(`${emojiSeveridade(diagnostico.severidade)} *ANOMALIA — ${nomeAlvo.toUpperCase()}*`);
  if (campanha && entidade.tipo !== 'campaign') {
    const rotulo = entidade.tipo === 'adset' ? 'Conjunto' : entidade.tipo === 'ad' ? 'Anúncio' : 'Entidade';
    linhas.push(`_${rotulo} afetado: ${entidade.nome}_`);
  }
  linhas.push('');
  linhas.push(`*Métrica:* ${nomeMetrica}`);
  linhas.push(`*Variação:* ${arredondar(anomalia.valorAtual, 4)} (baseline: ${arredondar(anomalia.baselineMedia, 4)} ± ${arredondar(anomalia.baselineDesvio, 4)})`);
  linhas.push(`*Magnitude:* ${arredondar(anomalia.magnitudeDesvios, 2)} desvios padrão (${anomalia.direcao})`);
  linhas.push('');
  linhas.push('📊 *Diagnóstico:*');
  linhas.push(diagnostico.causaProvavel || '_não registrado_');
  linhas.push('');
  linhas.push('Contexto relevante:');
  linhas.push(formatarBullets(diagnostico.contextoRelevante));
  linhas.push('');
  linhas.push('💡 *Recomendação:*');
  linhas.push(recomendacao.acao || '_não registrada_');
  linhas.push('');
  linhas.push('Passos práticos:');
  linhas.push(formatarBullets(recomendacao.passosPraticos));
  linhas.push('');
  linhas.push(`⏱ *Urgência:* ${labelUrgencia(recomendacao.urgenciaResposta)}`);
  linhas.push(`📈 *Impacto esperado:* ${recomendacao.impactoEsperado || '_não especificado_'}`);
  linhas.push('');
  linhas.push('---');
  linhas.push(`🔍 Confiança da análise: ${formatarConfianca(diagnostico.confianca)}`);
  linhas.push(`⚙️ Investigação usou ${investigacao.iteracoes} passo(s) e ${investigacao.toolsChamadas.length} chamada(s) de ferramenta`);
  linhas.push('');
  linhas.push('Responda:');
  linhas.push('1️⃣ Útil — alerta foi relevante');
  linhas.push('2️⃣ Ruído — falso positivo, ignorar similar');
  linhas.push('3️⃣ Snooze 4h pra essa métrica');

  return linhas.join('\n');
}

const RANK_SEVERIDADE = { critica: 3, urgente: 2, atencao: 1, info: 0 };
const TIPO_LABEL = { campaign: 'Campanha', adset: 'Conjunto', ad: 'Anúncio' };

/** Formata um valor numérico conforme a unidade da métrica, em PT-BR. */
function formatarValorMetrica(v, unidade) {
  if (v == null) return '—';
  const n = Number(v);
  switch (unidade) {
    case 'currency':   return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case 'percent':    return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
    case 'multiplier': return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x`;
    case 'decimal':    return n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    default:           return n.toLocaleString('pt-BR');
  }
}

/**
 * Monta UMA mensagem consolidada por conta/BM, agrupando várias anomalias numa
 * só mensagem em linguagem simples (sem desvio-padrão/baseline). É o formato
 * "BM X apresentou os problemas Y e Z".
 *
 * @param {Object} conta - documento Conta
 * @param {Array<{investigacao:Object, anomalia:Object, entidade:Object, campanha:Object|null}>} itens
 */
export function construirMensagemConsolidada(conta, itens) {
  const maisGrave = itens.reduce((acc, it) => {
    const s = it.investigacao.diagnostico?.severidade ?? 'info';
    return (RANK_SEVERIDADE[s] ?? 0) > (RANK_SEVERIDADE[acc] ?? 0) ? s : acc;
  }, 'info');

  const n = itens.length;
  const linhas = [];
  linhas.push(`${emojiSeveridade(maisGrave)} *${conta.nome.toUpperCase()} — ${n} ${n === 1 ? 'problema' : 'problemas'}*`);
  linhas.push('');

  itens.forEach((it, i) => {
    const { investigacao, anomalia, entidade, campanha } = it;
    const metadados = obterMetadadosMetrica(anomalia.metrica);
    const nomeMetrica = metadados?.nome ?? anomalia.metrica;
    const unidade = metadados?.unidade;

    const rotuloTipo = TIPO_LABEL[entidade.tipo] ?? 'Entidade';
    const sob = campanha && entidade.tipo !== 'campaign' ? ` _(campanha: ${campanha.nome})_` : '';

    const subiu = Number(anomalia.valorAtual) >= Number(anomalia.baselineMedia);
    const verbo = subiu ? 'subiu' : 'caiu';
    const de = formatarValorMetrica(anomalia.baselineMedia, unidade);
    const para = formatarValorMetrica(anomalia.valorAtual, unidade);

    linhas.push(`*${i + 1}. ${rotuloTipo} "${entidade.nome}"*${sob}`);
    linhas.push(`${nomeMetrica} ${verbo}: ${de} → ${para}`);
    const acao = investigacao.recomendacao?.acao;
    if (acao) linhas.push(`→ ${acao}`);
    linhas.push('');
  });

  linhas.push('Responda: *1* útil · *2* ruído · *3* silenciar 4h');
  return linhas.join('\n');
}
