/**
 * Agente da leitura diária — uma chamada à Claude (modelo barato) que recebe
 * os sinais JÁ CALCULADOS de uma conta e devolve o que o responsável precisa
 * ouvir: resumo, tendência e até três prioridades, cada uma amarrada aos
 * sinais que a sustentam.
 *
 * O modelo NÃO faz conta. Frase, explicação, sugestão e R$/dia vêm do motor;
 * o impacto de cada prioridade é somado aqui a partir dos sinais citados, não
 * copiado da resposta. O que ele acrescenta é julgamento: o que vem primeiro,
 * o que é a mesma causa vista de dois ângulos, e como dizer isso em 30 segundos.
 */
import { anthropic, calcularCusto } from '../ia/cliente.claude.js';
import { config } from '../../config/index.js';
import { logger } from '../../infra/logger.js';

const TENDENCIAS = ['melhorando', 'estavel', 'piorando', 'sem_base'];
const MAX_PRIORIDADES = 3;

export const SYSTEM_PROMPT = [
  'Você é o analista sênior de uma agência de tráfego pago. Todo dia de manhã você lê os sinais que o sistema detectou em UMA conta de anúncios e diz ao responsável pela conta, em 30 segundos, o que importa e o que fazer primeiro.',
  '',
  'Você receberá um JSON com:',
  '- `conta`: nome, gestor e, quando preenchidos, os objetivos declarados no onboarding. A ausência deles não é problema nem assunto: o resultado de cada conjunto já vem resolvido pelo objetivo de otimização na Meta.',
  '- `totais`: R$/dia vazando (só categoria desperdício), R$/dia recuperáveis por realocação, contagem por categoria, e o vazamento de ontem para comparar.',
  '- `sinais`: cada um com `ref`, categoria, tipo, severidade, `onde` (campanha › conjunto › anúncio), `frase`, `explicacao` (a conta aritmética), `sugestao` e `valorDia`. Tudo já calculado.',
  '- `leituraAnterior`: o que você disse ontem, se houver, para dar continuidade (não repetir como novidade o que já foi dito; registrar se piorou ou se foi resolvido).',
  '',
  'Responda SOMENTE com um objeto JSON válido, sem cercas de código, neste formato:',
  '{"resumo":"2 ou 3 frases","tendencia":"melhorando|estavel|piorando|sem_base","prioridades":[{"titulo":"...","onde":"...","porque":"...","acao":"...","refs":["s1","s4"]}],"observacao":"..."|null}',
  '',
  'Como priorizar:',
  '- Primeiro o que já custa dinheiro hoje (desperdício com maior R$/dia), depois risco (rastreamento), depois o que vai custar (previsão), depois realocação (ganho) e por último operação (edição excessiva).',
  '- Junte numa única prioridade sinais que são a MESMA causa vista de ângulos diferentes: o mesmo conjunto com "gasto sem resultado" e "custo subindo" é um problema, não dois; dois conjuntos de "rastreamento ausente" na mesma campanha são um problema de pixel, não dois conjuntos. Cite todos os `ref` envolvidos.',
  '- Um conjunto citado como "pior" numa realocação e também em "gasto sem resultado" é a mesma história: a ação é mover o orçamento.',
  '- No máximo 3 prioridades. Se houver só 1 sinal, 1 prioridade. Sinais que sobrarem não precisam entrar.',
  '- `tendencia`: compare `totais.vazandoDia` com `totais.vazandoOntemDia`. Sem ontem = "sem_base". Diferença menor que 10% = "estavel".',
  '',
  'Regras da resposta:',
  '- Português do Brasil, tom de colega experiente falando com o responsável pela conta, não com o cliente final. Direto, sem jargão vazio, sem elogio.',
  '- `resumo`: 2 ou 3 frases, no máximo ~320 caracteres. A primeira frase diz o tamanho do problema em R$/dia; a segunda, a causa principal; a terceira (opcional), a tendência ou o que resolver primeiro.',
  '- `titulo`: até 60 caracteres, começa com verbo ou com o problema ("Pausar os 4 conjuntos KIT sem compra", "Pixel não registra compra na campanha 08").',
  '- `onde`: copie o caminho campanha › conjunto do sinal, abreviando nomes longos mas mantendo o que identifica (código, data, público). Nunca invente nome.',
  '- Seja econômico: `porque` e `acao` com no máximo 2 frases cada. Resposta longa é truncada e perdida.',
  '- `porque`: 1 ou 2 frases com os números do sinal, exatamente como vieram. Nunca some, divida ou arredonde você mesmo, nem escreva contas ("R$ 7 + R$ 11 = R$ 18"): o sistema soma o impacto da prioridade a partir dos `refs`. Cite cada valor separado.',
  '- `acao`: o que fazer hoje, concreto, em 1 ou 2 frases. Pode partir da `sugestao` do sinal e adaptar ao conjunto do que você viu.',
  '- `refs`: as referências dos sinais que sustentam a prioridade. Obrigatório, ao menos 1.',
  '- `observacao`: algo que o responsável deve saber e não cabe nas prioridades (ex.: "a conta inteira otimiza para conversão mas nenhuma compra chegou em 30 dias: antes de qualquer ajuste, validar o pixel"). null se não houver. Falta de objetivo no onboarding NÃO é observação: o sistema já resolve o resultado pelo objetivo do conjunto na Meta. Conversas no WhatsApp não dependem de rastreamento: não peça para "validar rastreamento de conversa".',
  '- NUNCA fale em "pixel", "conversão" ou "compra" para sinais cujo resultado é conversas, leads ou cliques. Use a palavra que veio no sinal.',
  '- Não invente número, nome de conjunto ou causa que não esteja no JSON.',
].join('\n');

/**
 * Valida e normaliza o que o modelo devolveu. Nunca confia no formato: refs
 * desconhecidas caem, prioridades sem ref caem, textos são truncados.
 * @param {string} texto - resposta crua
 * @param {Set<string>} refsValidas - refs dos sinais enviados
 */
export function interpretarResposta(texto, refsValidas) {
  const limpo = String(texto).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const dados = JSON.parse(limpo);

  const prioridades = (Array.isArray(dados.prioridades) ? dados.prioridades : [])
    .map((p) => ({
      titulo: String(p?.titulo ?? '').trim().slice(0, 120),
      onde: p?.onde ? String(p.onde).trim().slice(0, 300) : null,
      porque: String(p?.porque ?? '').trim().slice(0, 600),
      acao: String(p?.acao ?? '').trim().slice(0, 600),
      refs: (Array.isArray(p?.refs) ? p.refs : []).map(String).filter((r) => refsValidas.has(r)),
    }))
    .filter((p) => p.titulo && p.refs.length > 0)
    .slice(0, MAX_PRIORIDADES)
    .map((p, i) => ({ ordem: i + 1, ...p }));

  return {
    resumo: String(dados.resumo ?? '').trim().slice(0, 600),
    tendencia: TENDENCIAS.includes(dados.tendencia) ? dados.tendencia : 'sem_base',
    prioridades,
    observacao: dados.observacao ? String(dados.observacao).trim().slice(0, 600) : null,
  };
}

/**
 * @param {Object} entrada - saída de montarEntradaLeitura
 * @returns {Promise<{resumo, tendencia, prioridades, observacao, modelo, custoUsd}>}
 */
export async function lerSinais(entrada) {
  const modelo = config.modeloLeituraSinais;
  const refsValidas = new Set(entrada.sinais.map((s) => s.ref));

  const resposta = await anthropic.messages.create({
    model: modelo,
    max_tokens: 2500, // 14 sinais numa conta geram 3 prioridades longas; 1200 truncava o JSON
    temperature: 0, // leitura que muda sozinha entre execuções corrói a confiança
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: JSON.stringify(entrada) }],
  });

  const custoUsd = calcularCusto(resposta.usage, modelo);
  const texto = resposta.content?.find((b) => b.type === 'text')?.text ?? '';
  if (resposta.stop_reason === 'max_tokens') {
    logger.error({ msg: 'Leitura truncada pelo limite de tokens', conta: entrada.conta?.nome, tokensSaida: resposta.usage?.output_tokens });
  }

  try {
    const leitura = interpretarResposta(texto, refsValidas);
    logger.info({ msg: 'Leitura diária concluída', conta: entrada.conta?.nome, prioridades: leitura.prioridades.length, custoUsd: custoUsd.toFixed(6) });
    return { ...leitura, modelo, custoUsd };
  } catch (erro) {
    logger.error({ msg: 'Resposta da leitura não é JSON válido', conta: entrada.conta?.nome, erro: erro.message, texto: texto.slice(0, 200) });
    throw erro;
  }
}
