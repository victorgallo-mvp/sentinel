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
import { CATALOGO_METRICAS } from '../../config/metricas.config.js';
import { resolverMetricasEntidade } from '../../config/metricas-por-objetivo.js';

// Métricas acumulativas (somam entre dias); as demais são gauge (média entre dias)
const METRICAS_COUNTER = new Set(
  Object.entries(CATALOGO_METRICAS)
    .filter(([, m]) => m.tipo === 'counter')
    .map(([k]) => k)
);

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
    return Object.fromEntries(
      Object.entries(soma).map(([k, v]) => [
        k,
        METRICAS_COUNTER.has(k) ? v : v / (contagem[k] || 1),
      ])
    );
  }

  const [atual, anterior] = await Promise.all([
    agregarPeriodo(ini, fimEx),
    agregarPeriodo(compIni, compFimEx),
  ]);

  return { atual, anterior };
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
            const { atual, anterior } = await buscarMetricasIntervalo(
              String(entidade._id), dataInicio, dataFim
            );
            const tsAtual   = dataInicio; // referência textual para exibição
            const tsAnterior = null;

            const metricasSelecionadas = conta.configuracoes?.metricasSelecionadas ?? [];
            const metricasEntidade = metricasSelecionadas.length > 0
              ? metricasSelecionadas
              : resolverMetricasEntidade(entidade);
            const metricas = metricasEntidade.map((chave) => {
              const meta = CATALOGO_METRICAS[chave];
              if (!meta || meta.tipo === 'enum') return null;
              const vAtual = atual[chave] ?? null;
              const vAnterior = anterior[chave] ?? null;
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
