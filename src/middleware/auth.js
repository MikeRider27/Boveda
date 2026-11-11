import { config } from '../config.js';
import { unauthorized } from '../lib/errors.js';
import { findSessionUser } from '../services/auth.service.js';

// El prefijo __Host- obliga al navegador a exigir Secure, Path=/ y sin Domain.
export const SESSION_COOKIE = config.cookieSecure ? '__Host-sid' : 'sid';

export function readSessionToken(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === SESSION_COOKIE) return part.slice(eq + 1).trim();
  }
  return null;
}

export function setSessionCookie(res, { token, expiresAt }) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: config.cookieSecure, sameSite: 'lax', path: '/' });
}

export async function loadSession(req, _res, next) {
  const token = readSessionToken(req);
  req.user = token ? await findSessionUser(token) : null;
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) throw unauthorized();
  next();
}
