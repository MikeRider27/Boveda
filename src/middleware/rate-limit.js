import { tooManyRequests } from '../lib/errors.js';

/**
 * Rate limit de ventana fija en memoria. Es por réplica: con N réplicas el límite
 * efectivo es N×max. Para escalar horizontalmente, sustituir el Map por Redis
 * (INCR + EXPIRE) manteniendo esta misma interfaz.
 */
export function rateLimit({ windowMs, max, key = (req) => req.ip }) {
  const hits = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, entry] of hits) if (entry.resetAt <= now) hits.delete(k);
  }, windowMs);
  sweep.unref();

  return (req, res, next) => {
    const now = Date.now();
    const k = key(req);
    let entry = hits.get(k);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(k, entry);
    }
    entry.count++;
    res.setHeader('RateLimit-Limit', max);
    res.setHeader('RateLimit-Remaining', Math.max(0, max - entry.count));
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      throw tooManyRequests();
    }
    next();
  };
}
