import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

// Parámetros recomendados por OWASP para scrypt (N=2^15, r=8, p=3). Van en el hash
// para poder endurecerlos en el futuro sin invalidar contraseñas existentes.
const N = 2 ** 15;
const R = 8;
const P = 3;
const KEYLEN = 32;
const MAXMEM = 64 * 1024 * 1024;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const [alg, n, r, p, saltB64, keyB64] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM,
  });
  return timingSafeEqual(actual, expected);
}

// Hash señuelo: se verifica cuando el usuario no existe para que el tiempo de
// respuesta no revele qué emails están registrados.
export const DUMMY_HASH = await hashPassword(randomBytes(16).toString('hex'));
