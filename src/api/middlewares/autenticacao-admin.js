/**
 * Middleware de autenticação das rotas administrativas.
 * Exige o header `Authorization: Bearer <ADMIN_TOKEN>`.
 */
import { config } from '../../config/index.js';

export function autenticarAdmin(req, res, next) {
  if (!config.adminToken) {
    return res.status(503).json({ erro: 'ADMIN_TOKEN não configurado no servidor' });
  }

  const cabecalho = req.headers.authorization ?? '';
  const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : null;

  if (token !== config.adminToken) {
    return res.status(401).json({ erro: 'Não autorizado' });
  }

  next();
}
