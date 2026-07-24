/**
 * Agente do resumo diário — uma única chamada à Claude (modelo barato, ex. Haiku)
 * que recebe os totais já agregados de uma BM + os pontos de atenção e devolve um
 * texto curto e coeso para WhatsApp. Sem tool use, sem thinking. Se falhar, o
 * chamador cai para o resumo determinístico (a notificação nunca depende só da IA).
 */
import { anthropic, calcularCusto } from '../ia/cliente.claude.js';
import { config } from '../../config/index.js';
import { logger } from '../../infra/logger.js';

const SYSTEM_PROMPT = [
  'Você é um analista de tráfego pago escrevendo o resumo DIÁRIO de uma Business Manager (BM) para o gestor, via WhatsApp.',
  'Receberá um JSON com os totais do dia (já agregados no nível da BM) e os pontos de atenção.',
  '',
  'Escreva em português do Brasil, tom direto e profissional. Regras:',
  '- Comece pelo panorama (gasto do dia e o resultado principal). Uma ou duas frases.',
  '- O campo `metricaPrincipal` indica a métrica de resultado desta conta (ex: "messaging_conversations_started", "leads", "conversions"). Use SOMENTE essa métrica ao falar de resultado — se for "messaging_conversations_started", fale em "conversas" ou "mensagens", nunca em "conversões". Se for "leads", fale em "leads". Nunca destaque ausência de uma métrica que não é a principal (ex: não diga "nenhuma conversão" se a métrica principal é conversas).',
  '- Se houver `veredito` (tendência 7d vs 7d anterior, ponderada pelos objetivos da conta), diga se a conta MELHOROU, ficou ESTÁVEL ou PIOROU no geral e por quê (olhe `veredito.detalhes` por objetivo). É o ponto mais importante.',
  '- Se houver `investimentoMensal`, mencione o ritmo do mês (`gastoMes` vs `investimentoMensal`) de forma leve.',
  '- Depois, destaque os PONTOS DE ATENÇÃO que existirem (saldo baixo/crítico, campanhas gastando sem o resultado esperado, alertas, quedas). Se não houver, diga que está tudo tranquilo.',
  '- Seja COMPACTO: no máximo ~6 linhas. Nada de repetir todos os números crus — foque no que importa para decidir.',
  '- Formatação de WhatsApp: use *asteriscos* para negrito (não use markdown com # ou **). Pode usar 1-2 emojis com moderação.',
  '- Não invente dados que não estão no JSON. Se um número não veio, não cite.',
  '- Não use saudações genéricas longas nem assinatura.',
].join('\n');

/**
 * @param {object} dados - { bm, data, totais, campanhasAtivas, semConversao, saldo, alertas24h, gasto30d }
 * @returns {Promise<{texto: string, custoUsd: number, modelo: string}>}
 */
export async function redigirResumoDiario(dados) {
  const modelo = config.modeloResumoDiario;
  const resposta = await anthropic.messages.create({
    model: modelo,
    max_tokens: 700,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Dados do dia:\n\n${JSON.stringify(dados, null, 2)}` }],
  });

  const bloco = resposta.content.find((c) => c.type === 'text');
  const texto = (bloco?.text ?? '').trim();
  const custoUsd = calcularCusto(resposta.usage, modelo);
  logger.info({ msg: 'Resumo diário IA gerado', bm: dados.bm, modelo, custoUsd: custoUsd.toFixed(5) });
  return { texto, custoUsd, modelo };
}

const SYSTEM_MINI = [
  'Você resume o dia de uma conta de tráfego para o gestor, na visão geral do dashboard.',
  'Receberá um JSON com os totais do dia e os pontos de atenção.',
  'Escreva UMA a DUAS frases (máx ~240 caracteres), português do Brasil, direto ao ponto.',
  'Priorize: tendência (melhorou/piorou), e o ponto de atenção mais crítico (saldo, gasto sem converter).',
  'Sem formatação, sem emojis, sem saudação. Só o essencial que o gestor precisa saber num relance.',
].join('\n');

/** Mini-resumo (1-2 frases) para a visão geral do dashboard. */
export async function redigirMiniResumo(dados) {
  const modelo = config.modeloResumoDiario;
  const resposta = await anthropic.messages.create({
    model: modelo,
    max_tokens: 200,
    system: SYSTEM_MINI,
    messages: [{ role: 'user', content: `Dados do dia:\n\n${JSON.stringify(dados, null, 2)}` }],
  });
  const bloco = resposta.content.find((c) => c.type === 'text');
  return { texto: (bloco?.text ?? '').trim(), custoUsd: calcularCusto(resposta.usage, modelo), modelo };
}
