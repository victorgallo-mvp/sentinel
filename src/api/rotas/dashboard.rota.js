/**
 * Rota pública de leitura para o dashboard externo (Vercel).
 * Autenticação via token simples em query param ou header.
 * Retorna métricas com comparação ao período anterior + anomalias/investigações recentes.
 */
import { Router } from 'express';
import { Conta } from '../../dominio/conta.modelo.js';
import { Entidade } from '../../dominio/entidade.modelo.js';
import { Anomalia } from '../../dominio/anomalia.modelo.js';
import { Investigacao } from '../../dominio/investigacao.modelo.js';
import { Notificacao } from '../../dominio/notificacao.modelo.js';
import { Usuario } from '../../dominio/usuario.modelo.js';
import { query } from '../../infra/postgres.js';
import { config } from '../../config/index.js';
import { CATALOGO_METRICAS, metricaResultado } from '../../config/metricas.config.js';
import { resolverMetricasEntidade } from '../../config/metricas-por-objetivo.js';

// Métricas acumulativas (somam entre dias); as demais são gauge (média entre dias)
const METRICAS_COUNTER = new Set(
  Object.entries(CATALOGO_METRICAS)
    .filter(([, m]) => m.tipo === 'counter')
    .map(([k]) => k)
);

// Razões que devem ser RECALCULADAS a partir dos componentes somados do período
// ([numerador, denominador, fator]) — média ponderada correta, em vez da média
// simples das razões diárias (que pesa igual um dia de muito e um de pouco tráfego).
const RATIOS_RECALCULAVEIS = {
  ctr:                 ['clicks',        'impressions', 100],
  unique_ctr:          ['unique_clicks', 'reach',       100],
  cpc:                 ['spend',         'clicks',      1],
  cpm:                 ['spend',         'impressions', 1000],
  cpp:                 ['spend',         'reach',       1000],
  cost_per_conversion: ['spend',         'conversions', 1],
  conversion_rate:     ['conversions',   'impressions', 100],
  // purchase_roas fica de fora: não guardamos a receita como componente, então
  // não há como recompor de soma÷soma — segue como média (aproximação).
};

// Métricas deduplicadas: NÃO podem ser somadas/mediadas a partir de snapshots
// diários (a Meta deduplica a mesma pessoa entre dias). São coletadas 1×/dia como
// agregado real de 30d (janela_horas=720) e exibidas como bloco fixo "Últimos 30 dias".
const METRICAS_30D = ['frequency', 'reach', 'unique_clicks', 'unique_ctr'];
const JANELA_30D_HORAS = 720;
const JANELA_7D_HORAS = 168;

/**
 * Deriva o custo por resultado do período: gasto ÷ resultado, ambos já somados
 * no intervalo. Tenta o resultado do objetivo e, se não houver, cai para
 * conversões/conversas — assim funciona mesmo quando o objetivo é ambíguo.
 * Retorna null (exibe "—") quando não há resultado para dividir.
 */
function derivarCustoPorResultado(dados, resultadoKey) {
  const gasto = dados?.spend;
  if (gasto == null) return null;
  const candidatos = [resultadoKey, 'conversions', 'messaging_conversations_started'];
  for (const chave of candidatos) {
    const resultado = dados[chave];
    if (resultado && resultado > 0) return Number((gasto / resultado).toFixed(2));
  }
  return null;
}

/**
 * Busca métricas de uma entidade para um intervalo de datas.
 * Para cada dia no intervalo, pega o último snapshot disponível.
 * Counters → soma; Gauges → média.
 * Retorna { atual: {métrica: valor}, anterior: {métrica: valor} }
 * onde "anterior" é o período equivalente imediatamente anterior.
 */
async function buscarMetricasIntervalo(entidadeId, dataInicio, dataFim) {
  const ini  = new Date(dataInicio + 'T00:00:00Z');
  const fim  = new Date(dataFim   + 'T00:00:00Z');
  const fimEx = new Date(fim); fimEx.setUTCDate(fimEx.getUTCDate() + 1); // exclusive

  const diffMs = fim - ini;
  const compFim = new Date(ini); compFim.setUTCDate(compFim.getUTCDate() - 1);
  const compIni = new Date(compFim); compIni.setUTCDate(compIni.getUTCDate() - Math.round(diffMs / 86400000));
  const compFimEx = new Date(ini); // compFim exclusive = ini

  async function agregarPeriodo(desde, ate) {
    const r = await query(
      `WITH dias AS (
         SELECT MAX(coletada_em) AS ts
         FROM metricas_serie_temporal
         WHERE entidade_id = $1 AND janela_horas = 24
           AND coletada_em >= $2 AND coletada_em < $3
         GROUP BY date_trunc('day', coletada_em)
       )
       SELECT m.metrica, m.valor
       FROM metricas_serie_temporal m
       JOIN dias ON m.coletada_em = dias.ts
       WHERE m.entidade_id = $1 AND m.janela_horas = 24`,
      [entidadeId, desde, ate]
    );
    if (!r.rows.length) return {};

    const soma = {}, contagem = {};
    for (const { metrica, valor } of r.rows) {
      soma[metrica]      = (soma[metrica]      ?? 0) + Number(valor);
      contagem[metrica]  = (contagem[metrica]  ?? 0) + 1;
    }
    const resultado = Object.fromEntries(
      Object.entries(soma).map(([k, v]) => [
        k,
        METRICAS_COUNTER.has(k) ? v : v / (contagem[k] || 1),
      ])
    );

    // Recalcula as razões a partir dos componentes somados do período.
    for (const [metrica, [num, den, fator]] of Object.entries(RATIOS_RECALCULAVEIS)) {
      if (soma[den] > 0 && soma[num] != null) {
        resultado[metrica] = (soma[num] / soma[den]) * fator;
      }
    }

    return resultado;
  }

  const [atual, anterior] = await Promise.all([
    agregarPeriodo(ini, fimEx),
    agregarPeriodo(compIni, compFimEx),
  ]);

  return { atual, anterior };
}

/**
 * Lê o último snapshot real de 30 dias (janela_horas=720) das métricas
 * deduplicadas (frequência, alcance, únicos) — coletado 1×/dia direto da Meta,
 * que faz a deduplicação correta entre dias. Retorna {} se ainda não houver coleta.
 */
async function buscarDeduplicadas30d(entidadeId) {
  const r = await query(
    `SELECT DISTINCT ON (metrica) metrica, valor
     FROM metricas_serie_temporal
     WHERE entidade_id = $1 AND janela_horas = $2 AND metrica = ANY($3)
     ORDER BY metrica, coletada_em DESC`,
    [entidadeId, JANELA_30D_HORAS, METRICAS_30D]
  );
  return Object.fromEntries(r.rows.map((row) => [row.metrica, Number(row.valor)]));
}

/**
 * Gasto total de um período (janela_horas: 168=7d, 720=30d) de uma conta — soma o
 * último snapshot de spend APENAS das campanhas (nível campanha já totaliza o dinheiro;
 * somar adset/ad contaria 2-3×). Reaproveita o dado do job diário de períodos.
 */
async function buscarGastoPeriodo(campanhaIds, janelaHoras) {
  if (!campanhaIds?.length) return 0;
  const r = await query(
    `SELECT COALESCE(SUM(s), 0)::float AS total FROM (
       SELECT DISTINCT ON (entidade_id) valor AS s
       FROM metricas_serie_temporal
       WHERE entidade_id = ANY($1) AND metrica = 'spend' AND janela_horas = $2
       ORDER BY entidade_id, coletada_em DESC
     ) x`,
    [campanhaIds, janelaHoras]
  );
  return Number(r.rows[0]?.total ?? 0);
}

export const rotaDashboard = Router();

async function autenticarDashboard(req, res, next) {
  try {
    const token = req.query.token ?? req.headers['x-dashboard-token'];
    if (!token) return res.status(401).json({ erro: 'Token não fornecido' });

    // Env var → super-admin (vê todas as contas)
    if (config.dashboardToken && token === config.dashboardToken) {
      req.usuario = { nome: null, superAdmin: true, contaIds: [] };
      return next();
    }

    // Usuário cadastrado no banco
    const usuario = await Usuario.findOne({ token, ativo: true }).lean();
    if (!usuario) return res.status(401).json({ erro: 'Token inválido' });

    req.usuario = {
      nome:       usuario.nome,
      superAdmin: usuario.superAdmin ?? false,
      contaIds:   (usuario.contaIds ?? []).map(String),
    };
    next();
  } catch (erro) {
    next(erro);
  }
}

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'x-dashboard-token, Content-Type');
}

// Preflight catch-all: responde OPTIONS para qualquer rota do dashboard
rotaDashboard.options('*', (req, res) => {
  corsHeaders(res);
  res.sendStatus(204);
});

const STATUS_CRITICO = new Set(['WITH_ISSUES', 'DISAPPROVED', 'PENDING_BILLING_INFO']);
const STATUS_PAUSADO_SET = new Set(['PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'ARCHIVED', 'DELETED']);

/**
 * Computa o status agregado de uma conta baseado no estado real das entidades.
 * @param {Array} entidades - lista de entidades enriquecidas (com status, issues, tipo)
 * @returns {'critico'|'atencao'|'pausado'|'normal'}
 */
function computarStatusConta(entidades, reconhecidos = new Set()) {
  // critico: qualquer entidade com status problemático ou com issues — exceto as
  // que o usuário já marcou como ciente (mesma chave entidade:status do alerta).
  const temCritico = entidades.some((e) =>
    (STATUS_CRITICO.has(e.status) || (Array.isArray(e.issues) && e.issues.length > 0)) &&
    !reconhecidos.has(`${e.id}:${e.status}`)
  );
  if (temCritico) return 'critico';

  const campanhas = entidades.filter((e) => e.tipo === 'campaign');
  const campanhasAtivas = campanhas.filter((e) => e.status === 'ACTIVE');

  // pausado: nenhuma campanha ativa
  if (campanhas.length > 0 && campanhasAtivas.length === 0) return 'pausado';

  // atencao: campanha ativa mas todos os seus ads (se sincronizados) são não-ACTIVE
  const ads = entidades.filter((e) => e.tipo === 'ad');
  if (ads.length > 0) {
    for (const camp of campanhasAtivas) {
      const adsNaCampanha = ads.filter((ad) => ad.hierarquia?.campanhaId === camp.metaId);
      if (adsNaCampanha.length > 0 && !adsNaCampanha.some((ad) => ad.status === 'ACTIVE')) {
        return 'atencao';
      }
    }
  }

  return 'normal';
}

rotaDashboard.get('/data', autenticarDashboard, async (req, res, next) => {
  corsHeaders(res);
  try {
    const todasContas = await Conta.find({ ativo: true }).lean();
    const contas = req.usuario.superAdmin
      ? todasContas
      : todasContas.filter((c) => req.usuario.contaIds.includes(String(c._id)));
    const desde24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const isoHoje    = new Date().toISOString().slice(0, 10);
    const dataInicio = req.query.dataInicio ?? isoHoje;
    const dataFim    = req.query.dataFim    ?? isoHoje;

    const dadosContas = await Promise.all(
      contas.map(async (conta) => {
        const entidades = await Entidade.find({ contaId: conta._id, 'configuracoes.monitorada': true }).lean();

        const dadosEntidades = await Promise.all(
          entidades.map(async (entidade) => {
            const [{ atual, anterior }, dados30d] = await Promise.all([
              buscarMetricasIntervalo(String(entidade._id), dataInicio, dataFim),
              buscarDeduplicadas30d(String(entidade._id)),
            ]);
            const tsAtual   = dataInicio; // referência textual para exibição
            const tsAnterior = null;

            const metricasSelecionadas = conta.configuracoes?.metricasSelecionadas ?? [];
            const metricasEntidade = metricasSelecionadas.length > 0
              ? metricasSelecionadas
              : resolverMetricasEntidade(entidade);
            const resultadoKey = metricaResultado(entidade.objetivo);
            const metricas = metricasEntidade.map((chave) => {
              const meta = CATALOGO_METRICAS[chave];
              if (!meta || meta.tipo === 'enum') return null;

              // Métricas deduplicadas: valor real de 30d (não respeita o seletor de
              // período); sem comparação por ser um valor fixo que atualiza 1×/dia.
              if (METRICAS_30D.includes(chave)) {
                return {
                  chave,
                  nome: meta.nome,
                  unidade: meta.unidade,
                  direcaoBoa: meta.direcaoBoa,
                  atual: dados30d[chave] ?? null,
                  anterior: null,
                  variacaoPct: null,
                  janela: '30d',
                };
              }

              const vAtual = chave === 'cost_per_result'
                ? derivarCustoPorResultado(atual, resultadoKey)
                : atual[chave] ?? null;
              const vAnterior = chave === 'cost_per_result'
                ? derivarCustoPorResultado(anterior, resultadoKey)
                : anterior[chave] ?? null;
              const variacaoPct =
                vAtual !== null && vAnterior !== null && vAnterior !== 0
                  ? Number((((vAtual - vAnterior) / vAnterior) * 100).toFixed(1))
                  : null;
              return {
                chave,
                nome: meta.nome,
                unidade: meta.unidade,
                direcaoBoa: meta.direcaoBoa,
                atual: vAtual,
                anterior: vAnterior,
                variacaoPct,
                janela: 'periodo',
              };
            }).filter(Boolean);

            return {
              id: String(entidade._id),
              metaId: entidade.metaId,
              contaAnuncioId: entidade.hierarquia?.contaAnuncioId ?? null,
              nome: entidade.nome,
              tipo: entidade.tipo,
              status: entidade.status ?? 'ACTIVE',
              hierarquia: {
                campanhaId: entidade.hierarquia?.campanhaId ?? null,
                adsetId: entidade.hierarquia?.adsetId ?? null,
              },
              ultimaSincronizacao: entidade.ultimaSincronizacaoEm ?? null,
              tsAtual: dataInicio,
              tsAnterior: null,
              metricas,
              motivoStatus: entidade.motivoStatus ?? null,
              issues: entidade.issues ?? [],
              dataReferencia: dataInicio === dataFim
                ? new Date(dataInicio + 'T12:00:00Z').toLocaleDateString('pt-BR')
                : `${new Date(dataInicio + 'T12:00:00Z').toLocaleDateString('pt-BR')} – ${new Date(dataFim + 'T12:00:00Z').toLocaleDateString('pt-BR')}`,
            };
          })
        );

        // Spend total das campanhas no período selecionado
        const gastoPeriodo = dadosEntidades
          .filter((e) => e.tipo === 'campaign')
          .reduce((sum, e) => sum + (e.metricas.find((m) => m.chave === 'spend')?.atual ?? 0), 0);

        // Gasto real de 7d e 30d (snapshots do job de períodos, nível campanha)
        const campanhaIds = entidades.filter((e) => e.tipo === 'campaign').map((e) => String(e._id));
        const [gasto7d, gasto30d] = await Promise.all([
          buscarGastoPeriodo(campanhaIds, JANELA_7D_HORAS),
          buscarGastoPeriodo(campanhaIds, JANELA_30D_HORAS),
        ]);

        // Alertas: entidades com status crítico. Cada alerta tem uma `chave` estável
        // (entidade + status) para o usuário marcar como "ciente" no dashboard.
        const STATUS_ALERTAS = new Set(['WITH_ISSUES', 'DISAPPROVED', 'PENDING_BILLING_INFO']);
        const reconhecidos = new Set(
          (conta.configuracoes?.alertasReconhecidos ?? []).map((a) => a.chave)
        );
        const alertas = dadosEntidades
          .filter((e) => STATUS_ALERTAS.has(e.status) || e.issues?.length > 0)
          .map((e) => ({
            chave: `${e.id}:${e.status}`,
            entidadeId: e.id,
            tipo: e.tipo,
            nome: e.nome,
            status: e.status,
            motivoStatus: e.motivoStatus,
            issues: e.issues ?? [],
          }))
          .filter((a) => !reconhecidos.has(a.chave));

        // Status agregado: alertas reconhecidos não pesam (usuário já está ciente)
        const statusConta = computarStatusConta(dadosEntidades, reconhecidos);

        // Saldo pré-pago: snapshot persistido pelo job horário de orçamento
        const saldoPrepago = conta.configuracoes?.prepago
          ? (conta.saldoPrepago ?? []).map((s) => ({
              contaAnuncioId: s.contaAnuncioId,
              saldoReais: s.saldoReais ?? null,
              ritmoHora: s.ritmoHora ?? null,
              runwayHoras: s.runwayHoras ?? null,
              nivel: s.nivel ?? null,
              motivoBloqueio: s.motivoBloqueio ?? null,
              atualizadoEm: s.atualizadoEm ?? null,
            }))
          : [];

        return {
          id: String(conta._id),
          nome: conta.nome,
          identificador: conta.identificador,
          prepago: conta.configuracoes?.prepago ?? false,
          metricasSelecionadas: conta.configuracoes?.metricasSelecionadas ?? [],
          entidades: dadosEntidades,
          resumo: {
            gastoHoje: gastoPeriodo,
            gasto7d,
            gasto30d,
            status: statusConta,
            alertas,
            saldoPrepago,
          },
        };
      })
    );

    const idsContas = contas.map((c) => c._id);

    const [anomalias, investigacoes, notificacoes, errosEnvio] = await Promise.all([
      Anomalia.find({ contaId: { $in: idsContas }, detectadaEm: { $gte: desde24h } }).sort({ detectadaEm: -1 }).limit(20).lean(),
      Investigacao.find({ contaId: { $in: idsContas }, inicioEm: { $gte: desde24h } }).sort({ inicioEm: -1 }).limit(10).lean(),
      Notificacao.find({ contaId: { $in: idsContas }, enviadaEm: { $gte: desde24h }, status: 'enviada' }).sort({ enviadaEm: -1 }).limit(10).lean(),
      Notificacao.countDocuments({ contaId: { $in: idsContas }, enviadaEm: { $gte: desde24h }, status: 'erro' }),
    ]);

    // Verifica quais investigações que decidiram notificar geraram uma Notificacao real
    const idsDecidiramNotificar = investigacoes.filter((i) => i.decidiuNotificar).map((i) => i._id);
    const notificacoesDeInvestigacao = idsDecidiramNotificar.length > 0
      ? await Notificacao.find({
          $or: [
            { investigacaoId: { $in: idsDecidiramNotificar } },
            { investigacaoIds: { $in: idsDecidiramNotificar } },
          ],
          status: { $ne: 'erro' },
        }).select('investigacaoId investigacaoIds').lean()
      : [];
    const idsComNotificacaoEnviada = new Set(
      notificacoesDeInvestigacao
        .flatMap((n) => [n.investigacaoId, ...(n.investigacaoIds ?? [])])
        .filter(Boolean)
        .map(String)
    );

    const totalEntidades = dadosContas.reduce((acc, c) => acc + c.entidades.length, 0);

    // Mapa contaId → nome para enriquecer eventos
    const nomeConta = new Map(contas.map((c) => [String(c._id), c.nome]));

    res.json({
      atualizadoEm: new Date(),
      periodo: { dataInicio, dataFim },
      usuario: { nome: req.usuario.nome, superAdmin: req.usuario.superAdmin },
      stats: {
        totalContas: contas.length,
        totalEntidades,
        anomalias24h: anomalias.length,
        investigacoes24h: investigacoes.length,
        notificacoes24h: notificacoes.length,
        errosEnvio24h: errosEnvio,
      },
      contas: dadosContas,
      anomalias: anomalias.map((a) => ({
        id: String(a._id),
        contaNome: nomeConta.get(String(a.contaId)) ?? null,
        metrica: a.metrica,
        valorAtual: a.valorAtual,
        valorEsperado: a.baselineMedia,
        desvio: a.magnitudeDesvios,
        direcao: a.direcao,
        detectadaEm: a.detectadaEm,
        statusProcessamento: a.statusProcessamento,
      })),
      investigacoes: investigacoes.map((i) => ({
        id: String(i._id),
        contaNome: nomeConta.get(String(i.contaId)) ?? null,
        decidiuNotificar: i.decidiuNotificar,
        notificacaoEnviada: i.decidiuNotificar ? idsComNotificacaoEnviada.has(String(i._id)) : null,
        recomendacao: i.recomendacao ?? null,
        motivoNaoNotificar: i.motivoNaoNotificar ?? null,
        inicioEm: i.inicioEm,
        fimEm: i.fimEm ?? null,
      })),
      notificacoes: notificacoes.map((n) => ({
        id: String(n._id),
        contaNome: nomeConta.get(String(n.contaId)) ?? null,
        canal: n.canal,
        conteudo: n.conteudo,
        status: n.status,
        enviadaEm: n.enviadaEm,
      })),
    });
  } catch (erro) {
    next(erro);
  }
});

// ── Catálogo de métricas disponíveis ──────────────────────────────────────
rotaDashboard.get('/metricas/catalogo', autenticarDashboard, (req, res) => {
  corsHeaders(res);
  const catalogo = Object.entries(CATALOGO_METRICAS)
    .filter(([, m]) => m.tipo !== 'enum')
    .map(([chave, m]) => ({ chave, nome: m.nome, unidade: m.unidade, nivel: m.nivel }));
  res.json({ catalogo });
});

// ── Seleção de métricas por conta ─────────────────────────────────────────
rotaDashboard.patch('/contas/:contaId/metricas', autenticarDashboard, async (req, res, next) => {
  corsHeaders(res);
  try {
    const { contaId } = req.params;
    const { metricasSelecionadas } = req.body;

    if (!Array.isArray(metricasSelecionadas)) {
      return res.status(400).json({ erro: 'metricasSelecionadas deve ser um array' });
    }

    const chaveValidas = new Set(Object.keys(CATALOGO_METRICAS));
    const validas = metricasSelecionadas.filter((k) => chaveValidas.has(k));

    const conta = await Conta.findById(contaId).lean();
    if (!conta) return res.status(404).json({ erro: 'Conta não encontrada' });

    if (!req.usuario.superAdmin && !req.usuario.contaIds.includes(contaId)) {
      return res.status(403).json({ erro: 'Sem permissão para esta conta' });
    }

    await Conta.findByIdAndUpdate(contaId, { 'configuracoes.metricasSelecionadas': validas });
    res.json({ ok: true, metricasSelecionadas: validas });
  } catch (erro) {
    next(erro);
  }
});

// ── Reconhecer / desfazer alertas de entrega ("marcar ciente") ─────────────
// body: { chave: string, reconhecer?: boolean }  (reconhecer=false desfaz)
rotaDashboard.patch('/contas/:contaId/alertas', autenticarDashboard, async (req, res, next) => {
  corsHeaders(res);
  try {
    const { contaId } = req.params;
    const { chave, reconhecer = true } = req.body;

    if (!chave || typeof chave !== 'string') {
      return res.status(400).json({ erro: 'chave do alerta é obrigatória' });
    }

    const conta = await Conta.findById(contaId).lean();
    if (!conta) return res.status(404).json({ erro: 'Conta não encontrada' });

    if (!req.usuario.superAdmin && !req.usuario.contaIds.includes(contaId)) {
      return res.status(403).json({ erro: 'Sem permissão para esta conta' });
    }

    if (reconhecer) {
      // Adiciona sem duplicar (remove a chave antiga e reinsere com timestamp atual)
      await Conta.findByIdAndUpdate(contaId, {
        $pull: { 'configuracoes.alertasReconhecidos': { chave } },
      });
      await Conta.findByIdAndUpdate(contaId, {
        $push: { 'configuracoes.alertasReconhecidos': { chave, reconhecidoEm: new Date() } },
      });
    } else {
      await Conta.findByIdAndUpdate(contaId, {
        $pull: { 'configuracoes.alertasReconhecidos': { chave } },
      });
    }

    res.json({ ok: true, chave, reconhecido: Boolean(reconhecer) });
  } catch (erro) {
    next(erro);
  }
});
