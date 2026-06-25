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
function computarStatusConta(entidades) {
  // critico: qualquer entidade com status problemático ou com issues
  const temCritico = entidades.some((e) =>
    STATUS_CRITICO.has(e.status) || (Array.isArray(e.issues) && e.issues.length > 0)
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
    const periodo = req.query.periodo ?? 'hoje'; // 'hoje' | 'ontem'

    const dadosContas = await Promise.all(
      contas.map(async (conta) => {
        const entidades = await Entidade.find({ contaId: conta._id, 'configuracoes.monitorada': true }).lean();

        const dadosEntidades = await Promise.all(
          entidades.map(async (entidade) => {
            const tsRes = periodo === 'ontem'
              ? await query(
                  `SELECT DISTINCT coletada_em FROM metricas_serie_temporal
                   WHERE entidade_id = $1 AND janela_horas = 24
                   AND coletada_em < date_trunc('day', NOW())
                   ORDER BY coletada_em DESC LIMIT 2`,
                  [String(entidade._id)]
                )
              : await query(
                  `SELECT DISTINCT coletada_em FROM metricas_serie_temporal
                   WHERE entidade_id = $1 AND janela_horas = 24
                   ORDER BY coletada_em DESC LIMIT 2`,
                  [String(entidade._id)]
                );

            const [tsAtual, tsAnterior] = tsRes.rows.map((r) => r.coletada_em);

            async function buscarMetricas(ts) {
              if (!ts) return {};
              const r = await query(
                `SELECT metrica, valor FROM metricas_serie_temporal
                 WHERE entidade_id = $1 AND janela_horas = 24 AND coletada_em = $2`,
                [String(entidade._id), ts]
              );
              return Object.fromEntries(r.rows.map((row) => [row.metrica, Number(row.valor)]));
            }

            const [atual, anterior] = await Promise.all([buscarMetricas(tsAtual), buscarMetricas(tsAnterior)]);

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
              tsAtual: tsAtual ?? null,
              tsAnterior: tsAnterior ?? null,
              metricas,
              motivoStatus: entidade.motivoStatus ?? null,
              issues: entidade.issues ?? [],
              dataReferencia: tsAtual ? new Date(tsAtual).toLocaleDateString('pt-BR') : null,
            };
          })
        );

        // Resumo por conta: spend de campanhas do dia corrente (UTC).
        // Se a última coleta da entidade não for de hoje, contribui 0 — evita exibir
        // gasto de dias anteriores como se fosse o gasto atual.
        const hojeUtcInicio = new Date();
        hojeUtcInicio.setUTCHours(0, 0, 0, 0);
        const gastoHoje = dadosEntidades
          .filter((e) => e.tipo === 'campaign')
          .filter((e) => e.tsAtual && new Date(e.tsAtual) >= hojeUtcInicio)
          .reduce((sum, e) => sum + (e.metricas.find((m) => m.chave === 'spend')?.atual ?? 0), 0);

        const statusConta = computarStatusConta(dadosEntidades);

        // Alertas: entidades com status crítico
        const STATUS_ALERTAS = new Set(['WITH_ISSUES', 'DISAPPROVED', 'PENDING_BILLING_INFO']);
        const alertas = dadosEntidades
          .filter((e) => STATUS_ALERTAS.has(e.status) || e.issues?.length > 0)
          .map((e) => ({ tipo: e.tipo, nome: e.nome, status: e.status, motivoStatus: e.motivoStatus }));

        return {
          id: String(conta._id),
          nome: conta.nome,
          identificador: conta.identificador,
          metricasSelecionadas: conta.configuracoes?.metricasSelecionadas ?? [],
          entidades: dadosEntidades,
          resumo: {
            gastoHoje,
            status: statusConta,
            alertas,
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
          investigacaoId: { $in: idsDecidiramNotificar },
          status: { $ne: 'erro' },
        }).select('investigacaoId').lean()
      : [];
    const idsComNotificacaoEnviada = new Set(notificacoesDeInvestigacao.map((n) => String(n.investigacaoId)));

    const totalEntidades = dadosContas.reduce((acc, c) => acc + c.entidades.length, 0);

    // Mapa contaId → nome para enriquecer eventos
    const nomeConta = new Map(contas.map((c) => [String(c._id), c.nome]));

    res.json({
      atualizadoEm: new Date(),
      periodo,
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
