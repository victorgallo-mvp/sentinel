/**
 * Tradução do histórico de alterações da Meta (`act_<id>/activities`) para
 * frases em português, com categoria e autoria.
 *
 * A Meta devolve cada evento com `event_type`, o objeto afetado e um
 * `extra_data` cujo formato muda por tipo. Este módulo é o único lugar que
 * conhece esses formatos: quem lê o registro recebe uma frase pronta.
 *
 * Nomes de objeto seguem a nomenclatura ANTIGA da Meta, que confunde:
 * CAMPAIGN_GROUP é a campanha, CAMPAIGN é o conjunto e ADGROUP é o anúncio.
 */

export const OBJETO = {
  CAMPAIGN_GROUP: 'campanha',
  CAMPAIGN: 'conjunto',
  ADGROUP: 'anúncio',
  ACCOUNT: 'conta',
};

/** Categorias exibidas. `sistema` agrupa o que a Meta faz sozinha. */
export const CATEGORIAS = {
  estrutura:   'Estrutura',
  status:      'Status',
  orcamento:   'Orçamento e lance',
  segmentacao: 'Segmentação',
  criativo:    'Criativo',
  faturamento: 'Faturamento',
  sistema:     'Sistema',
};

const ESTRATEGIA_LANCE = {
  LOWEST_COST_BID_STRATEGY: 'custo mais baixo',
  LOWEST_COST_WITH_BID_CAP: 'limite de lance',
  COST_CAP: 'limite de custo',
  LOWEST_COST_WITH_MIN_ROAS: 'ROAS mínimo',
};

const reais = (centavos) =>
  `R$ ${(Number(centavos) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const nomeObjeto = (e) => `${OBJETO[e.object_type] ?? e.object_type?.toLowerCase() ?? 'objeto'} "${e.object_name ?? e.object_id}"`;

/** Lê o JSON de `extra_data`, que chega como string. */
export function lerExtra(e) {
  if (!e.extra_data) return {};
  if (typeof e.extra_data === 'object') return e.extra_data;
  try { return JSON.parse(e.extra_data); } catch { return {}; }
}

/** Autor humano? A Meta assina os eventos automáticos como "Meta", actor_id 0. */
export function ehSistema(e) {
  return !e.actor_id || String(e.actor_id) === '0' || e.actor_name === 'Meta';
}

// Estados transitórios do fluxo de publicação. Uma transição que sai deles ou
// entra neles é a Meta processando, não uma decisão do gestor.
const ESTADOS_PENDENTES = new Set(['Análise pendente', 'Processo pendente', 'Não aprovado', 'Em análise']);

function statusFrase(e, x) {
  const de = x.old_value, para = x.new_value;
  const obj = nomeObjeto(e);
  if (ESTADOS_PENDENTES.has(para)) return { frase: `${obj} em "${para}"`, categoria: 'sistema', oculto: true };
  if (para === 'Ativo' || para === 'Ativa') {
    if (ESTADOS_PENDENTES.has(de)) return { frase: `${obj} aprovado e ativo`, categoria: 'sistema', oculto: true };
    return { frase: `ativou ${obj}`, categoria: 'status' };
  }
  if (para === 'Inativo' || para === 'Inativa') return { frase: `pausou ${obj}`, categoria: 'status' };
  if (para === 'Excluído' || para === 'Excluída') return { frase: `excluiu ${obj}`, categoria: 'estrutura' };
  return { frase: `${obj}: status de "${de}" para "${para}"`, categoria: 'status' };
}

function orcamentoFrase(e, x) {
  const de = x.old_value?.old_value ?? x.old_value?.new_value;
  const para = x.new_value?.new_value;
  const periodo = x.new_value?.additional_value ? ` ${x.new_value.additional_value.toLowerCase()}` : '';
  const frase = de != null && para != null
    ? `alterou o orçamento do ${nomeObjeto(e)} de ${reais(de)} para ${reais(para)}${periodo}`
    : para != null
      ? `definiu o orçamento do ${nomeObjeto(e)} em ${reais(para)}${periodo}`
      : `alterou o orçamento do ${nomeObjeto(e)}`;
  return { frase, categoria: 'orcamento' };
}

function segmentacaoFrase(e, x) {
  const blocos = Array.isArray(x.new_value) ? x.new_value : [];
  const partes = blocos
    .filter((b) => b?.content && Array.isArray(b.children) && b.children.length)
    .map((b) => `${b.content.replace(/:$/, '')}: ${b.children.join(', ')}`);
  const resumo = partes.length ? ` (${partes.slice(0, 3).join(' · ')})` : '';
  return { frase: `alterou a segmentação do ${nomeObjeto(e)}${resumo}`, categoria: 'segmentacao' };
}

/**
 * Tradutores por `event_type`. Cada um devolve `{ frase, categoria }`; a
 * frase é escrita como complemento do autor ("Fulano pausou o conjunto X").
 * `oculto` marca ruído que não merece linha própria (mas conta no total).
 */
const TRADUTORES = {
  create_campaign: (e) => ({ frase: `criou a ${nomeObjeto(e)}`, categoria: 'estrutura' }),
  create_ad_set: (e, x) => {
    const orc = x.new_value?.new_value != null ? ` com orçamento de ${reais(x.new_value.new_value)}${x.new_value.additional_value ? ` ${x.new_value.additional_value.toLowerCase()}` : ''}` : '';
    return { frase: `criou o ${nomeObjeto(e)}${orc}`, categoria: 'estrutura' };
  },
  create_ad: (e) => ({ frase: `criou o ${nomeObjeto(e)}`, categoria: 'estrutura' }),
  update_campaign_name: (e) => ({ frase: `renomeou a ${nomeObjeto(e)}`, categoria: 'estrutura' }),
  update_ad_set_name: (e) => ({ frase: `renomeou o ${nomeObjeto(e)}`, categoria: 'estrutura' }),
  update_ad_name: (e) => ({ frase: `renomeou o ${nomeObjeto(e)}`, categoria: 'estrutura' }),

  update_campaign_run_status: statusFrase,
  update_ad_set_run_status: statusFrase,
  update_ad_run_status: statusFrase,
  update_ad_run_status_to_be_set_after_review: (e, x) => ({ frase: `${nomeObjeto(e)} ficará "${x.new_value}" após a análise`, categoria: 'sistema', oculto: true }),

  update_campaign_budget: orcamentoFrase,
  update_ad_set_budget: orcamentoFrase,
  update_ad_set_bid_strategy: (e, x) => ({ frase: `definiu a estratégia de lance do ${nomeObjeto(e)}: ${ESTRATEGIA_LANCE[x.new_value] ?? x.new_value}`, categoria: 'orcamento' }),
  update_ad_set_bid_amount: (e, x) => ({ frase: `alterou o lance do ${nomeObjeto(e)}${x.new_value != null ? ` para ${reais(x.new_value)}` : ''}`, categoria: 'orcamento' }),
  update_ad_set_optimization_goal: (e, x) => ({ frase: `definiu a meta de desempenho do ${nomeObjeto(e)}: ${x.new_value}`, categoria: 'orcamento' }),
  update_campaign_budget_scheduling_state: () => ({ frase: 'programação de orçamento', categoria: 'orcamento', oculto: true }),

  update_ad_set_target_spec: segmentacaoFrase,
  update_ad_set_duration: (e) => ({ frase: `alterou a duração do ${nomeObjeto(e)}`, categoria: 'segmentacao' }),

  update_ad_creative: (e) => ({ frase: `alterou o criativo do ${nomeObjeto(e)}`, categoria: 'criativo' }),
  add_images: () => ({ frase: 'adicionou imagem à biblioteca', categoria: 'criativo' }),
  edit_images: () => ({ frase: 'editou imagem na biblioteca', categoria: 'criativo', oculto: true }),

  ad_account_billing_charge: (e, x) => ({ frase: `cobrança de ${reais(x.new_value)}`, categoria: 'faturamento' }),
  ad_account_billing_refund: (e, x) => ({ frase: `reembolso de ${reais(x.new_value)}`, categoria: 'faturamento' }),
  funding_event_successful: (e, x) => ({ frase: `recarga de ${reais(x.amount)}${x.network_id ? ` via ${x.network_id}` : ''}`, categoria: 'faturamento' }),
  ad_account_update_status: (e, x) => ({ frase: `conta passou de "${x.old_value}" para "${x.new_value}"`, categoria: 'faturamento' }),
  ad_account_update_spend_cap: (e) => ({ frase: 'alterou o limite de gastos da conta', categoria: 'faturamento' }),

  first_delivery_event: (e) => ({ frase: `${nomeObjeto(e)} começou a ser exibido`, categoria: 'sistema' }),
  create_audience: (e, x) => ({ frase: `público criado: "${x.name ?? e.object_name}"`, categoria: ehSistema(e) ? 'sistema' : 'segmentacao', oculto: ehSistema(e) }),
};

/**
 * Traduz um evento bruto da Meta.
 * @returns {{ frase: string, categoria: string, oculto: boolean, sistema: boolean }}
 */
export function traduzirEvento(e) {
  const x = lerExtra(e);
  const tradutor = TRADUTORES[e.event_type];
  const base = tradutor
    ? tradutor(e, x)
    : { frase: `${e.translated_event_type ?? e.event_type}${e.object_name ? ` — ${nomeObjeto(e)}` : ''}`, categoria: 'estrutura' };
  return { frase: base.frase, categoria: base.categoria, oculto: base.oculto ?? false, sistema: ehSistema(e) };
}
