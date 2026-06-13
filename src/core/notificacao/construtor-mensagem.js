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
 */
export function construirMensagem(investigacao, anomalia, entidade) {
  const { diagnostico, recomendacao } = investigacao;
  const metadados = obterMetadadosMetrica(anomalia.metrica);
  const nomeMetrica = metadados?.nome ?? anomalia.metrica;

  const linhas = [];

  linhas.push(`${emojiSeveridade(diagnostico.severidade)} *ANOMALIA EM ${entidade.nome.toUpperCase()}*`);
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
