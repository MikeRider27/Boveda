import { forbidden } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Defensa en profundidad contra CSRF, además de SameSite=Lax en la cookie:
 * 1. Las mutaciones exigen una cabecera propia; un formulario de otro sitio no puede
 *    enviarla y un fetch cross-origin dispararía un preflight CORS que no aceptamos.
 * 2. Si el navegador envía Origin, debe coincidir con nuestro host.
 */
export function csrfGuard(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.get('x-requested-with') !== 'boveda') throw forbidden('Falta la cabecera anti-CSRF');
  const origin = req.get('origin');
  if (origin) {
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      throw forbidden('Origin inválido');
    }
    if (host !== req.get('host')) throw forbidden('Origin no permitido');
  }
  next();
}
