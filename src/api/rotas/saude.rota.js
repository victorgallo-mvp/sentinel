/**
 * Rota de health check — usada por monitoramento externo (Railway, uptime checks).
 */
import { Router } from 'express';

export const rotaSaude = Router();

rotaSaude.get('/', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
