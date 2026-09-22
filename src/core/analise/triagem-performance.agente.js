/**
 * Agente da triagem de performance — uma chamada à Claude (modelo barato) que
 * recebe a tabela comparativa JÁ CALCULADA de uma conta e devolve a leitura:
 * situação, resumo, fatores e ação.
 *
 * O modelo NÃO faz conta. Ele classifica e explica sobre números prontos, e o
 * que vai para a tela vem da camada determinística — LLM erra ao repetir
 * dígito, e relatório com número errado é pior que relatório sem análise.
 */
import { anthropic, calcularCusto } from '../ia/cliente.claude.js';
import { config } from '../../config/index.js';
import { logger } from '../../infra/logger.js';

const SITUACOES = ['saudavel', 'atencao', 'critico'];

const SYSTEM_PROMPT = [
  'Você é um analista de tráfego pago avaliando a saúde de UMA conta de anúncios.',
  'Receberá um JSON com métricas já agregadas e comparadas: 7 dias contra os 7 anteriores, 30 dias contra os 30 anteriores.',
  '',
  'Responda SOMENTE com um objeto JSON válido, sem cercas de código, neste formato:',
  '{"situacao":"saudavel|atencao|critico","resumo":"uma frase","fatores":["...","..."],"acao":"..."|null}',
  '',
  'Como avaliar:',
  '- Olhe o CONJUNTO, não uma métrica isolada. Combinações valem mais que números soltos:',
  '  frequência alta subindo + CTR do link caindo + CPC subindo = saturação de criativo.',
  '  resultado caindo mas custo por resultado caindo junto = menos volume, mais eficiência (não é piora).',
  '  gasto subindo com resultado parado = deterioração, mesmo com o resultado estável em números absolutos.',
  '- `metricaResultado` diz o que conta como resultado NESTA conta. Use o nome certo: messaging_conversations_started = "conversas"; leads = "leads"; conversions = "conversões"; clicks = "cliques". NUNCA fale em "conversão" ou "pixel" se metricaResultado não for "conversions" — a maioria das contas não tem pixel.',
  '- `roas`, `receita` e `carrinhos` só existem em conta com e-commerce rastreado. Se vierem nulos, não mencione.',
  '- `cobertura` diz quantos dias de cada janela foram medidos. Se `seteDias` ou `trintaDias` vier null, a coleta não cobriu o período: NÃO invente tendência, diga que não há base para comparar.',
  '- `saldoPrepago` com nivel "zerado" ou "critico" é o fator mais urgente que existe — conta sem saldo não entrega.',
  '- Variação partindo de base pequena (menos de ~10 resultados) é ruído. Diga isso em vez de tratar como tendência.',
  '- `variacaoPct` null significa que não dá para calcular (base zero). Não invente porcentagem.',
  '',
  'Regras da resposta:',
  '- Português do Brasil, direto, sem jargão vazio.',
  '- `resumo`: UMA frase, no máximo ~140 caracteres.',
  '- `fatores`: 2 a 4 itens, cada um citando o número que o sustenta. Só o que muda a decisão.',
  '- `acao`: o que fazer, uma frase. null se não houver nada a fazer.',
  '- "critico" exige algo que exige ação hoje (saldo zerado, queda abrupta, conta bloqueada). Não inflacione.',
  '- Não invente número que não está no JSON. Repita os valores exatamente como vieram.',
].join('\n');

/** Valida e normaliza o que o modelo devolveu — nunca confie no formato. */
export function interpretarResposta(texto) {
  const limpo = String(texto).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const dados = JSON.parse(limpo);

  const situacao = SITUACOES.includes(dados.situacao) ? dados.situacao : 'atencao';
  const fatores = Array.isArray(dados.fatores)
    ? dados.fatores.filter((f) => typeof f === 'string' && f.trim()).slice(0, 5)
    : [];

  return {
    situacao,
    resumo: String(dados.resumo ?? '').trim().slice(0, 300),
    fatores,
    acao: dados.acao ? String(dados.acao).trim().slice(0, 300) : null,
  };
}

/**
 * @param {Object} comparativo - saída de montarComparativoConta
 * @returns {Promise<{situacao, resumo, fatores, acao, modelo, custoUsd}>}
 */
export async function analisarPerformance(comparativo) {
  const modelo = config.modeloTriagemPerformance;

  const resposta = await anthropic.messages.create({
    model: modelo,
    max_tokens: 600,
    temperature: 0, // veredito que muda sozinho entre execuções corrói a confiança no selo
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: JSON.stringify(comparativo, null, 2) }],
  });

  const custoUsd = calcularCusto(resposta.usage, modelo);
  const texto = resposta.content?.find((b) => b.type === 'text')?.text ?? '';

  try {
    const analise = interpretarResposta(texto);
    logger.info({ msg: 'Triagem de performance concluída', conta: comparativo.conta, situacao: analise.situacao, custoUsd: custoUsd.toFixed(6) });
    return { ...analise, modelo, custoUsd };
  } catch (erro) {
    logger.error({ msg: 'Resposta da triagem não é JSON válido', conta: comparativo.conta, erro: erro.message, texto: texto.slice(0, 200) });
    throw erro;
  }
}
