/**
 * Regras do motor de sinais. Funções puras: recebem janelas já somadas e
 * devolvem um sinal ou null. Nenhuma lê banco; é isso que as torna testáveis
 * e auditáveis — a frase, a explicação e a evidência saem dos mesmos números.
 *
 * Cada sinal traz:
 * - `frase`: o achado, em uma linha.
 * - `explicacao`: como o número foi calculado, com os valores.
 * - `sugestao`: o que fazer a respeito.
 * - `desperdicioDia`: R$/dia já perdido; null quando o sinal é previsão,
 *   risco ou operação (o que esses custam vai na evidência, não na soma).
 *
 * Convenções de janela (todas terminam ANTEONTEM — o último dia ainda recebe
 * atribuição e distorceria qualquer razão):
 * - `tres`: 3 dias.   `recente`: 7 dias.   `anterior`: os 7 dias antes de `recente`.
 * - `trintaDias`: 30 dias.   `base`: os 30 dias anteriores à janela recente.
 */

export const LIMIARES = {
  gastoSemResultadoMin: 30,        // R$ em 3 dias sem nenhum resultado
  gastoSemResultadoAlta: 100,      // R$ a partir do qual a severidade é alta
  custoSubiuFator: 1.5,            // custo por resultado 7d ≥ 1,5× a base
  custoSubiuFatorAlta: 2.0,
  custoMinResultados7d: 5,
  custoMinResultadosBase: 10,
  custoMinGasto7d: 50,
  fadigaFrequencia: 3.0,
  fadigaQuedaCtr: 0.85,            // CTR do link 7d ≤ 85% da base
  fadigaAltaCpm: 1.15,             // CPM 7d ≥ 115% da base
  fadigaMinImpressoes7d: 2000,
  fadigaIminenteFreqMin: 2.0,      // previsão: só faz sentido antes de saturar
  fadigaIminenteSubidaDia: 0.05,   // frequência subindo ≥ 0,05/dia
  fadigaIminenteHorizonteDias: 14, // ... e cruzando 3,0 em até 14 dias
  quedaFator: 1.25,                // custo 7d ≥ 1,25× os 7 dias anteriores
  quedaFatorAlta: 1.6,
  respostaMinConversas7d: 10,
  respostaTaxaMinima: 0.5,
  respostaTaxaAlta: 0.25,
  rastreamentoMinGasto30d: 100,
  edicoesMax7d: 4,
  realocacaoFator: 1.5,            // pior conjunto custa ≥ 1,5× o melhor
  realocacaoMinGasto7d: 50,
  realocacaoFracaoMover: 0.5,      // sugere mover metade do gasto diário do pior
  ritmoDesvio: 0.15,
  ritmoDesvioAlta: 0.30,
};

const reais = (v) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v) => `${Math.round(v * 100)}%`;
const n2 = (v) => Number(Number(v).toFixed(2));
const n0 = (v) => Math.round(Number(v));
const dec = (v, casas = 1) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const plural = (n, um, varios) => (n === 1 ? um : varios);
/** "compra" / "compras" conforme a quantidade. */
const rot = (n, r) => (Math.round(n) === 1 ? (r.rotuloSingular ?? r.rotulo) : r.rotulo);
/** "nenhuma compra" / "nenhum lead". */
const nenhum = (r) => `${r.genero === 'f' ? 'nenhuma' : 'nenhum'} ${r.rotuloSingular ?? r.rotulo}`;

/** Gastou e não trouxe nenhum resultado em 3 dias. */
export function gastoSemResultado({ tres, resultado, melhorIrmao = null }) {
  const gasto = tres.spend ?? 0;
  if (gasto < LIMIARES.gastoSemResultadoMin) return null;
  if ((tres[resultado.metrica] ?? 0) > 0) return null;
  // Se a métrica de resultado nunca foi coletada nesta entidade, não dá para
  // afirmar zero. Proxy (cliques no link) está sempre presente.
  if (!(resultado.metrica in tres) && resultado.origem !== 'proxy') return null;
  const dia = gasto / 3;
  const alternativa = melhorIrmao
    ? ` O conjunto "${melhorIrmao.nome}", na mesma campanha, está convertendo a ${reais(melhorIrmao.cpr)} por ${resultado.rotuloSingular ?? resultado.rotulo}: esse orçamento rende mais lá.`
    : '';
  return {
    tipo: 'gasto_sem_resultado',
    severidade: gasto >= LIMIARES.gastoSemResultadoAlta ? 'alta' : 'media',
    desperdicioDia: n2(dia),
    frase: `gastou ${reais(gasto)} em 3 dias sem ${nenhum(resultado)}`,
    explicacao: `${reais(gasto)} em 3 dias ÷ 3 = ${reais(dia)} por dia saindo sem ${nenhum(resultado)} em troca. Enquanto não converter, todo esse valor conta como desperdício.`,
    sugestao: `Reduzir o orçamento ou pausar até rever público e criativo; se ficar mais 2 dias sem ${resultado.rotulo}, pausar.${alternativa}`,
    evidencia: { gasto3d: n2(gasto), resultado3d: 0, metrica: resultado.metrica, origem: resultado.origem, melhorIrmao },
  };
}

/** Custo por resultado nos últimos 7 dias bem acima da própria média de 30 dias. */
export function custoResultadoSubindo({ recente, base, resultado, alteracoes7d = [] }) {
  const res7 = recente[resultado.metrica] ?? 0;
  const resBase = base[resultado.metrica] ?? 0;
  const gasto7 = recente.spend ?? 0;
  if (res7 < LIMIARES.custoMinResultados7d || resBase < LIMIARES.custoMinResultadosBase || gasto7 < LIMIARES.custoMinGasto7d) return null;
  const cpr7 = gasto7 / res7;
  const cprBase = (base.spend ?? 0) / resBase;
  if (!(cprBase > 0) || cpr7 < LIMIARES.custoSubiuFator * cprBase) return null;
  const fator = cpr7 / cprBase;
  const extraSemana = (cpr7 - cprBase) * res7;
  const mexeu = alteracoes7d.length;
  const causa = mexeu > 0
    ? `Houve ${mexeu} ${plural(mexeu, 'alteração', 'alterações')} no conjunto nesta semana: a piora provavelmente é reinício de aprendizado; esperar 3 dias sem mexer antes de novo ajuste.`
    : 'Não houve alteração registrada na semana: o público está cansando ou a concorrência subiu. Renovar criativos e testar um público novo em conjunto separado.';
  return {
    tipo: 'custo_resultado_subindo',
    severidade: fator >= LIMIARES.custoSubiuFatorAlta ? 'alta' : 'media',
    desperdicioDia: n2(extraSemana / 7),
    frase: `custo por ${resultado.rotulo} subiu de ${reais(cprBase)} para ${reais(cpr7)} (+${Math.round((fator - 1) * 100)}%) nos últimos 7 dias`,
    explicacao: `Nos 7 dias, cada ${resultado.rotuloSingular ?? resultado.rotulo} custou ${reais(cpr7)}; nos 30 dias anteriores, ${reais(cprBase)}. Diferença de ${reais(cpr7 - cprBase)} × ${res7} ${rot(res7, resultado)} = ${reais(extraSemana)} na semana, ${reais(extraSemana / 7)} por dia pagos a mais pelo mesmo resultado.`,
    sugestao: `${causa} Se o custo seguir acima de ${reais(cprBase * LIMIARES.custoSubiuFator)} por mais 3 dias, reduzir o orçamento.`,
    evidencia: { custo7d: n2(cpr7), custoBase30d: n2(cprBase), resultados7d: res7, resultadosBase: resBase, gasto7d: n2(gasto7), alteracoes7d: mexeu, metrica: resultado.metrica, origem: resultado.origem },
  };
}

/** Frequência alta, CTR do link caindo e CPM subindo ao mesmo tempo: o criativo cansou. */
export function fadigaCriativo({ recente, base, frequencia7d }) {
  const impr7 = recente.impressions ?? 0;
  const imprBase = base.impressions ?? 0;
  if (!(frequencia7d >= LIMIARES.fadigaFrequencia) || impr7 < LIMIARES.fadigaMinImpressoes7d || imprBase <= 0) return null;
  const ctr7 = (recente.inline_link_clicks ?? 0) / impr7;
  const ctrBase = (base.inline_link_clicks ?? 0) / imprBase;
  const cpm7 = ((recente.spend ?? 0) / impr7) * 1000;
  const cpmBase = ((base.spend ?? 0) / imprBase) * 1000;
  if (!(ctrBase > 0) || !(cpmBase > 0)) return null;
  if (ctr7 > LIMIARES.fadigaQuedaCtr * ctrBase || cpm7 < LIMIARES.fadigaAltaCpm * cpmBase) return null;
  const gastoDia = (recente.spend ?? 0) / 7;
  const fracaoCara = 1 - cpmBase / cpm7;
  return {
    tipo: 'fadiga_criativo',
    severidade: frequencia7d >= 5 ? 'alta' : 'media',
    desperdicioDia: n2(gastoDia * fracaoCara),
    frase: `frequência ${dec(frequencia7d)} em 7 dias, CTR do link caiu ${pct(1 - ctr7 / ctrBase)} e CPM subiu ${pct(cpm7 / cpmBase - 1)}: criativo saturado`,
    explicacao: `Cada pessoa viu o anúncio ${dec(frequencia7d)} vezes na semana. O CPM foi de ${reais(cpmBase)} para ${reais(cpm7)}: dos ${reais(gastoDia)} por dia, ${pct(fracaoCara)} (${reais(gastoDia * fracaoCara)}) pagam só o encarecimento da entrega, não alcance novo.`,
    sugestao: 'Subir 2 ou 3 criativos novos no conjunto (ângulo ou formato diferente, não só outra imagem) e ampliar o público. Manter o orçamento só depois de a frequência voltar abaixo de 2,5.',
    evidencia: { frequencia7d: n2(frequencia7d), ctrLink7d: n2(ctr7 * 100), ctrLinkBase: n2(ctrBase * 100), cpm7d: n2(cpm7), cpmBase: n2(cpmBase), gasto7d: n2(recente.spend ?? 0) },
  };
}

/**
 * Previsão de fadiga: frequência ainda abaixo de 3,0 mas subindo num ritmo que
 * cruza esse limite em poucos dias — ou já com o CTR do link cedendo.
 */
export function fadigaIminente({ recente, anterior = {}, base, frequencia7d, frequenciaHistorico = [] }) {
  const impr7 = recente.impressions ?? 0;
  if (!(frequencia7d >= LIMIARES.fadigaIminenteFreqMin) || frequencia7d >= LIMIARES.fadigaFrequencia) return null;
  if (impr7 < LIMIARES.fadigaMinImpressoes7d) return null;
  // Conjunto novo: a frequência de 7 dias sobe só porque a janela está
  // enchendo. Só prevê fadiga em quem já rodava na semana anterior.
  if (!((anterior.spend ?? 0) > 0)) return null;

  const pontos = frequenciaHistorico.filter((p) => p.frequency > 0);
  if (pontos.length < 2) return null;
  const primeiro = pontos[0];
  const ultimo = pontos[pontos.length - 1];
  const dias = (new Date(ultimo.dia) - new Date(primeiro.dia)) / 86400000;
  if (dias < 3) return null;
  const subidaDia = (ultimo.frequency - primeiro.frequency) / dias;
  if (subidaDia < LIMIARES.fadigaIminenteSubidaDia) return null;
  const diasAteSaturar = Math.ceil((LIMIARES.fadigaFrequencia - frequencia7d) / subidaDia);
  if (diasAteSaturar > LIMIARES.fadigaIminenteHorizonteDias) return null;

  const imprBase = base.impressions ?? 0;
  const ctr7 = impr7 > 0 ? (recente.inline_link_clicks ?? 0) / impr7 : 0;
  const ctrBase = imprBase > 0 ? (base.inline_link_clicks ?? 0) / imprBase : 0;
  const quedaCtr = ctrBase > 0 ? 1 - ctr7 / ctrBase : 0;
  const ctrTexto = quedaCtr >= 0.05 ? `; o CTR do link já caiu ${pct(quedaCtr)} contra a média de 30 dias` : '';
  return {
    tipo: 'fadiga_iminente',
    severidade: diasAteSaturar <= 5 ? 'media' : 'baixa',
    desperdicioDia: null,
    frase: `frequência ${dec(frequencia7d)} e subindo ${dec(subidaDia, 2)} por dia: passa de 3,0 em cerca de ${diasAteSaturar} ${plural(diasAteSaturar, 'dia', 'dias')}${ctrTexto}`,
    explicacao: `A frequência de 7 dias foi de ${dec(primeiro.frequency, 2)} para ${dec(ultimo.frequency, 2)} em ${dias} dias (+${dec(subidaDia, 2)} por dia). Mantido o ritmo, cruza 3,0 em ${diasAteSaturar} ${plural(diasAteSaturar, 'dia', 'dias')}, ponto em que o CPM costuma subir e o CTR cair. Gasto atual: ${reais((recente.spend ?? 0) / 7)} por dia.`,
    sugestao: 'Preparar criativos novos agora para entrar antes de saturar. Se não houver criativo pronto, ampliar o público ou segurar o orçamento em vez de escalar.',
    evidencia: { frequencia7d: n2(frequencia7d), frequenciaInicio: n2(primeiro.frequency), diasObservados: dias, subidaDia: n2(subidaDia), diasAteSaturar, ctrLink7d: n2(ctr7 * 100), ctrLinkBase: n2(ctrBase * 100), gasto7d: n2(recente.spend ?? 0) },
  };
}

/**
 * Queda de performance por tendência: custo por resultado piorou de uma
 * semana para a outra e continua piorando nos últimos 3 dias. Pega antes do
 * `custoResultadoSubindo` (que compara com 30 dias) e projeta a próxima semana.
 */
export function quedaPerformance({ recente, anterior, tres, resultado }) {
  const resRec = recente[resultado.metrica] ?? 0;
  const resAnt = anterior[resultado.metrica] ?? 0;
  const gastoRec = recente.spend ?? 0;
  const gastoAnt = anterior.spend ?? 0;
  if (resRec < LIMIARES.custoMinResultados7d || resAnt < LIMIARES.custoMinResultados7d) return null;
  if (gastoRec < LIMIARES.custoMinGasto7d || gastoAnt < LIMIARES.custoMinGasto7d) return null;
  const cprRec = gastoRec / resRec;
  const cprAnt = gastoAnt / resAnt;
  if (cprRec < LIMIARES.quedaFator * cprAnt) return null;
  // Ainda piorando: os últimos 3 dias não estão melhores que a semana.
  const resTres = tres[resultado.metrica] ?? 0;
  const cprTres = resTres > 0 ? (tres.spend ?? 0) / resTres : Infinity;
  if (cprTres < cprRec) return null;

  const fator = cprRec / cprAnt;
  const cprProjetado = cprRec + (cprRec - cprAnt);
  const resultadosDia = resRec / 7;
  const extraProjetadoDia = (cprProjetado - cprAnt) * resultadosDia;
  const tresTexto = Number.isFinite(cprTres) ? reais(cprTres) : `sem ${nenhum(resultado)}`;
  return {
    tipo: 'queda_performance',
    severidade: fator >= LIMIARES.quedaFatorAlta ? 'alta' : 'media',
    desperdicioDia: null,
    frase: `custo por ${resultado.rotulo} foi de ${reais(cprAnt)} para ${reais(cprRec)} em uma semana (+${Math.round((fator - 1) * 100)}%) e segue piorando (${tresTexto} nos últimos 3 dias)`,
    explicacao: `Semana anterior: ${reais(gastoAnt)} por ${resAnt} ${rot(resAnt, resultado)} (${reais(cprAnt)} cada). Última semana: ${reais(gastoRec)} por ${resRec} (${reais(cprRec)} cada). Se a tendência continuar, a próxima semana fecha perto de ${reais(cprProjetado)} por ${resultado.rotuloSingular ?? resultado.rotulo}, cerca de ${reais(extraProjetadoDia)} por dia a mais que há duas semanas.`,
    sugestao: `Agir antes de virar custo consolidado: conferir se houve mudança de público, orçamento ou criativo há 7 a 10 dias e reverter o que coincidir com a piora; se nada mudou, renovar o criativo. Reavaliar em 3 dias.`,
    evidencia: { custoSemanaAnterior: n2(cprAnt), custoUltimaSemana: n2(cprRec), custoUltimos3d: Number.isFinite(cprTres) ? n2(cprTres) : null, custoProjetado7d: n2(cprProjetado), extraProjetadoDia: n2(extraProjetadoDia), resultadosSemanaAnterior: resAnt, resultadosUltimaSemana: resRec, gastoUltimaSemana: n2(gastoRec), metrica: resultado.metrica, origem: resultado.origem },
  };
}

/** Conversas iniciadas que a empresa não respondeu. */
export function conversasSemResposta({ recente, resultado }) {
  if (resultado.metrica !== 'messaging_conversations_started') return null;
  const conversas = recente.messaging_conversations_started ?? 0;
  if (conversas < LIMIARES.respostaMinConversas7d) return null;
  if (!('messaging_first_reply' in recente)) return null; // ainda não coletado: não dá para afirmar
  const respondidas = recente.messaging_first_reply ?? 0;
  const taxa = respondidas / conversas;
  if (taxa >= LIMIARES.respostaTaxaMinima) return null;
  const gasto7 = recente.spend ?? 0;
  const custoConversa = gasto7 / conversas;
  const semResposta = conversas - respondidas;
  return {
    tipo: 'conversas_sem_resposta',
    severidade: taxa < LIMIARES.respostaTaxaAlta ? 'alta' : 'media',
    desperdicioDia: n2((gasto7 / 7) * (1 - taxa)),
    frase: `de ${conversas} conversas em 7 dias, só ${respondidas} foram respondidas (${pct(taxa)}): o anúncio entrega e o atendimento não`,
    explicacao: `Cada conversa custou ${reais(custoConversa)} (${reais(gasto7)} ÷ ${conversas}). As ${semResposta} sem resposta somam ${reais(semResposta * custoConversa)} na semana, ${reais((semResposta * custoConversa) / 7)} por dia pagos por contatos que ninguém atendeu.`,
    sugestao: 'Antes de mexer no anúncio, resolver o atendimento: resposta automática de boas-vindas, responsável pelo WhatsApp e horário de cobertura. Enquanto a taxa de resposta ficar abaixo de 50%, não escalar o orçamento.',
    evidencia: { conversas7d: conversas, respondidas7d: respondidas, semResposta7d: semResposta, taxaResposta: n2(taxa), custoConversa: n2(custoConversa), gasto7d: n2(gasto7) },
  };
}

/** Otimiza para compras, gasta, e nunca registra uma: rastreamento provavelmente ausente. */
export function rastreamentoAusente({ trintaDias, resultado }) {
  if (resultado.origem !== 'meta' || resultado.metrica !== 'conversions') return null;
  const gasto = trintaDias.spend ?? 0;
  if (gasto < LIMIARES.rastreamentoMinGasto30d) return null;
  if ((trintaDias.conversions ?? 0) > 0) return null;
  return {
    tipo: 'rastreamento_ausente',
    severidade: 'alta',
    desperdicioDia: null,
    frase: `otimiza para conversão no site, gastou ${reais(gasto)} em 30 dias e não registrou nenhuma compra: ou o evento otimizado não é compra, ou o rastreamento falhou`,
    explicacao: `A Meta entrega este conjunto para quem tem mais chance de converter no site, mas em 30 dias e ${reais(gasto)} nenhuma compra chegou ao pixel. Sem o evento, o algoritmo otimiza às cegas e o Sentinela não consegue medir o retorno.`,
    sugestao: 'Abrir o Gerenciador de Eventos e conferir se Purchase está chegando (pixel ou API de Conversões). Se o conjunto otimiza para outro evento (lead, contato, adicionar ao carrinho), registrar isso no perfil da conta para a avaliação usar a métrica certa.',
    evidencia: { gasto30d: n2(gasto), compras30d: 0 },
  };
}

/** Mexeu demais: cada alteração de orçamento, público ou status reinicia o aprendizado. */
export function edicaoExcessiva({ alteracoes7d }) {
  if (!alteracoes7d || alteracoes7d.length < LIMIARES.edicoesMax7d) return null;
  const porCategoria = {};
  for (const a of alteracoes7d) porCategoria[a.categoria] = (porCategoria[a.categoria] ?? 0) + 1;
  const detalhe = Object.entries(porCategoria).map(([c, n]) => `${c} ${n}`).join(', ');
  const n = alteracoes7d.length;
  return {
    tipo: 'edicao_excessiva',
    severidade: n >= LIMIARES.edicoesMax7d * 2 ? 'alta' : 'media',
    desperdicioDia: null,
    frase: `${n} alterações em 7 dias (${detalhe}): cada uma reinicia o aprendizado da entrega`,
    explicacao: `Mudança de orçamento acima de 20%, de público ou de status devolve o conjunto à fase de aprendizado, em que a Meta gasta pior por 2 a 3 dias. Com ${n} alterações na semana, o conjunto praticamente não saiu dessa fase.`,
    sugestao: 'Congelar o conjunto por 3 ou 4 dias e depois fazer uma alteração por vez. Para escalar, subir o orçamento em até 20% a cada 2 dias; para testar público ou criativo, duplicar em conjunto novo em vez de editar o que está rodando.',
    evidencia: { alteracoes7d: n, porCategoria },
  };
}

/**
 * Realocação de orçamento entre irmãos (conjuntos da mesma campanha, ou
 * campanhas da mesma conta) que perseguem o mesmo resultado: aponta o que
 * custa mais caro e quanto renderia mover parte do gasto para o mais barato.
 *
 * @param {Object} o
 * @param {Array<{nome: string, metaId: string, gasto7: number, resultados7: number}>} o.irmaos
 * @param {{metrica: string, rotulo: string}} o.resultado
 * @param {'conjunto'|'campanha'} o.unidade
 */
export function realocacaoOrcamento({ irmaos, resultado, unidade = 'conjunto' }) {
  const ativos = irmaos.filter((i) => i.gasto7 >= LIMIARES.realocacaoMinGasto7d);
  if (ativos.length < 2) return null;
  const comResultado = ativos.filter((i) => i.resultados7 >= LIMIARES.custoMinResultados7d).map((i) => ({ ...i, cpr: i.gasto7 / i.resultados7 }));
  if (!comResultado.length) return null;
  const melhor = comResultado.reduce((a, b) => (b.cpr < a.cpr ? b : a));

  const candidatos = ativos
    .filter((i) => i.metaId !== melhor.metaId)
    .map((i) => ({ ...i, cpr: i.resultados7 > 0 ? i.gasto7 / i.resultados7 : Infinity }))
    .filter((i) => i.cpr >= LIMIARES.realocacaoFator * melhor.cpr)
    .map((i) => {
      const gastoDia = i.gasto7 / 7;
      const moverDia = gastoDia * LIMIARES.realocacaoFracaoMover;
      const resultadosAtuais = Number.isFinite(i.cpr) ? moverDia / i.cpr : 0;
      const ganhoSemana = (moverDia / melhor.cpr - resultadosAtuais) * 7;
      const economiaDia = Number.isFinite(i.cpr) ? gastoDia * (1 - melhor.cpr / i.cpr) : gastoDia;
      return { ...i, gastoDia, moverDia, ganhoSemana, economiaDia };
    })
    .sort((a, b) => b.economiaDia - a.economiaDia);
  if (!candidatos.length) return null;

  const pior = candidatos[0];
  const outros = candidatos.length - 1;
  const custoPior = Number.isFinite(pior.cpr) ? `custa ${reais(pior.cpr)} por ${resultado.rotuloSingular ?? resultado.rotulo}` : `gastou ${reais(pior.gasto7)} na semana sem ${nenhum(resultado)}`;
  const outrosTexto = outros > 0 ? ` Mais ${outros} ${plural(outros, `${unidade} está`, `${unidade}s estão`)} na mesma situação (ver evidência).` : '';
  return {
    tipo: 'realocacao_orcamento',
    severidade: pior.economiaDia >= 30 ? 'alta' : 'media',
    desperdicioDia: null,
    frase: `${unidade} "${pior.nome}" ${custoPior}; "${melhor.nome}" entrega a ${reais(melhor.cpr)}. Mover ${reais(pior.moverDia)}/dia renderia cerca de +${n0(pior.ganhoSemana)} ${rot(pior.ganhoSemana, resultado)} por semana com o mesmo gasto`,
    explicacao: `Nos últimos 7 dias, "${melhor.nome}" fez ${melhor.resultados7} ${rot(melhor.resultados7, resultado)} com ${reais(melhor.gasto7)} (${reais(melhor.cpr)} cada). "${pior.nome}" gastou ${reais(pior.gasto7)} para ${pior.resultados7} (${Number.isFinite(pior.cpr) ? reais(pior.cpr) + ' cada' : nenhum(resultado)}). Pelo custo do melhor, os mesmos resultados do pior sairiam por ${reais(pior.economiaDia)} a menos por dia.`,
    sugestao: `Mover metade do orçamento diário de "${pior.nome}" (${reais(pior.moverDia)}) para "${melhor.nome}", em aumentos de até 20% por dia para não reiniciar o aprendizado do melhor. Se o custo do melhor subir com a escala, parar de mover.${outrosTexto}`,
    evidencia: {
      unidade,
      melhor: { metaId: melhor.metaId, nome: melhor.nome, gasto7d: n2(melhor.gasto7), resultados7d: melhor.resultados7, custo: n2(melhor.cpr) },
      pior: { metaId: pior.metaId, nome: pior.nome, gasto7d: n2(pior.gasto7), resultados7d: pior.resultados7, custo: Number.isFinite(pior.cpr) ? n2(pior.cpr) : null },
      moverDia: n2(pior.moverDia), ganhoSemana: n2(pior.ganhoSemana), economiaDia: n2(pior.economiaDia),
      outros: candidatos.slice(1).map((c) => ({ metaId: c.metaId, nome: c.nome, gasto7d: n2(c.gasto7), resultados7d: c.resultados7, custo: Number.isFinite(c.cpr) ? n2(c.cpr) : null, economiaDia: n2(c.economiaDia) })),
      metrica: resultado.metrica,
    },
  };
}

/**
 * Ritmo do mês contra o investimento planejado. DESLIGADA no motor até o
 * onboarding (fase 3) preencher um valor real: hoje o campo é placeholder na
 * maioria das contas e o sinal viraria ruído.
 */
export function ritmoPlanejado({ gastoMes, mediaDiaria7d, diaDoMes, diasNoMes, planejado }) {
  if (!(planejado > 0) || diaDoMes < 3) return null;
  if (!(mediaDiaria7d > 0) && !(gastoMes > 0)) return null; // conta parada: outro problema, outro sinal
  const diasRestantes = Math.max(0, diasNoMes - diaDoMes);
  const projecao = gastoMes + mediaDiaria7d * diasRestantes;
  const desvio = projecao / planejado - 1;
  if (Math.abs(desvio) < LIMIARES.ritmoDesvio) return null;
  const acima = desvio > 0;
  return {
    tipo: acima ? 'ritmo_acima_do_planejado' : 'ritmo_abaixo_do_planejado',
    severidade: Math.abs(desvio) >= LIMIARES.ritmoDesvioAlta ? 'alta' : 'media',
    desperdicioDia: null,
    frase: acima
      ? `no ritmo atual fecha o mês em ${reais(projecao)}, ${pct(desvio)} acima dos ${reais(planejado)} planejados`
      : `no ritmo atual fecha o mês em ${reais(projecao)}, ${pct(-desvio)} abaixo dos ${reais(planejado)} planejados`,
    explicacao: `${reais(gastoMes)} gastos até hoje + ${reais(mediaDiaria7d)} por dia (média de 7 dias) × ${diasRestantes} dias restantes = ${reais(projecao)}.`,
    sugestao: acima ? 'Confirmar com o cliente se o teto subiu; se não, reduzir os orçamentos diários proporcionalmente.' : 'Verificar se há conjuntos pausados ou limitados por orçamento; se o cliente quer investir o valor, redistribuir.',
    evidencia: { gastoMes: n2(gastoMes), mediaDiaria7d: n2(mediaDiaria7d), diasRestantes, projecao: n2(projecao), planejado: n2(planejado), desvio: n2(desvio), excessoDia: acima && diasRestantes > 0 ? n2((projecao - planejado) / diasRestantes) : null },
  };
}

/**
 * Categoria de cada tipo de sinal. Só `desperdicio` entra na soma de "R$/dia
 * vazando"; `previsao` ainda não custou nada, `orcamento` é ganho possível.
 */
export const CATEGORIA_SINAL = {
  gasto_sem_resultado: 'desperdicio',
  custo_resultado_subindo: 'desperdicio',
  fadiga_criativo: 'desperdicio',
  conversas_sem_resposta: 'desperdicio',
  queda_performance: 'previsao',
  fadiga_iminente: 'previsao',
  rastreamento_ausente: 'risco',
  edicao_excessiva: 'operacao',
  realocacao_orcamento: 'orcamento',
  ritmo_acima_do_planejado: 'orcamento',
  ritmo_abaixo_do_planejado: 'orcamento',
};

/**
 * Um sinal "previsto" não é emitido quando o fato já aconteceu para a mesma
 * entidade: fadiga iminente cala diante de fadiga; queda de performance cala
 * diante de custo subindo.
 */
export const SUPRIME = {
  fadiga_iminente: 'fadiga_criativo',
  queda_performance: 'custo_resultado_subindo',
};

/** Regras por nível de entidade (a ordem importa por causa de SUPRIME). */
export const REGRAS_ENTIDADE = {
  adset: [gastoSemResultado, custoResultadoSubindo, quedaPerformance, fadigaCriativo, fadigaIminente, conversasSemResposta, rastreamentoAusente, edicaoExcessiva],
  ad: [gastoSemResultado],
  campaign: [],
};
