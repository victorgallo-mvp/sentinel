/**
 * Objetivos de negócio declaráveis por conta (até 3, ordenados: principal,
 * secundário, terciário). Cada objetivo mapeia para a métrica-resultado usada
 * na avaliação de melhora/queda da conta. Nem todo negócio busca conversão —
 * Lordrox busca mensagens, Adesivar busca leads (formulário), etc.
 */
export const OBJETIVOS = {
  conversao: { nome: 'Conversões / Vendas',   metricaResultado: 'conversions',                     rotulo: 'conversões' },
  mensagem:  { nome: 'Mensagens (WhatsApp)',   metricaResultado: 'messaging_conversations_started', rotulo: 'conversas' },
  lead:      { nome: 'Leads / Formulário',     metricaResultado: 'leads',                           rotulo: 'leads' },
  trafego:   { nome: 'Tráfego / Cliques',      metricaResultado: 'clicks',                          rotulo: 'cliques' },
  alcance:   { nome: 'Alcance',                metricaResultado: 'reach',                           rotulo: 'alcance' },
};

// Peso por ordem de prioridade — usado para ponderar o veredito de melhora/queda.
export const PESO_POR_ORDEM = { 1: 0.6, 2: 0.3, 3: 0.1 };

export function objetivoValido(chave) {
  return Object.prototype.hasOwnProperty.call(OBJETIVOS, chave);
}

/** Ordena os objetivos da conta por `ordem` e devolve [{ordem, chave, ...OBJETIVOS[chave], peso}]. */
export function resolverObjetivosConta(perfil) {
  const objetivos = (perfil?.objetivos ?? [])
    .filter((o) => objetivoValido(o.chave))
    .slice()
    .sort((a, b) => a.ordem - b.ordem);
  return objetivos.map((o) => ({
    ordem: o.ordem,
    chave: o.chave,
    ...OBJETIVOS[o.chave],
    peso: PESO_POR_ORDEM[o.ordem] ?? 0,
  }));
}
