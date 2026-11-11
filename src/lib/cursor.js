// Cursor opaco para paginación por keyset (updated_at, id). Guardamos el timestamp
// como texto de Postgres para no perder los microsegundos al pasar por Date de JS.
import { badRequest } from './errors.js';

export function encodeCursor(updatedAtRaw, id) {
  return Buffer.from(JSON.stringify([updatedAtRaw, id])).toString('base64url');
}

export function decodeCursor(cursor) {
  try {
    const [updatedAt, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof updatedAt !== 'string' || typeof id !== 'string') throw new Error();
    return { updatedAt, id };
  } catch {
    throw badRequest('Cursor de paginación inválido');
  }
}
