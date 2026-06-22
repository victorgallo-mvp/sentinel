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
import { query } from '../../infra/postgres.js';
import { config } from '../../config/index.js';
import { CATALOGO_METRICAS } from '../../config/metricas.config.js';
import { resolverMetricasEntidade } from '../../config/metricas-por-objetivo.js';

export const rotaDashboard = Router();

function autenticarDashboard(req, res, next) {
  const token = req.query.token ?? req.headers['x-dashboard-token'];
  if (!config.dashboardToken || token !== config.dashboardToken) {
    return res.status(401).json({ erro: 'Token inválido' });
  }
  next();
}

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'x-dashboard-token, Content-Type');
}

rotaDashboard.options('/data', (req, res) => {
  corsHeaders(res);
  res.sendStatus(204);
});

rotaDashboard.get('/data', autenticarDashboard, async (req, res, next) => {
  corsHeaders(res);
  try {
    const contas = await Conta.find({ ativo: true }).lean();
    const desde24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const dadosContas = await Promise.all(
      contas.map(async (conta) => {
        const entidades = await Entidade.find({ contaId: conta._id, 'configuracoes.monitorada': true }).lean();

        const dadosEntidades = await Promise.all(
          entidades.map(async (entidade) => {
            const tsRes = await query(
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

            const metricasEntidade = resolverMetricasEntidade(entidade);
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
              nome: entidade.nome,
              tipo: entidade.tipo,
              ultimaSincronizacao: entidade.ultimaSincronizacaoEm ?? null,
              tsAtual: tsAtual ?? null,
              tsAnterior: tsAnterior ?? null,
              metricas,
            };
          })
        );

        return {
          id: String(conta._id),
          nome: conta.nome,
          identificador: conta.identificador,
          entidades: dadosEntidades,
        };
      })
    );

    const [anomalias, investigacoes, notificacoes] = await Promise.all([
      Anomalia.find({ detectadaEm: { $gte: desde24h } }).sort({ detectadaEm: -1 }).limit(20).lean(),
      Investigacao.find({ inicioEm: { $gte: desde24h } }).sort({ inicioEm: -1 }).limit(10).lean(),
      Notificacao.find({ enviadaEm: { $gte: desde24h } }).sort({ enviadaEm: -1 }).limit(10).lean(),
    ]);

    const totalEntidades = dadosContas.reduce((acc, c) => acc + c.entidades.length, 0);

    res.json({
      atualizadoEm: new Date(),
      stats: {
        totalContas: contas.length,
        totalEntidades,
        anomalias24h: anomalias.length,
        investigacoes24h: investigacoes.length,
        notificacoes24h: notificacoes.length,
      },
      contas: dadosContas,
      anomalias: anomalias.map((a) => ({
        id: String(a._id),
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
        decidiuNotificar: i.decidiuNotificar,
        recomendacao: i.recomendacao ?? null,
        motivoNaoNotificar: i.motivoNaoNotificar ?? null,
        inicioEm: i.inicioEm,
        fimEm: i.fimEm ?? null,
      })),
      notificacoes: notificacoes.map((n) => ({
        id: String(n._id),
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
