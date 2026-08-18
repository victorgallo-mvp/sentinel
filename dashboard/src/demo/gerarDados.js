// Gerador de dados fictícios do modo demonstração. Espelha a FORMA da resposta
// real de /dashboard/data (ver src/api/rotas/dashboard.rota.js no backend) para
// que os componentes do dashboard renderizem exatamente como em produção — só
// que com números e nomes de empresa 100% inventados, calculados aqui mesmo,
// sem nenhuma chamada de rede.
import { EMPRESAS_DEMO } from './empresas.js';
import { CATALOGO_METRICAS } from './catalogos.js';
import { criarRng, faixa } from './rng.js';

const OBJETIVOS = {
  conversao: { metricaResultado: 'conversions',                     rotulo: 'conversões' },
  mensagem:  { metricaResultado: 'messaging_conversations_started', rotulo: 'conversas'  },
  lead:      { metricaResultado: 'leads',                           rotulo: 'leads'      },
  trafego:   { metricaResultado: 'clicks',                          rotulo: 'cliques'    },
  alcance:   { metricaResultado: 'reach',                           rotulo: 'alcance'    },
};
function diasEntre(dataInicio, dataFim) {
  const ini = new Date(dataInicio + 'T00:00:00Z');
  const fim = new Date(dataFim + 'T00:00:00Z');
  return Math.max(1, Math.round((fim - ini) / 86400000) + 1);
}

function metrica(chave, atual, anterior, janela = 'periodo') {
  const meta = CATALOGO_METRICAS[chave];
  const variacaoPct = janela === 'periodo' && atual != null && anterior != null && anterior !== 0
    ? Number((((atual - anterior) / anterior) * 100).toFixed(1))
    : null;
  // Contagens (integer) são eventos reais — sempre número inteiro, nunca "1,34 conversões".
  const arredondar = (v) => {
    if (v == null) return null;
    if (meta.unidade === 'integer') return Math.round(v);
    return Number(v.toFixed(v < 100 ? 2 : 0));
  };
  return {
    chave,
    nome: meta.nome,
    unidade: meta.unidade,
    direcaoBoa: meta.direcaoBoa,
    atual: arredondar(atual),
    anterior: janela === 'periodo' ? arredondar(anterior) : null,
    variacaoPct,
    janela,
  };
}

/** Gera o bloco de métricas de uma entidade (campanha/adset/ad) a partir de um baseline diário. */
function gerarMetricasEntidade(empresa, dias, rng, fator, resultadoChave) {
  // Conta pausada: sem veiculação no período — todas as métricas ficam nulas
  // (mesmo tratamento do backend real pra campanha sem coleta no intervalo).
  if (empresa.pausado) {
    const chavesNulas = ['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm', 'cost_per_result'];
    if (resultadoChave && !chavesNulas.includes(resultadoChave)) chavesNulas.push(resultadoChave);
    const lista = [
      ...chavesNulas.map((c) => metrica(c, null, null)),
      metrica('reach', null, null, '30d'),
      metrica('frequency', null, null, '30d'),
      metrica('unique_clicks', null, null, '30d'),
      metrica('unique_ctr', null, null, '30d'),
    ];
    return { lista, spendAtual: 0, resultadoAtual: 0 };
  }

  const spendAtual = Math.max(0, empresa.baselineSpend * dias * fator * faixa(rng, 0.9, 1.12));
  const spendAnterior = spendAtual / faixa(rng, 0.94, 1.08);

  const cpmAtual = empresa.baselineCpm * faixa(rng, 0.92, 1.08);
  const cpmAnterior = cpmAtual * faixa(rng, 0.93, 1.07);
  const impressionsAtual = cpmAtual > 0 ? (spendAtual / cpmAtual) * 1000 : 0;
  const impressionsAnterior = cpmAnterior > 0 ? (spendAnterior / cpmAnterior) * 1000 : 0;

  const ctrAtual = empresa.baselineCtr * faixa(rng, 0.9, 1.1);
  const ctrAnterior = empresa.baselineCtr * faixa(rng, 0.9, 1.1);
  const clicksAtual = (impressionsAtual * ctrAtual) / 100;
  const clicksAnterior = (impressionsAnterior * ctrAnterior) / 100;

  const cpcAtual = clicksAtual > 0 ? spendAtual / clicksAtual : null;
  const cpcAnterior = clicksAnterior > 0 ? spendAnterior / clicksAnterior : null;
  const cppAtual = impressionsAtual > 0 ? (spendAtual / (impressionsAtual * 0.6)) * 1000 : null;
  const cppAnterior = impressionsAnterior > 0 ? (spendAnterior / (impressionsAnterior * 0.6)) * 1000 : null;

  const resultadoAtual = Math.max(0, empresa.baselineResultadoPorDia * dias * fator * faixa(rng, 0.85, 1.15));
  const resultadoAnterior = resultadoAtual / empresa.trend;

  const custoResultAtual = resultadoAtual > 0 ? spendAtual / resultadoAtual : null;
  const custoResultAnterior = resultadoAnterior > 0 ? spendAnterior / resultadoAnterior : null;

  const chaves = ['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm'];
  const valores = {
    spend:  [spendAtual, spendAnterior],
    impressions: [impressionsAtual, impressionsAnterior],
    clicks: [clicksAtual, clicksAnterior],
    ctr:    [ctrAtual, ctrAnterior],
    cpc:    [cpcAtual, cpcAnterior],
    cpm:    [cpmAtual, cpmAnterior],
    cpp:    [cppAtual, cppAnterior],
  };
  if (resultadoChave && !chaves.includes(resultadoChave)) {
    chaves.push(resultadoChave);
    valores[resultadoChave] = [resultadoAtual, resultadoAnterior];
  }
  chaves.push('cost_per_result');
  valores.cost_per_result = [custoResultAtual, custoResultAnterior];

  if (empresa.roas) {
    const roasAtual = empresa.roas * faixa(rng, 0.9, 1.1);
    const roasAnterior = roasAtual / Math.sqrt(empresa.trend);
    chaves.push('purchase_roas');
    valores.purchase_roas = [roasAtual, roasAnterior];
  }

  const metricasPeriodo = chaves.map((c) => metrica(c, valores[c][0], valores[c][1]));

  // Bloco fixo "últimos 30 dias" (não depende do período selecionado)
  const reach30d = empresa.baselineSpend > 0
    ? (empresa.baselineSpend * 30 * fator * faixa(rng, 0.8, 1.05) / cpmAtual) * 1000 * 0.55
    : 0;
  const freq30d = reach30d > 0 ? faixa(rng, 1.6, 3.4) : null;
  const uniqueCtr30d = ctrAtual * faixa(rng, 0.85, 0.98);
  const uniqueClicks30d = (reach30d * uniqueCtr30d) / 100;

  const metricas30d = [
    metrica('reach', reach30d, null, '30d'),
    metrica('frequency', freq30d, null, '30d'),
    metrica('unique_clicks', uniqueClicks30d, null, '30d'),
    metrica('unique_ctr', uniqueCtr30d, null, '30d'),
  ];

  return {
    lista: [...metricasPeriodo, ...metricas30d],
    spendAtual, resultadoAtual,
  };
}

function fmtDataReferencia(dataInicio, dataFim) {
  const fmt = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('pt-BR');
  return dataInicio === dataFim ? fmt(dataInicio) : `${fmt(dataInicio)} – ${fmt(dataFim)}`;
}

/** Constrói a árvore campanha → conjunto → anúncio de uma empresa fictícia. */
function construirHierarquia(empresa, dias, dataInicio, dataFim, resultadoChave) {
  const rng = criarRng(`${empresa.id}|${dataInicio}|${dataFim}`);
  const dataReferencia = fmtDataReferencia(dataInicio, dataFim);
  const entidades = [];
  const statusPausado = empresa.pausado;

  const CAMPANHAS = [
    { nome: 'Prospecção — Público amplo', peso: 0.6 },
    { nome: 'Remarketing — Visitantes 30d', peso: 0.4 },
  ];

  for (let ci = 0; ci < CAMPANHAS.length; ci++) {
    const camp = CAMPANHAS[ci];
    const campId = `${empresa.id}-camp${ci}`;
    const campMetaId = `${empresa.id}-camp${ci}-meta`;
    const campStatus = statusPausado ? 'PAUSED' : 'ACTIVE';

    const ADSETS = [
      { nome: 'Adset — Interesses', peso: 0.65 },
      { nome: 'Adset — Lookalike 1%', peso: 0.35 },
    ];

    const adsetEntidades = [];
    for (let ai = 0; ai < ADSETS.length; ai++) {
      const adset = ADSETS[ai];
      const adsetId = `${empresa.id}-camp${ci}-adset${ai}`;
      const adsetMetaId = `${campMetaId}-a${ai}`;
      // Narrativa "atenção": remarketing da Vértice fica ativo mas sem anúncio veiculando.
      const forcarAdsSemAtivo = empresa.status === 'atencao' && ci === 1;
      const adsetStatus = statusPausado ? 'PAUSED' : 'ACTIVE';

      const NADS = ai === 0 ? 2 : 1;
      const adEntidades = [];
      for (let di = 0; di < NADS; di++) {
        const adId = `${empresa.id}-camp${ci}-adset${ai}-ad${di}`;
        const adMetaId = `${adsetMetaId}-d${di}`;
        const fatorAd = camp.peso * adset.peso * (1 / NADS);
        const { lista } = gerarMetricasEntidade(empresa, dias, rng, fatorAd, resultadoChave);

        let status = statusPausado ? 'PAUSED' : forcarAdsSemAtivo ? 'PAUSED' : 'ACTIVE';
        let motivoStatus = null;
        let issues = [];

        const ehAdComIssue = empresa.entidadeComIssue && ci === 0 && ai === 0 && di === 0;
        if (ehAdComIssue) {
          status = empresa.entidadeComIssue.status;
          motivoStatus = empresa.entidadeComIssue.motivoStatus;
          issues = empresa.entidadeComIssue.issues;
        }

        adEntidades.push({
          id: adId, metaId: adMetaId, contaAnuncioId: empresa.contaAnuncioId,
          nome: `Anúncio — Criativo ${di + 1}`, tipo: 'ad', status,
          hierarquia: { campanhaId: campMetaId, adsetId: adsetMetaId },
          ultimaSincronizacao: new Date(Date.now() - faixa(rng, 5, 90) * 60000).toISOString(),
          tsAtual: dataInicio, tsAnterior: null,
          metricas: lista, motivoStatus, issues, dataReferencia,
        });
      }

      const fatorAdset = camp.peso * adset.peso;
      const { lista } = gerarMetricasEntidade(empresa, dias, rng, fatorAdset, resultadoChave);
      adsetEntidades.push({
        id: adsetId, metaId: adsetMetaId, contaAnuncioId: empresa.contaAnuncioId,
        nome: adset.nome, tipo: 'adset', status: adsetStatus,
        hierarquia: { campanhaId: campMetaId, adsetId: null },
        ultimaSincronizacao: new Date(Date.now() - faixa(rng, 5, 90) * 60000).toISOString(),
        tsAtual: dataInicio, tsAnterior: null,
        metricas: lista, motivoStatus: null, issues: [], dataReferencia,
        _filhos: adEntidades,
      });
    }

    const { lista, spendAtual, resultadoAtual } = gerarMetricasEntidade(empresa, dias, rng, camp.peso, resultadoChave);
    const campEntidade = {
      id: campId, metaId: campMetaId, contaAnuncioId: empresa.contaAnuncioId,
      nome: camp.nome, tipo: 'campaign', status: campStatus,
      hierarquia: { campanhaId: null, adsetId: null },
      ultimaSincronizacao: new Date(Date.now() - faixa(rng, 5, 90) * 60000).toISOString(),
      tsAtual: dataInicio, tsAnterior: null,
      metricas: lista, motivoStatus: null, issues: [], dataReferencia,
      _spendAtual: spendAtual, _resultadoAtual: resultadoAtual,
    };

    entidades.push(campEntidade, ...adsetEntidades, ...adsetEntidades.flatMap((a) => a._filhos));
  }

  // remove campos internos de apoio (_filhos) antes de devolver
  return entidades.map(({ _filhos, ...rest }) => rest);
}

function calcularVeredito(empresa, dias, seedSufixo, trend) {
  if (empresa.pausado) return null;
  const rng = criarRng(`${empresa.id}|veredito|${seedSufixo}`);
  const obj = empresa.objetivos[0];
  const { rotulo } = OBJETIVOS[obj.chave];
  const valorAtual = Math.max(1, empresa.baselineResultadoPorDia * dias * faixa(rng, 0.9, 1.1));
  const valorAnterior = valorAtual / trend;
  const deltaPct = Number((((valorAtual - valorAnterior) / valorAnterior) * 100).toFixed(1));
  // Média ponderada com um único objetivo declarado == o próprio delta (peso se cancela).
  const scorePct = deltaPct;
  const direcao = scorePct > 5 ? 'melhorou' : scorePct < -5 ? 'piorou' : 'estavel';
  return {
    direcao,
    scorePct,
    detalhes: [{ ordem: 1, chave: obj.chave, rotulo, valor7d: Math.round(valorAtual), valor7dAnterior: Math.round(valorAnterior), deltaPct }],
  };
}

function gerarMiniResumo(empresa, resumo, resultadoChave) {
  const rotulo = OBJETIVOS[empresa.objetivos[0].chave].rotulo;
  const gasto = Math.round(resumo.gastoHoje ?? 0);
  if (empresa.pausado) {
    return `Nenhuma campanha ativa no momento — a conta está pausada, sem gasto no período selecionado.`;
  }
  const partes = [];
  partes.push(`Gasto de R$ ${gasto.toLocaleString('pt-BR')} no período${resumo.veredito ? `, conta ${resumo.veredito.direcao === 'melhorou' ? 'melhorou' : resumo.veredito.direcao === 'piorou' ? 'piorou' : 'ficou estável'} em ${rotulo} na última semana (${resumo.veredito.scorePct > 0 ? '+' : ''}${resumo.veredito.scorePct}%)` : ''}.`);
  if (resumo.status === 'critico') {
    partes.push(empresa.saldoPrepago?.nivel === 'bloqueado'
      ? 'Atenção: conta bloqueada por saldo insuficiente — campanhas param de veicular até a recarga.'
      : 'Atenção: há um anúncio reprovado pela Meta parado desde ontem, vale revisar.');
  } else if (resumo.status === 'atencao') {
    partes.push('Atenção: a campanha de remarketing está ativa mas sem nenhum anúncio veiculando no momento.');
  } else if (empresa.saldoPrepago?.nivel === 'acabando') {
    partes.push(`Saldo pré-pago baixo, restam cerca de ${Math.round(empresa.saldoPrepago.runwayHoras)}h no ritmo atual.`);
  } else {
    partes.push('Sem pontos de atenção nas últimas 24h.');
  }
  return partes.join(' ');
}

/** Monta o objeto `conta` completo de uma empresa fictícia para um período. */
function gerarConta(empresa, dataInicio, dataFim, overlay) {
  const dias = diasEntre(dataInicio, dataFim);
  const resultadoChave = OBJETIVOS[empresa.objetivos[0].chave].metricaResultado;

  const entidades = construirHierarquia(empresa, dias, dataInicio, dataFim, resultadoChave);
  const campanhas = entidades.filter((e) => e.tipo === 'campaign');

  const gastoHoje = campanhas.reduce((s, c) => s + (c._spendAtual ?? 0), 0);
  const resultadoPeriodo = campanhas.reduce((s, c) => s + (c._resultadoAtual ?? 0), 0);
  const entidadesLimpa = entidades.map(({ _spendAtual, _resultadoAtual, ...rest }) => rest);

  const rngFixo = criarRng(`${empresa.id}|janelas-fixas`);
  const gasto7d  = empresa.pausado ? empresa.baselineSpend7dResidual ?? 0 : empresa.baselineSpend * 7 * faixa(rngFixo, 0.92, 1.08);
  const gasto30d = empresa.pausado ? (empresa.baselineSpend7dResidual ?? 0) * 3 : empresa.baselineSpend * 30 * faixa(rngFixo, 0.9, 1.1);
  const gastoMes = empresa.pausado ? 0 : empresa.baselineSpend * new Date().getDate() * faixa(rngFixo, 0.9, 1.1);
  const gasto30dAnterior = empresa.pausado ? gasto30d * 1.4 : gasto30d / faixa(rngFixo, 0.85, 1.15);

  const veredito = calcularVeredito(empresa, 7, '7d', empresa.trend);
  const veredito30d = calcularVeredito(empresa, 30, '30d', 1 + (empresa.trend - 1) * 0.6);

  const resultadosPeriodo = OBJETIVOS[empresa.objetivos[0].chave]
    ? [{ chave: empresa.objetivos[0].chave, rotulo: OBJETIVOS[empresa.objetivos[0].chave].rotulo, valor: Math.round(resultadoPeriodo) }].filter((r) => r.valor > 0)
    : [];
  if (empresa.objetivos[1]) {
    const chave2 = empresa.objetivos[1].chave;
    const valor2 = Math.round(resultadoPeriodo * 2.4); // objetivo secundário costuma ter volume maior (ex.: cliques)
    if (valor2 > 0) resultadosPeriodo.push({ chave: chave2, rotulo: OBJETIVOS[chave2].rotulo, valor: valor2 });
  }

  const alertasBase = [];
  if (empresa.entidadeComIssue) {
    const adComIssue = entidadesLimpa.find((e) => e.tipo === 'ad' && e.status === empresa.entidadeComIssue.status);
    if (adComIssue) {
      alertasBase.push({
        chave: `${adComIssue.id}:${adComIssue.status}`,
        entidadeId: adComIssue.id,
        tipo: adComIssue.tipo,
        nome: adComIssue.nome,
        status: adComIssue.status,
        motivoStatus: adComIssue.motivoStatus,
        issues: adComIssue.issues,
      });
    }
  }
  const reconhecidos = overlay?.alertasReconhecidos ?? new Set();
  const alertas = alertasBase.filter((a) => !reconhecidos.has(a.chave));

  const saldoPrepago = empresa.prepago && empresa.saldoPrepago
    ? [{
        contaAnuncioId: empresa.contaAnuncioId,
        saldoReais: empresa.saldoPrepago.saldoReais,
        ritmoHora: empresa.saldoPrepago.ritmoHora,
        runwayHoras: empresa.saldoPrepago.runwayHoras,
        nivel: empresa.saldoPrepago.nivel,
        motivoBloqueio: empresa.saldoPrepago.motivoBloqueio,
        atualizadoEm: new Date().toISOString(),
      }]
    : [];

  const perfil = {
    gerenteResponsavel: overlay?.perfil?.gerenteResponsavel ?? empresa.gerenteResponsavel,
    investimentoMensalPlanejado: overlay?.perfil?.investimentoMensalPlanejado !== undefined
      ? overlay.perfil.investimentoMensalPlanejado : empresa.investimentoMensalPlanejado,
    objetivos: overlay?.perfil?.objetivos ?? empresa.objetivos,
    metasPersonalizadas: overlay?.metasPersonalizadas ?? empresa.metasPersonalizadas,
  };

  const resumo = {
    gastoHoje, gasto7d, gasto30d, gasto30dAnterior, gastoMes,
    investimentoMensalPlanejado: perfil.investimentoMensalPlanejado,
    gerenteResponsavel: perfil.gerenteResponsavel,
    veredito, veredito30d, resultadosPeriodo,
    status: empresa.status,
    alertas, saldoPrepago,
  };

  return {
    id: empresa.id,
    nome: empresa.nome,
    identificador: empresa.identificador,
    prepago: empresa.prepago,
    contaAnuncioId: empresa.contaAnuncioId,
    bmId: empresa.bmId,
    metricasSelecionadas: overlay?.metricasSelecionadas ?? [],
    perfil,
    metaConfig: { contasAnuncioIds: overlay?.contasAnuncioIds ?? [empresa.contaAnuncioId] },
    entidades: entidadesLimpa,
    resumo,
    _miniResumo: gerarMiniResumo(empresa, resumo, resultadoChave),
  };
}

function tempoAtras(min) {
  return new Date(Date.now() - min * 60000).toISOString();
}

// Eventos "recentes" (24h) — gerados uma vez por sessão do navegador (módulo
// carregado 1x), assim não mudam a cada refresh automático de 60s.
function gerarEventos() {
  const porNome = Object.fromEntries(EMPRESAS_DEMO.map((e) => [e.id, e.nome]));
  const anomalias = [
    { id: 'demo-anom-1', contaId: 'demo-cedro', metrica: 'ctr', valorAtual: 0.6, baselineMedia: 1.3, magnitudeDesvios: 2.4, direcao: 'queda', detectadaEm: tempoAtras(35), statusProcessamento: 'concluida' },
    { id: 'demo-anom-2', contaId: 'demo-nomade', metrica: 'leads', valorAtual: 0, baselineMedia: 2.1, magnitudeDesvios: 3.1, direcao: 'queda', detectadaEm: tempoAtras(150), statusProcessamento: 'concluida' },
    { id: 'demo-anom-3', contaId: 'demo-aurora', metrica: 'cpm', valorAtual: 52, baselineMedia: 34, magnitudeDesvios: 2.0, direcao: 'aumento', detectadaEm: tempoAtras(410), statusProcessamento: 'concluida' },
  ];
  const investigacoes = [
    { id: 'demo-inv-1', contaId: 'demo-cedro', decidiuNotificar: true, recomendacao: { acao: 'Anúncio reprovado por política — trocar criativo e reenviar para revisão.' }, motivoNaoNotificar: null, inicioEm: tempoAtras(34), fimEm: tempoAtras(33) },
    { id: 'demo-inv-2', contaId: 'demo-nomade', decidiuNotificar: true, recomendacao: { acao: 'Queda de leads coincide com pausa de 2 conjuntos pelo gestor — comportamento esperado, sem ação necessária.' }, motivoNaoNotificar: null, inicioEm: tempoAtras(148), fimEm: tempoAtras(146) },
    { id: 'demo-inv-3', contaId: 'demo-aurora', decidiuNotificar: false, recomendacao: null, motivoNaoNotificar: 'Alta de CPM dentro da variação normal do fim de semana — sem impacto no ROAS.', inicioEm: tempoAtras(408), fimEm: tempoAtras(405) },
  ];
  const notificacoes = [
    { id: 'demo-notif-1', contaId: 'demo-cedro', contaNome: porNome['demo-cedro'], canal: 'whatsapp', conteudo: 'Casa Cedro Móveis: anúncio "Criativo 1" foi reprovado pela Meta (política de antes/depois). Recomendo revisar o criativo e reenviar.', status: 'enviada', enviadaEm: tempoAtras(32) },
    { id: 'demo-notif-2', contaId: 'demo-nomade', contaNome: porNome['demo-nomade'], canal: 'whatsapp', conteudo: 'Nômade Turismo: queda de leads nas últimas 24h coincide com pausa manual de conjuntos — sem ação necessária.', status: 'enviada', enviadaEm: tempoAtras(145) },
  ];
  return { anomalias, investigacoes, notificacoes };
}

const EVENTOS_DEMO = gerarEventos();

export function montarRespostaDashboardData(dataInicio, dataFim, overlayStore) {
  const contasGeradas = EMPRESAS_DEMO.map((empresa) => gerarConta(empresa, dataInicio, dataFim, overlayStore.get(empresa.id)));
  const contas = contasGeradas.map(({ _miniResumo, ...rest }) => rest);
  const totalEntidades = contas.reduce((acc, c) => acc + c.entidades.length, 0);

  return {
    atualizadoEm: new Date().toISOString(),
    periodo: { dataInicio, dataFim },
    usuario: { nome: 'Ambiente demonstrativo', superAdmin: true },
    stats: {
      totalContas: contas.length,
      totalEntidades,
      anomalias24h: EVENTOS_DEMO.anomalias.length,
      investigacoes24h: EVENTOS_DEMO.investigacoes.length,
      notificacoes24h: EVENTOS_DEMO.notificacoes.length,
      errosEnvio24h: 0,
    },
    contas,
    anomalias: EVENTOS_DEMO.anomalias.map((a) => ({ ...a, contaNome: EMPRESAS_DEMO.find((e) => e.id === a.contaId)?.nome ?? null })),
    investigacoes: EVENTOS_DEMO.investigacoes.map((i) => ({ ...i, contaNome: EMPRESAS_DEMO.find((e) => e.id === i.contaId)?.nome ?? null, notificacaoEnviada: i.decidiuNotificar ? true : null })),
    notificacoes: EVENTOS_DEMO.notificacoes,
  };
}

export function gerarMiniResumoConta(contaId, dataInicio, dataFim, overlayStore) {
  const empresa = EMPRESAS_DEMO.find((e) => e.id === contaId);
  if (!empresa) return null;
  const conta = gerarConta(empresa, dataInicio, dataFim, overlayStore.get(contaId));
  return conta._miniResumo;
}

export function contasAnuncioDisponiveis(contaId) {
  const empresa = EMPRESAS_DEMO.find((e) => e.id === contaId);
  if (!empresa) return [];
  return [
    { id: empresa.contaAnuncioId, nome: `${empresa.nome} — Principal` },
    { id: `act_${9000000 + Math.floor(Math.abs(Math.sin(empresa.id.length) * 100000))}`, nome: `${empresa.nome} — Testes` },
  ];
}
