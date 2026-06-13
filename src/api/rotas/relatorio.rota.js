/**
 * Rota pública de visualização de relatórios semanais — usada pelo link
 * enviado via WhatsApp (`enviarRelatorioWhatsapp`).
 */
import { Router } from 'express';
import { Relatorio } from '../../dominio/relatorio.modelo.js';
import { logger } from '../../infra/logger.js';

export const rotaRelatorio = Router();

/** Retorna o HTML do relatório gerado, pra visualização no navegador. */
rotaRelatorio.get('/:id', async (req, res) => {
  try {
    const relatorio = await Relatorio.findById(req.params.id);

    if (!relatorio || !relatorio.conteudoHtml) {
      return res.status(404).send('Relatório não encontrado.');
    }

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(relatorio.conteudoHtml);
  } catch (erro) {
    logger.error({ msg: 'Erro ao carregar relatório', relatorioId: req.params.id, erro: erro.message });
    res.status(500).send('Erro ao carregar relatório.');
  }
});
