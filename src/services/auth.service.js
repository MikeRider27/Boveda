import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { conflict, unauthorized } from '../lib/errors.js';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../lib/password.js';

const sha256 = (value) => createHash('sha256').update(value).digest();
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export async function register(email, password) {
  const hash = await hashPassword(password);
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
      [email, hash],
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw conflict('email_taken', 'Ya existe una cuenta con ese email');
    throw err;
  }
}

export async function authenticate(email, password) {
  const { rows } = await pool.query('SELECT id, email, password_hash FROM users WHERE email = $1', [email]);
  const user = rows[0];
  const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) throw unauthorized('Email o contraseña incorrectos');
  return { id: user.id, email: user.email };
}

export async function createSession(userId) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.sessionTtlDays * 86_400_000);
  await pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
    sha256(token), userId, expiresAt,
  ]);
  return { token, expiresAt };
}

export async function findSessionUser(token) {
  if (!TOKEN_RE.test(token)) return null;
  const { rows } = await pool.query(
    `SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)],
  );
  return rows[0] ?? null;
}

export async function destroySession(token) {
  if (!TOKEN_RE.test(token)) return;
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
}

export async function purgeExpiredSessions() {
  const { rowCount } = await pool.query('DELETE FROM sessions WHERE expires_at < now()');
  return rowCount;
}
