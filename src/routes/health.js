import { Router } from 'express';
import { pool } from '../db/pool.js';

export const healthRouter = Router();

let draining = false;
export function startDraining() {
  draining = true;
}

// Liveness: el proceso responde. No toca la BD para que un fallo de Postgres
// no provoque que Kubernetes reinicie todas las réplicas en cascada.
healthRouter.get('/healthz', (_req, res) => {
  res.json({ status: 'ok' });
});

// Readiness: puede recibir tráfico (BD accesible y sin apagado en curso).
healthRouter.get('/readyz', async (_req, res) => {
  if (draining) return res.status(503).json({ status: 'draining' });
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'db_unavailable' });
  }
});
