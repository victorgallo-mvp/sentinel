/**
 * Monta o servidor Express: rotas públicas (saúde, webhook, relatórios) e
 * rotas administrativas protegidas por token.
 */
import express from 'express';
import { rotaSaude } from './rotas/saude.rota.js';
import { rotaAdmin } from './rotas/admin.rota.js';
import { rotaFeedback } from './rotas/feedback.rota.js';
import { rotaRelatorio } from './rotas/relatorio.rota.js';
import { rotaDashboard } from './rotas/dashboard.rota.js';
import { receberWebhookEvolution } from './webhooks/evolution.controller.js';
import { autenticarAdmin } from './middlewares/autenticacao-admin.js';
import { logger } from '../infra/logger.js';
import {
  ErroValidacao,
  ErroNaoEncontrado,
  ErroLimiteCustoExcedido,
  ErroMetaApi,
  ErroAnthropicApi,
  ErroTool,
  ErroAplicacao,
} from '../shared/erros.js';

/** Cria e configura a instância do app Express (sem chamar `.listen`). */
export function criarServidor() {
  const app = express();

  app.use(express.json());

  app.use((req, res, next) => {
    logger.debug({ msg: 'Requisição recebida', metodo: req.method, caminho: req.path });
    next();
  });

  app.use('/dashboard', rotaDashboard);
  app.use('/saude', rotaSaude);
  app.post('/webhooks/evolution', receberWebhookEvolution);
  app.use('/relatorios', rotaRelatorio);

  app.use('/admin/feedback', autenticarAdmin, rotaFeedback);
  app.use('/admin', autenticarAdmin, rotaAdmin);

  app.use((req, res) => {
    res.status(404).json({ erro: 'Rota não encontrada' });
  });

  app.use((erro, req, res, next) => {
    if (res.headersSent) return next(erro);

    const status = mapearStatusHttp(erro);

    if (status >= 500) {
      logger.error({ msg: 'Erro não tratado na API', erro: erro.message, stack: erro.stack, caminho: req.path });
    } else {
      logger.warn({ msg: 'Erro de requisição', erro: erro.message, codigo: erro.codigo, caminho: req.path });
    }

    res.status(status).json({
      erro: erro.message,
      codigo: erro.codigo ?? 'ERRO_INTERNO',
      detalhes: erro.detalhes ?? undefined,
    });
  });

  return app;
}

/** Mapeia o tipo de erro de aplicação pro status HTTP correspondente. */
function mapearStatusHttp(erro) {
  if (erro instanceof ErroValidacao) return 400;
  if (erro instanceof ErroNaoEncontrado) return 404;
  if (erro instanceof ErroLimiteCustoExcedido) return 429;
  if (erro instanceof ErroMetaApi || erro instanceof ErroAnthropicApi || erro instanceof ErroTool) return 502;
  if (erro instanceof ErroAplicacao) return 400;
  return 500;
}
