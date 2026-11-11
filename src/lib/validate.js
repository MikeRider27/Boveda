import { badRequest } from './errors.js';

export function str(value, field, { min = 0, max = Infinity, trim = true } = {}) {
  if (typeof value !== 'string') throw badRequest(`"${field}" debe ser texto`);
  const v = trim ? value.trim() : value;
  if (v.length < min) throw badRequest(`"${field}" debe tener al menos ${min} caracteres`);
  if (v.length > max) throw badRequest(`"${field}" admite como máximo ${max} caracteres`);
  return v;
}

export function int(value, field, { min = -Infinity, max = Infinity } = {}) {
  const n = typeof value === 'string' && value !== '' ? Number(value) : value;
  if (!Number.isInteger(n) || n < min || n > max) {
    throw badRequest(`"${field}" debe ser un entero entre ${min} y ${max}`);
  }
  return n;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uuid(value, field = 'id') {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw badRequest(`"${field}" no es un identificador válido`);
  return value.toLowerCase();
}

export function email(value) {
  const v = str(value, 'email', { min: 3, max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw badRequest('El email no es válido');
  return v;
}

export function password(value) {
  // Sin trim: los espacios forman parte de la contraseña.
  return str(value, 'password', { min: 10, max: 256, trim: false });
}
