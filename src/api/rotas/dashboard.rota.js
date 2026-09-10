/**
 * Rota de leitura para o dashboard externo (Vercel).
 * Autenticação por e-mail + senha: `POST /dashboard/login` devolve um token de
 * sessão assinado, enviado nas demais rotas em `Authorization: Bearer <token>`.
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
import { logger } from '../../infra/logger.js';
import { config } from '../../config/index.js';
import { CATALOGO_METRICAS, metricaResultado, metricaResultadoEntidade } from '../../config/metricas.config.js';
import { resolverMetricasEntidade } from '../../config/metricas-por-objetivo.js';
import { OBJETIVOS, objetivoValido, resolverObjetivosConta } from '../../config/objetivos.config.js';
import { buscarGastoMes, buscarGasto30dAnterior, computarVeredito, computarVeredito30d } from '../../core/analise/veredito.servico.js';
import { montarDadosResumoBm } from '../../core/relatorio/resumo-diario.servico.js';
import { redigirMiniResumo } from '../../core/relatorio/resumo-diario.agente.js';
import { listarContasAnuncio } from '../../core/coleta/meta-api.cliente.js';
import { verificarSenha } from '../../core/auth/senha.js';
import { emitirSessao, verificarSessao, extrairTokenSessao } from '../../core/auth/sessao.js';

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
const METRICAS_NATIVAS_ROAS = [
  'purchase_roas', 'website_purchase_roas', 'purchase_revenue', 'website_purchase_revenue',
];

/**
 * Agrega as linhas diárias de UMA entidade num período.
 * Counters somam; gauges viram média; as razões são recalculadas a partir dos
 * componentes somados. `nativo` sobrepõe ROAS/receita com o snapshot da Meta.
 */
export function agregarLinhasPeriodo(linhas, nativo = {}) {
  if (!linhas.length) return {};

  const soma = {}, contagem = {};
  for (const { metrica, valor } of linhas) {
    soma[metrica]     = (soma[metrica]     ?? 0) + Number(valor);
    contagem[metrica] = (contagem[metrica] ?? 0) + 1;
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

  // ROAS: 1 dia = valor real da Meta (correto). Multi-dia NÃO pode ser média das
  // ROAS diárias (dias de gasto baixo + uma venda inflam pra 300x+). Recompõe de
  // Σreceita/Σgasto quando houver receita coletada; senão OMITE (evita número errado).
  for (const [roasKey, revKey] of [['purchase_roas', 'purchase_revenue'], ['website_purchase_roas', 'website_purchase_revenue']]) {
    if (soma[roasKey] === undefined) continue;
    const dias = contagem[roasKey] ?? 0;
    if (dias <= 1) {
      resultado[roasKey] = soma[roasKey]; // 1 dia: soma == o valor daquele dia
    } else if (soma[revKey] > 0 && soma['spend'] > 0) {
      resultado[roasKey] = soma[revKey] / soma['spend'];
    } else {
      resultado[roasKey] = null; // multi-dia sem receita: não exibir a média inflada
    }
  }

  for (const [metrica, valor] of Object.entries(nativo)) resultado[metrica] = valor;

  return resultado;
}

/**
 * Snapshot nativo da Meta (janela 168h/720h) de ROAS e receita, para várias
 * entidades. Elimina o drift do denominador (spend) causado por gaps de coleta.
 */
async function buscarNativoLote(entidadeIds, janelaHoras) {
  const mapa = new Map();
  if (entidadeIds.length === 0) return mapa;

  const r = await query(
    `SELECT DISTINCT ON (entidade_id, metrica) entidade_id, metrica, valor::float
     FROM metricas_serie_temporal
     WHERE entidade_id = ANY($1) AND janela_horas = $2 AND metrica = ANY($3)
     ORDER BY entidade_id, metrica, coletada_em DESC`,
    [entidadeIds, janelaHoras, METRICAS_NATIVAS_ROAS]
  );

  for (const row of r.rows) {
    if (!mapa.has(row.entidade_id)) mapa.set(row.entidade_id, {});
    mapa.get(row.entidade_id)[row.metrica] = Number(row.valor);
  }
  return mapa;
}

/** Agrega um período para VÁRIAS entidades numa única consulta. */
async function agregarPeriodoLote(entidadeIds, desde, ate) {
  const r = await query(
    `WITH dias AS (
       SELECT entidade_id, MAX(coletada_em) AS ts
       FROM metricas_serie_temporal
       WHERE entidade_id = ANY($1) AND janela_horas = 24
         AND coletada_em >= $2 AND coletada_em < $3
       GROUP BY entidade_id, date_trunc('day', coletada_em AT TIME ZONE 'America/Sao_Paulo')
     )
     SELECT m.entidade_id, m.metrica, m.valor
     FROM metricas_serie_temporal m
     JOIN dias ON m.entidade_id = dias.entidade_id AND m.coletada_em = dias.ts
     WHERE m.janela_horas = 24`,
    [entidadeIds, desde, ate]
  );

  const linhasPorEntidade = new Map();
  for (const row of r.rows) {
    if (!linhasPorEntidade.has(row.entidade_id)) linhasPorEntidade.set(row.entidade_id, []);
    linhasPorEntidade.get(row.entidade_id).push(row);
  }

  // Para períodos de ~7d ou ~30d o agregado nativo da Meta é sempre exato.
  const diffDias = Math.round((ate - desde) / 86400000);
  const janelaNativa = diffDias >= 6 && diffDias <= 8 ? 168 : diffDias >= 28 && diffDias <= 32 ? 720 : null;
  const nativoPorEntidade = janelaNativa
    ? await buscarNativoLote([...linhasPorEntidade.keys()], janelaNativa)
    : new Map();

  const resultado = new Map();
  for (const [id, linhas] of linhasPorEntidade) {
    resultado.set(id, agregarLinhasPeriodo(linhas, nativoPorEntidade.get(id) ?? {}));
  }
  return resultado;
}

/**
 * Métricas do período escolhido e do período equivalente anterior, para VÁRIAS
 * entidades de uma vez. Para cada dia no intervalo pega o último snapshot.
 *
 * É deliberadamente em lote: são duas consultas para o dashboard inteiro, não
 * uma por entidade. Com milhares de entidades monitoradas, o formato anterior
 * (3 a 5 consultas cada) esgotava o pool de conexões antes de terminar e a rota
 * morria em "timeout exceeded when trying to connect".
 *
 * @returns {Map<string, {atual: Object, anterior: Object}>} indexado por entidadeId
 */
async function buscarMetricasIntervaloLote(entidadeIds, dataInicio, dataFim) {
  const porEntidade = new Map();
  if (entidadeIds.length === 0) return porEntidade;

  // T03:00:00Z = meia-noite BRT (UTC-3). Cada "data" do filtro corresponde ao dia BRT.
  const ini  = new Date(dataInicio + 'T03:00:00Z');
  const fim  = new Date(dataFim   + 'T03:00:00Z');
  const fimEx = new Date(fim); fimEx.setUTCDate(fimEx.getUTCDate() + 1); // exclusive

  const diffMs = fim - ini;
  const compFim = new Date(ini); compFim.setUTCDate(compFim.getUTCDate() - 1);
  const compIni = new Date(compFim); compIni.setUTCDate(compIni.getUTCDate() - Math.round(diffMs / 86400000));
  const compFimEx = new Date(ini); // compFim exclusive = ini

  const [atual, anterior] = await Promise.all([
    agregarPeriodoLote(entidadeIds, ini, fimEx),
    agregarPeriodoLote(entidadeIds, compIni, compFimEx),
  ]);

  for (const id of entidadeIds) {
    porEntidade.set(id, { atual: atual.get(id) ?? {}, anterior: anterior.get(id) ?? {} });
  }
  return porEntidade;
}

/**
 * Último snapshot real de 30 dias (janela_horas=720) das métricas deduplicadas
 * (frequência, alcance, únicos) — coletado 1×/dia direto da Meta, que faz a
 * deduplicação correta entre dias. Em lote, pelo mesmo motivo acima.
 *
 * @returns {Map<string, Object>} indexado por entidadeId; ausente = sem coleta
 */
async function buscarDeduplicadas30dLote(entidadeIds) {
  const mapa = new Map();
  if (entidadeIds.length === 0) return mapa;

  const r = await query(
    `SELECT DISTINCT ON (entidade_id, metrica) entidade_id, metrica, valor
     FROM metricas_serie_temporal
     WHERE entidade_id = ANY($1) AND janela_horas = $2 AND metrica = ANY($3)
     ORDER BY entidade_id, metrica, coletada_em DESC`,
    [entidadeIds, JANELA_30D_HORAS, METRICAS_30D]
  );

  for (const row of r.rows) {
    if (!mapa.has(row.entidade_id)) mapa.set(row.entidade_id, {});
    mapa.get(row.entidade_id)[row.metrica] = Number(row.valor);
  }
  return mapa;
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
    const token = extrairTokenSessao(req);
    if (!token) return res.status(401).json({ erro: 'Sessão não fornecida', codigo: 'SEM_SESSAO' });

    const sessao = verificarSessao(token);
    if (!sessao) return res.status(401).json({ erro: 'Sessão inválida ou expirada', codigo: 'SESSAO_INVALIDA' });

    const usuario = await Usuario.findOne({ _id: sessao.sub, ativo: true }).lean();
    if (!usuario) return res.status(401).json({ erro: 'Sessão inválida ou expirada', codigo: 'SESSAO_INVALIDA' });

    req.usuario = {
      id:         String(usuario._id),
      nome:       usuario.nome,
      email:      usuario.email,
      superAdmin: usuario.superAdmin ?? false,
      contaIds:   (usuario.contaIds ?? []).map(String),
    };
    next();
  } catch (erro) {
    next(erro);
  }
}

// Freio simples de força bruta: tentativas falhas por e-mail, em memória.
const MAX_TENTATIVAS = 5;
const JANELA_BLOQUEIO_MS = 15 * 60 * 1000;
const tentativasLogin = new Map(); // email -> { falhas, ate }

function loginBloqueado(email) {
  const registro = tentativasLogin.get(email);
  if (!registro) return false;
  if (Date.now() > registro.ate) { tentativasLogin.delete(email); return false; }
  return registro.falhas >= MAX_TENTATIVAS;
}

function registrarFalhaLogin(email) {
  const registro = tentativasLogin.get(email);
  const base = registro && Date.now() <= registro.ate ? registro.falhas : 0;
  tentativasLogin.set(email, { falhas: base + 1, ate: Date.now() + JANELA_BLOQUEIO_MS });
}

/** POST /dashboard/login — troca e-mail + senha por um token de sessão. */
rotaDashboard.post('/login', async (req, res, next) => {
  corsHeaders(res);
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const senha = String(req.body?.senha ?? '');

    if (!email || !senha) {
      return res.status(400).json({ erro: 'Informe e-mail e senha' });
    }

    if (loginBloqueado(email)) {
      return res.status(429).json({ erro: 'Muitas tentativas. Tente novamente em alguns minutos.' });
    }

    const usuario = await Usuario.findOne({ email, ativo: true }).select('+senhaHash').lean();
    const senhaOk = usuario ? await verificarSenha(senha, usuario.senhaHash) : false;

    if (!usuario || !senhaOk) {
      registrarFalhaLogin(email);
      logger.warn({ msg: 'Login de dashboard recusado', email });
      return res.status(401).json({ erro: 'E-mail ou senha inválidos' });
    }

    tentativasLogin.delete(email);
    await Usuario.updateOne({ _id: usuario._id }, { $set: { ultimoLoginEm: new Date() } });

    const { token, expiraEm } = emitirSessao(usuario._id);
    logger.info({ msg: 'Login de dashboard', usuarioId: String(usuario._id), email });

    res.json({
      token,
      expiraEm,
      usuario: {
        nome:       usuario.nome,
        email:      usuario.email,
        superAdmin: usuario.superAdmin ?? false,
      },
    });
  } catch (erro) {
    next(erro);
  }
});

/** GET /dashboard/eu — valida a sessão guardada no navegador. */
rotaDashboard.get('/eu', autenticarDashboard, (req, res) => {
  corsHeaders(res);
  res.json({
    usuario: {
      nome:       req.usuario.nome,
      email:      req.usuario.email,
      superAdmin: req.usuario.superAdmin,
    },
  });
});

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
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
    const isoHoje    = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10); // data BRT
    const dataInicio = req.query.dataInicio ?? isoHoje;
    const dataFim    = req.query.dataFim    ?? isoHoje;

    // Uma leitura de métricas para TODAS as entidades visíveis, e não uma por
    // entidade: com milhares de entidades monitoradas, o formato por entidade
    // esgotava o pool de conexões do Postgres antes de a resposta ficar pronta.
    const todasEntidades = await Entidade.find({
      contaId: { $in: contas.map((c) => c._id) },
      'configuracoes.monitorada': true,
    }).lean();

    const entidadesPorConta = new Map(contas.map((c) => [String(c._id), []]));
    for (const entidade of todasEntidades) {
      entidadesPorConta.get(String(entidade.contaId))?.push(entidade);
    }

    const idsEntidades = todasEntidades.map((e) => String(e._id));
    const [metricasPorEntidade, dedupPorEntidade] = await Promise.all([
      buscarMetricasIntervaloLote(idsEntidades, dataInicio, dataFim),
      buscarDeduplicadas30dLote(idsEntidades),
    ]);

    const dadosContas = await Promise.all(
      contas.map(async (conta) => {
        const entidades = entidadesPorConta.get(String(conta._id)) ?? [];

        const dadosEntidades = await Promise.all(
          entidades.map(async (entidade) => {
            const { atual, anterior } =
              metricasPorEntidade.get(String(entidade._id)) ?? { atual: {}, anterior: {} };
            const dados30d = dedupPorEntidade.get(String(entidade._id)) ?? {};
            const tsAtual   = dataInicio; // referência textual para exibição
            const tsAnterior = null;

            const metricasSelecionadas = conta.configuracoes?.metricasSelecionadas ?? [];
            const metricasEntidade = metricasSelecionadas.length > 0
              ? metricasSelecionadas
              : resolverMetricasEntidade(entidade);
            const resultadoKey = metricaResultadoEntidade(entidade);
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
              // usado internamente para gastoPeriodo e resultadosPeriodo; removido antes do envio
              _rawAtual: entidade.tipo === 'campaign' ? atual : null,
            };
          })
        );

        // Campanhas com dados brutos para cálculos de resumo
        const campanhas = dadosEntidades.filter((e) => e.tipo === 'campaign');

        // Fix: gasto do período via dado bruto, sem depender de metricasSelecionadas
        const gastoPeriodo = campanhas.reduce((sum, e) => sum + (e._rawAtual?.spend ?? 0), 0);

        // Resultado de cada objetivo no período selecionado (period-aware)
        const objetivosConta = resolverObjetivosConta(conta.perfil);
        const resultadosPeriodo = objetivosConta
          .map((obj) => {
            const valor = campanhas.reduce((sum, e) => sum + (e._rawAtual?.[obj.metricaResultado] ?? 0), 0);
            return { chave: obj.chave, rotulo: obj.rotulo, valor };
          })
          .filter((r) => r.valor > 0);

        // Gasto real de 7d, 30d, mês corrente + comparativo 30d + vereditos
        const campanhaIds = entidades.filter((e) => e.tipo === 'campaign').map((e) => String(e._id));
        const [gasto7d, gasto30d, gastoMes, gasto30dAnterior, veredito, veredito30d] = await Promise.all([
          buscarGastoPeriodo(campanhaIds, JANELA_7D_HORAS),
          buscarGastoPeriodo(campanhaIds, JANELA_30D_HORAS),
          buscarGastoMes(campanhaIds),
          buscarGasto30dAnterior(campanhaIds),
          computarVeredito(campanhaIds, conta.perfil),
          computarVeredito30d(campanhaIds, conta.perfil),
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

        // Saldo pré-pago: snapshot persistido pelo job horário de orçamento.
        // Filtra pelas contas de anúncio vinculadas HOJE — o snapshot de uma
        // conta desvinculada continua no array e apareceria como saldo zerado.
        const contasAnuncioVinculadas = new Set(conta.metaConfig?.contasAnuncioIds ?? []);
        const saldoPrepago = conta.configuracoes?.prepago
          ? (conta.saldoPrepago ?? [])
            .filter((s) => contasAnuncioVinculadas.has(s.contaAnuncioId))
            .map((s) => ({
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
          contaAnuncioId: conta.metaConfig?.contasAnuncioIds?.[0] ?? null,
          bmId: conta.metaConfig?.bmId ?? null,
          metricasSelecionadas: conta.configuracoes?.metricasSelecionadas ?? [],
          perfil: {
            gerenteResponsavel: conta.perfil?.gerenteResponsavel ?? '',
            investimentoMensalPlanejado: conta.perfil?.investimentoMensalPlanejado ?? null,
            objetivos: (conta.perfil?.objetivos ?? []).map((o) => ({ ordem: o.ordem, chave: o.chave })),
            metasPersonalizadas: conta.perfil?.metasPersonalizadas ?? [],
          },
          metaConfig: {
            contasAnuncioIds: conta.metaConfig?.contasAnuncioIds ?? [],
          },
          entidades: dadosEntidades.map(({ _rawAtual: _, ...rest }) => rest),
          resumo: {
            gastoHoje: gastoPeriodo,
            gasto7d,
            gasto30d,
            gasto30dAnterior,
            gastoMes,
            investimentoMensalPlanejado: conta.perfil?.investimentoMensalPlanejado ?? null,
            gerenteResponsavel: conta.perfil?.gerenteResponsavel ?? '',
            veredito,
            veredito30d,
            resultadosPeriodo,
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
        contaId: String(n.contaId),
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

// ── Objetivos de negócio disponíveis (para o onboarding) ───────────────────
rotaDashboard.get('/objetivos/catalogo', autenticarDashboard, (req, res) => {
  corsHeaders(res);
  const catalogo = Object.entries(OBJETIVOS).map(([chave, o]) => ({ chave, nome: o.nome }));
  res.json({ catalogo });
});

// ── Perfil da conta (onboarding): gerente, investimento mensal, objetivos ──
// body: { gerenteResponsavel?, investimentoMensalPlanejado?, objetivos?: [{ordem,chave}] }
rotaDashboard.patch('/contas/:contaId/perfil', autenticarDashboard, async (req, res, next) => {
  corsHeaders(res);
  try {
    const { contaId } = req.params;
    const { gerenteResponsavel, investimentoMensalPlanejado, objetivos } = req.body;

    const conta = await Conta.findById(contaId).lean();
    if (!conta) return res.status(404).json({ erro: 'Conta não encontrada' });
    if (!req.usuario.superAdmin && !req.usuario.contaIds.includes(contaId)) {
      return res.status(403).json({ erro: 'Sem permissão para esta conta' });
    }

    const set = {};
    if (gerenteResponsavel !== undefined) {
      set['perfil.gerenteResponsavel'] = String(gerenteResponsavel ?? '').slice(0, 120);
    }
    if (investimentoMensalPlanejado !== undefined) {
      const v = Number(investimentoMensalPlanejado);
      set['perfil.investimentoMensalPlanejado'] = Number.isFinite(v) && v > 0 ? v : null;
    }
    if (objetivos !== undefined) {
      if (!Array.isArray(objetivos)) return res.status(400).json({ erro: 'objetivos deve ser um array' });
      // Valida chaves, ordena por ordem, no máximo 3, sem chave repetida.
      const vistos = new Set();
      const validos = objetivos
        .filter((o) => o && objetivoValido(o.chave) && [1, 2, 3].includes(Number(o.ordem)))
        .filter((o) => (vistos.has(o.chave) ? false : vistos.add(o.chave)))
        .sort((a, b) => a.ordem - b.ordem)
        .slice(0, 3)
        .map((o) => ({ ordem: Number(o.ordem), chave: o.chave }));
      set['perfil.objetivos'] = validos;
    }

    if (Object.keys(set).length === 0) {
      return res.status(400).json({ erro: 'nada para atualizar' });
    }

    await Conta.findByIdAndUpdate(contaId, { $set: set });
    const atualizada = await Conta.findById(contaId).select('perfil').lean();
    res.json({ ok: true, perfil: atualizada.perfil });
  } catch (erro) {
    next(erro);
  }
});

// ── Métricas disponíveis para metas personalizadas ──────────────────────────
// Subconjunto curado do catálogo: apenas métricas numéricas que fazem sentido
// como threshold de alerta (excluir derivadas sem snapshot e métricas de entrega pura).
const METRICAS_ALERTAVEIS_META = [
  { chave: 'purchase_roas',         nome: 'ROAS de compra',      unidade: 'multiplier', operadorPadrao: 'acima_de',  janelas: ['7d', '30d'] },
  { chave: 'website_purchase_roas', nome: 'ROAS de compra (site)',unidade: 'multiplier', operadorPadrao: 'acima_de',  janelas: ['7d', '30d'] },
  { chave: 'ctr',                   nome: 'CTR',                  unidade: 'percent',    operadorPadrao: 'acima_de',  janelas: ['1d', '7d']  },
  { chave: 'cpm',                   nome: 'CPM',                  unidade: 'currency',   operadorPadrao: 'abaixo_de', janelas: ['1d', '7d']  },
  { chave: 'cpc',                   nome: 'CPC',                  unidade: 'currency',   operadorPadrao: 'abaixo_de', janelas: ['1d', '7d']  },
  { chave: 'frequency',             nome: 'Frequência 30d',       unidade: 'decimal',    operadorPadrao: 'abaixo_de', janelas: ['30d']       },
  { chave: 'leads',                 nome: 'Leads',                unidade: 'integer',    operadorPadrao: 'acima_de',  janelas: ['1d', '7d']  },
  { chave: 'conversions',           nome: 'Conversões',           unidade: 'integer',    operadorPadrao: 'acima_de',  janelas: ['1d', '7d']  },
  { chave: 'messaging_conversations_started', nome: 'Conversas WPP', unidade: 'integer', operadorPadrao: 'acima_de', janelas: ['1d', '7d'] },
];

rotaDashboard.get('/metricas/catalogo-metas', autenticarDashboard, (req, res) => {
  corsHeaders(res);
  res.json({ metricas: METRICAS_ALERTAVEIS_META });
});

// ── Contas de anúncio disponíveis na BM (para seleção de monitoramento) ─────
rotaDashboard.get('/contas/:contaId/contas-anuncio', autenticarDashboard, async (req, res, next) => {
  corsHeaders(res);
  try {
    const { contaId } = req.params;
    if (!req.usuario.superAdmin && !req.usuario.contaIds.includes(contaId)) {
      return res.status(403).json({ erro: 'Sem permissão para esta conta' });
    }
    const conta = await Conta.findById(contaId).lean();
    if (!conta) return res.status(404).json({ erro: 'Conta não encontrada' });

    const { bmId, systemUserToken, contasAnuncioIds } = conta.metaConfig;
    const selecionadas = new Set(contasAnuncioIds ?? []);

    const disponiveis = await listarContasAnuncio(bmId, systemUserToken);
    const resultado = disponiveis.map((c) => ({ ...c, selecionada: selecionadas.has(c.id) }));
    res.json({ contas: resultado });
  } catch (erro) {
    next(erro);
  }
});

// ── Atualizar contas de anúncio monitoradas ───────────────────────────────────
// body: { contasAnuncioIds: string[] }
rotaDashboard.patch('/contas/:contaId/contas-anuncio', autenticarDashboard, async (req, res, next) => {
  corsHeaders(res);
  try {
    const { contaId } = req.params;
    if (!req.usuario.superAdmin && !req.usuario.contaIds.includes(contaId)) {
      return res.status(403).json({ erro: 'Sem permissão para esta conta' });
    }
    const conta = await Conta.findById(contaId).lean();
    if (!conta) return res.status(404).json({ erro: 'Conta não encontrada' });

    const { contasAnuncioIds } = req.body;
    if (!Array.isArray(contasAnuncioIds) || contasAnuncioIds.length === 0) {
      return res.status(400).json({ erro: 'contasAnuncioIds deve ser um array não-vazio' });
    }
    const ids = contasAnuncioIds.map(String).filter(Boolean);
    await Conta.findByIdAndUpdate(contaId, {
      $set: { 'metaConfig.contasAnuncioIds': ids },
      // Descarta o snapshot de saldo das contas que saíram: sem isso ele fica
      // órfão no array e o dashboard mostra o saldo de uma conta que não é mais
      // monitorada (tipicamente zerado, porque foi esgotada antes de trocar).
      $pull: { saldoPrepago: { contaAnuncioId: { $nin: ids } } },
    });
    res.json({ ok: true, contasAnuncioIds: ids });
  } catch (erro) {
    next(erro);
  }
});

// ── Metas personalizadas da conta ─────────────────────────────────────────────
// body: { metasPersonalizadas: [{metrica, operador, valor, janela, ativo}] }
rotaDashboard.patch('/contas/:contaId/metas', autenticarDashboard, async (req, res, next) => {
  corsHeaders(res);
  try {
    const { contaId } = req.params;
    if (!req.usuario.superAdmin && !req.usuario.contaIds.includes(contaId)) {
      return res.status(403).json({ erro: 'Sem permissão para esta conta' });
    }
    const conta = await Conta.findById(contaId).lean();
    if (!conta) return res.status(404).json({ erro: 'Conta não encontrada' });

    const { metasPersonalizadas } = req.body;
    if (!Array.isArray(metasPersonalizadas)) {
      return res.status(400).json({ erro: 'metasPersonalizadas deve ser um array' });
    }

    const chavesValidas = new Set(METRICAS_ALERTAVEIS_META.map((m) => m.chave));
    const validas = metasPersonalizadas
      .filter((m) => m && chavesValidas.has(m.metrica) && ['abaixo_de', 'acima_de'].includes(m.operador))
      .filter((m) => Number.isFinite(Number(m.valor)) && Number(m.valor) > 0)
      .map((m) => ({
        metrica:  m.metrica,
        operador: m.operador,
        valor:    Number(m.valor),
        janela:   ['1d', '7d', '30d'].includes(m.janela) ? m.janela : '7d',
        ativo:    m.ativo !== false,
      }));

    await Conta.findByIdAndUpdate(contaId, { $set: { 'perfil.metasPersonalizadas': validas } });
    res.json({ ok: true, metasPersonalizadas: validas });
  } catch (erro) {
    next(erro);
  }
});

// ── Mini-resumo (IA) da conta para a visão geral — gerado sob demanda ──────
rotaDashboard.get('/contas/:contaId/mini-resumo', autenticarDashboard, async (req, res, next) => {
  corsHeaders(res);
  try {
    const { contaId } = req.params;
    if (!req.usuario.superAdmin && !req.usuario.contaIds.includes(contaId)) {
      return res.status(403).json({ erro: 'Sem permissão para esta conta' });
    }
    const conta = await Conta.findById(contaId);
    if (!conta) return res.status(404).json({ erro: 'Conta não encontrada' });

    const dados = await montarDadosResumoBm([conta]);
    if (!dados) return res.json({ texto: null });

    if (!config.iaResumoDiarioAtivo) return res.json({ texto: null });
    try {
      const { texto } = await redigirMiniResumo(dados);
      res.json({ texto: texto || null });
    } catch (erro) {
      logger.warn({ msg: 'Falha ao gerar mini-resumo', contaId, erro: erro.message });
      res.json({ texto: null });
    }
  } catch (erro) {
    next(erro);
  }
});
