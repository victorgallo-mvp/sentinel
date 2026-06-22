/**
 * Rotas administrativas — gestão de contas/entidades, consulta de
 * anomalias/investigações/notificações, estatísticas e disparo manual
 * de jobs (coleta, baselines, relatório). Protegidas por `autenticarAdmin`.
 */
import { Router } from 'express';
import { z } from 'zod';
import { Conta } from '../../dominio/conta.modelo.js';
import { Entidade } from '../../dominio/entidade.modelo.js';
import { Anomalia } from '../../dominio/anomalia.modelo.js';
import { Investigacao } from '../../dominio/investigacao.modelo.js';
import { Notificacao } from '../../dominio/notificacao.modelo.js';
import { Relatorio } from '../../dominio/relatorio.modelo.js';
import { coletarMetricasConta } from '../../core/coleta/coletor-metricas.servico.js';
import { sincronizarEntidades } from '../../core/coleta/descobridor-entidades.servico.js';
import { calcularBaselinesConta } from '../../core/deteccao/calculador-baseline.servico.js';
import { gerarRelatorioSemanal, enviarRelatorioWhatsapp } from '../../core/relatorio/gerador-semanal.servico.js';
import { ErroNaoEncontrado, ErroValidacao } from '../../shared/erros.js';
import { logger } from '../../infra/logger.js';

export const rotaAdmin = Router();

const CAMPOS_SENSIVEIS_CONTA = '-metaConfig.systemUserToken -metaConfig.appSecret';

// ===== Contas =====

const esquemaNovaConta = z.object({
  identificador: z.string().min(1),
  nome: z.string().min(1),
  metaConfig: z.object({
    bmId: z.string().min(1),
    contasAnuncioIds: z.array(z.string()).default([]),
    systemUserToken: z.string().min(1),
    appId: z.string().min(1),
    appSecret: z.string().min(1),
  }),
  notificacao: z
    .object({
      canalPrimario: z.enum(['whatsapp', 'email', 'telegram']).optional(),
      whatsappJid: z.string().optional(),
      horarioPermitidoInicio: z.string().optional(),
      horarioPermitidoFim: z.string().optional(),
      diasUteis: z.array(z.number()).optional(),
    })
    .optional(),
  configuracoes: z
    .object({
      intervaloColetaMinutos: z.number().optional(),
      sensibilidadePadrao: z.number().optional(),
      limiteCustoDiarioUsd: z.number().optional(),
      diasHistoricoBaseline: z.number().optional(),
      googleSheetsId: z.string().optional(),
    })
    .optional(),
});

/** GET /admin/contas */
rotaAdmin.get('/contas', async (req, res, next) => {
  try {
    const contas = await Conta.find().select(CAMPOS_SENSIVEIS_CONTA).sort({ nome: 1 });
    res.json({ contas });
  } catch (erro) {
    next(erro);
  }
});

/** POST /admin/contas */
rotaAdmin.post('/contas', async (req, res, next) => {
  try {
    const dados = esquemaNovaConta.parse(req.body);
    const conta = await Conta.create(dados);
    logger.info({ msg: 'Conta criada via API admin', contaId: String(conta._id), identificador: conta.identificador });

    const { metaConfig, ...resto } = conta.toObject();
    res.status(201).json({ conta: { ...resto, metaConfig: { bmId: metaConfig.bmId, contasAnuncioIds: metaConfig.contasAnuncioIds } } });
  } catch (erro) {
    if (erro instanceof z.ZodError) {
      return next(new ErroValidacao('Dados inválidos para criação de conta', erro.flatten()));
    }
    next(erro);
  }
});

const esquemaPatchConta = z.object({
  configuracoes: z.object({
    intervaloColetaMinutos: z.number().optional(),
    sensibilidadePadrao: z.number().optional(),
    limiteCustoDiarioUsd: z.number().optional(),
    diasHistoricoBaseline: z.number().optional(),
    googleSheetsId: z.string().optional(),
    prepago: z.boolean().optional(),
    limiarAlertaSaldoReais: z.number().optional(),
  }),
});

/** PATCH /admin/contas/:id — atualiza configurações gerais da conta */
rotaAdmin.patch('/contas/:id', async (req, res, next) => {
  try {
    const dados = esquemaPatchConta.parse(req.body);
    const atualizacoes = {};
    for (const [chave, valor] of Object.entries(dados.configuracoes)) {
      atualizacoes[`configuracoes.${chave}`] = valor;
    }

    const conta = await Conta.findByIdAndUpdate(req.params.id, { $set: atualizacoes }, { new: true }).select(CAMPOS_SENSIVEIS_CONTA);
    if (!conta) throw new ErroNaoEncontrado(`Conta ${req.params.id} não encontrada`);

    logger.info({ msg: 'Conta atualizada via API admin', contaId: req.params.id, atualizacoes });
    res.json({ conta });
  } catch (erro) {
    if (erro instanceof z.ZodError) {
      return next(new ErroValidacao('Dados inválidos para atualização de conta', erro.flatten()));
    }
    next(erro);
  }
});

// ===== Entidades =====

const esquemaPatchEntidade = z.object({
  monitorada: z.boolean().optional(),
  sensibilidadeCustom: z.number().nullable().optional(),
  metricasIgnoradas: z.array(z.string()).optional(),
  metricasPrioritarias: z.array(z.string()).optional(),
});

/** GET /admin/entidades?contaId=&tipo=&monitorada= */
rotaAdmin.get('/entidades', async (req, res, next) => {
  try {
    const { contaId, tipo, monitorada } = req.query;
    const filtro = {};
    if (contaId) filtro.contaId = contaId;
    if (tipo) filtro.tipo = tipo;
    if (monitorada !== undefined) filtro['configuracoes.monitorada'] = monitorada === 'true';

    const entidades = await Entidade.find(filtro).sort({ nome: 1 });
    res.json({ entidades });
  } catch (erro) {
    next(erro);
  }
});

/** PATCH /admin/entidades/:id — atualiza configurações de monitoramento da entidade */
rotaAdmin.patch('/entidades/:id', async (req, res, next) => {
  try {
    const dados = esquemaPatchEntidade.parse(req.body);
    const atualizacoes = {};
    if (dados.monitorada !== undefined) atualizacoes['configuracoes.monitorada'] = dados.monitorada;
    if (dados.sensibilidadeCustom !== undefined) atualizacoes['configuracoes.sensibilidadeCustom'] = dados.sensibilidadeCustom;
    if (dados.metricasIgnoradas !== undefined) atualizacoes['configuracoes.metricasIgnoradas'] = dados.metricasIgnoradas;
    if (dados.metricasPrioritarias !== undefined) atualizacoes['configuracoes.metricasPrioritarias'] = dados.metricasPrioritarias;

    const entidade = await Entidade.findByIdAndUpdate(req.params.id, { $set: atualizacoes }, { new: true });
    if (!entidade) throw new ErroNaoEncontrado(`Entidade ${req.params.id} não encontrada`);

    logger.info({ msg: 'Entidade atualizada via API admin', entidadeId: req.params.id, atualizacoes });
    res.json({ entidade });
  } catch (erro) {
    if (erro instanceof z.ZodError) {
      return next(new ErroValidacao('Dados inválidos para atualização de entidade', erro.flatten()));
    }
    next(erro);
  }
});

// ===== Anomalias =====

/** GET /admin/anomalias?contaId=&entidadeId=&status=&limite= */
rotaAdmin.get('/anomalias', async (req, res, next) => {
  try {
    const { contaId, entidadeId, status, limite } = req.query;
    const filtro = {};
    if (contaId) filtro.contaId = contaId;
    if (entidadeId) filtro.entidadeId = entidadeId;
    if (status) filtro.statusProcessamento = status;

    const anomalias = await Anomalia.find(filtro)
      .sort({ detectadaEm: -1 })
      .limit(Math.min(Number(limite) || 50, 200));

    res.json({ anomalias });
  } catch (erro) {
    next(erro);
  }
});

// ===== Investigações =====

/** GET /admin/investigacoes/:id */
rotaAdmin.get('/investigacoes/:id', async (req, res, next) => {
  try {
    const investigacao = await Investigacao.findById(req.params.id);
    if (!investigacao) throw new ErroNaoEncontrado(`Investigação ${req.params.id} não encontrada`);

    res.json({ investigacao });
  } catch (erro) {
    next(erro);
  }
});

// ===== Notificações =====

/** GET /admin/notificacoes?contaId=&status=&limite= */
rotaAdmin.get('/notificacoes', async (req, res, next) => {
  try {
    const { contaId, status, limite } = req.query;
    const filtro = {};
    if (contaId) filtro.contaId = contaId;
    if (status) filtro.status = status;

    const notificacoes = await Notificacao.find(filtro)
      .sort({ enviadaEm: -1 })
      .limit(Math.min(Number(limite) || 50, 200));

    res.json({ notificacoes });
  } catch (erro) {
    next(erro);
  }
});

// ===== Estatísticas =====

/** GET /admin/estatisticas?contaId= */
rotaAdmin.get('/estatisticas', async (req, res, next) => {
  try {
    const { contaId } = req.query;
    const filtroConta = contaId ? { contaId } : {};

    const desde7Dias = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const desde30Dias = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [totalContasAtivas, totalEntidadesMonitoradas, anomalias7d, investigacoes7d, notificacoes7d, custoInvestigacoes30d, custoRelatorios30d] = await Promise.all([
      Conta.countDocuments({ ativo: true }),
      Entidade.countDocuments({ ...filtroConta, 'configuracoes.monitorada': true }),
      Anomalia.countDocuments({ ...filtroConta, detectadaEm: { $gte: desde7Dias } }),
      Investigacao.countDocuments({ ...filtroConta, inicioEm: { $gte: desde7Dias } }),
      Notificacao.countDocuments({ ...filtroConta, enviadaEm: { $gte: desde7Dias } }),
      Investigacao.aggregate([{ $match: { ...filtroConta, criadoEm: { $gte: desde30Dias } } }, { $group: { _id: null, total: { $sum: '$custoTokensUsd' } } }]),
      Relatorio.aggregate([{ $match: { ...filtroConta, criadoEm: { $gte: desde30Dias } } }, { $group: { _id: null, total: { $sum: '$custoTokensUsd' } } }]),
    ]);

    res.json({
      totalContasAtivas,
      totalEntidadesMonitoradas,
      ultimos7Dias: {
        anomaliasDetectadas: anomalias7d,
        investigacoesRealizadas: investigacoes7d,
        notificacoesEnviadas: notificacoes7d,
      },
      custoUltimos30Dias: {
        investigacoesUsd: custoInvestigacoes30d[0]?.total ?? 0,
        relatoriosUsd: custoRelatorios30d[0]?.total ?? 0,
      },
    });
  } catch (erro) {
    next(erro);
  }
});

// ===== Disparo manual de jobs =====

/** POST /admin/disparar/coleta { contaId } */
rotaAdmin.post('/disparar/coleta', async (req, res, next) => {
  try {
    const { contaId } = req.body;
    if (!contaId) return res.status(400).json({ erro: 'contaId é obrigatório' });

    res.status(202).json({ disparado: true, job: 'coleta', contaId });

    coletarMetricasConta(contaId).catch((erro) => {
      logger.error({ msg: 'Erro ao disparar coleta manualmente via API admin', contaId, erro: erro.message });
    });
  } catch (erro) {
    next(erro);
  }
});

/** POST /admin/disparar/baselines { contaId } */
rotaAdmin.post('/disparar/baselines', async (req, res, next) => {
  try {
    const { contaId } = req.body;
    if (!contaId) return res.status(400).json({ erro: 'contaId é obrigatório' });

    res.status(202).json({ disparado: true, job: 'baselines', contaId });

    calcularBaselinesConta(contaId).catch((erro) => {
      logger.error({ msg: 'Erro ao disparar cálculo de baselines manualmente via API admin', contaId, erro: erro.message });
    });
  } catch (erro) {
    next(erro);
  }
});

/** POST /admin/disparar/sincronizar-entidades { contaId } */
rotaAdmin.post('/disparar/sincronizar-entidades', async (req, res, next) => {
  try {
    const { contaId } = req.body;
    if (!contaId) return res.status(400).json({ erro: 'contaId é obrigatório' });

    res.status(202).json({ disparado: true, job: 'sincronizar-entidades', contaId });

    (async () => {
      const conta = await Conta.findById(contaId);
      if (!conta) return;

      for (const contaAnuncioId of conta.metaConfig.contasAnuncioIds) {
        try {
          const resultado = await sincronizarEntidades(contaId, conta.metaConfig.bmId, contaAnuncioId, { token: conta.metaConfig.systemUserToken });
          logger.info({ msg: 'Sincronização de entidades concluída (disparo manual)', contaId, contaAnuncioId, ...resultado });
        } catch (erro) {
          logger.error({ msg: 'Erro ao disparar sincronização de entidades manualmente via API admin', contaId, contaAnuncioId, erro: erro.message });
        }
      }
    })();
  } catch (erro) {
    next(erro);
  }
});

/** POST /admin/disparar/relatorio { contaId } */
rotaAdmin.post('/disparar/relatorio', async (req, res, next) => {
  try {
    const { contaId } = req.body;
    if (!contaId) return res.status(400).json({ erro: 'contaId é obrigatório' });

    res.status(202).json({ disparado: true, job: 'relatorio', contaId });

    (async () => {
      try {
        const relatorio = await gerarRelatorioSemanal(contaId);
        const conta = await Conta.findById(contaId);
        await enviarRelatorioWhatsapp(relatorio, conta);
      } catch (erro) {
        logger.error({ msg: 'Erro ao disparar relatório manualmente via API admin', contaId, erro: erro.message });
      }
    })();
  } catch (erro) {
    next(erro);
  }
});
