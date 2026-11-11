import { randomUUID } from 'node:crypto';
import { logger } from '../lib/logger.js';

const QUIET_PATHS = new Set(['/healthz', '/readyz']);

/** Asigna un request id (propagado desde el proxy si es válido) y registra cada respuesta. */
export function requestContext(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && /^[\w-]{1,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.id);

  const start = process.hrtime.bigint();
  res.on('finish', () => {
    if (QUIET_PATHS.has(req.path)) return;
    logger.info('request', {
      id: req.id,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      ms: Math.round(Number(process.hrtime.bigint() - start) / 1e5) / 10,
      user: req.user?.id,
    });
  });
  next();
}
