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
    const todasContas = await Conta.find({ ativo: true }).lean();
    const contas = req.usuario.superAdmin
      ? todasContas
      : todasContas.filter((c) => req.usuario.contaIds.includes(String(c._id)));
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
              metaId: entidade.metaId,
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

        const [anomalias24hConta, notificacoes24hConta] = await Promise.all([
          Anomalia.countDocuments({ contaId: conta._id, detectadaEm: { $gte: desde24h } }),
          Notificacao.countDocuments({ contaId: conta._id, enviadaEm: { $gte: desde24h }, status: 'enviada' }),
        ]);

        const statusConta = notificacoes24hConta > 0 ? 'critico'
          : anomalias24hConta > 0 ? 'atencao'
          : 'normal';

        return {
          id: String(conta._id),
          nome: conta.nome,
          identificador: conta.identificador,
          entidades: dadosEntidades,
          resumo: {
            gastoHoje,
            anomalias24h: anomalias24hConta,
            notificacoes24h: notificacoes24hConta,
            status: statusConta,
          },
        };
      })
    );

    const [anomalias, investigacoes, notificacoes, errosEnvio] = await Promise.all([
      Anomalia.find({ detectadaEm: { $gte: desde24h } }).sort({ detectadaEm: -1 }).limit(20).lean(),
      Investigacao.find({ inicioEm: { $gte: desde24h } }).sort({ inicioEm: -1 }).limit(10).lean(),
      Notificacao.find({ enviadaEm: { $gte: desde24h }, status: 'enviada' }).sort({ enviadaEm: -1 }).limit(10).lean(),
      Notificacao.countDocuments({ enviadaEm: { $gte: desde24h }, status: 'erro' }),
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

    res.json({
      atualizadoEm: new Date(),
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
        notificacaoEnviada: i.decidiuNotificar ? idsComNotificacaoEnviada.has(String(i._id)) : null,
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
