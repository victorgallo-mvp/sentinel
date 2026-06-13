/**
 * Rotas administrativas relacionadas ao loop de feedback: sugestões de
 * ajuste de sensibilidade baseadas no histórico de feedback recebido.
 * Montada sob `/admin/feedback` (protegida por `autenticarAdmin`).
 */
import { Router } from 'express';
import { sugerirAjustesSensibilidade, aplicarAjusteSensibilidade } from '../../core/feedback/ajustador-sensibilidade.servico.js';
import { logger } from '../../infra/logger.js';

export const rotaFeedback = Router();

/** GET /admin/feedback/sugestoes-sensibilidade?contaId=...&dias=14 */
rotaFeedback.get('/sugestoes-sensibilidade', async (req, res, next) => {
  try {
    const { contaId, dias } = req.query;
    if (!contaId) {
      return res.status(400).json({ erro: 'contaId é obrigatório' });
    }

    const sugestoes = await sugerirAjustesSensibilidade(contaId, dias ? Number(dias) : undefined);
    res.json({ sugestoes });
  } catch (erro) {
    next(erro);
  }
});

/** POST /admin/feedback/sugestoes-sensibilidade/aplicar { entidadeId, novaSensibilidade } */
rotaFeedback.post('/sugestoes-sensibilidade/aplicar', async (req, res, next) => {
  try {
    const { entidadeId, novaSensibilidade } = req.body;
    if (!entidadeId || typeof novaSensibilidade !== 'number') {
      return res.status(400).json({ erro: 'entidadeId e novaSensibilidade (número) são obrigatórios' });
    }

    await aplicarAjusteSensibilidade(entidadeId, novaSensibilidade);
    logger.info({ msg: 'Ajuste de sensibilidade aplicado via API admin', entidadeId, novaSensibilidade });
    res.json({ sucesso: true });
  } catch (erro) {
    next(erro);
  }
});
