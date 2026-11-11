import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeCursor, encodeCursor } from '../src/lib/cursor.js';
import { hashPassword, verifyPassword } from '../src/lib/password.js';
import * as v from '../src/lib/validate.js';

test('password: verifica la correcta y rechaza la incorrecta', async () => {
  const hash = await hashPassword('correcto-caballo-bateria');
  assert.match(hash, /^scrypt\$32768\$8\$3\$/);
  assert.equal(await verifyPassword('correcto-caballo-bateria', hash), true);
  assert.equal(await verifyPassword('otra-cosa-distinta', hash), false);
  assert.equal(await verifyPassword('x', 'basura'), false);
});

test('cursor: ida y vuelta conserva microsegundos', () => {
  const ts = '2026-10-04 00:10:00.123456+00';
  const id = '3f2b6a1e-0000-4000-8000-000000000001';
  assert.deepEqual(decodeCursor(encodeCursor(ts, id)), { updatedAt: ts, id });
  assert.throws(() => decodeCursor('no-es-un-cursor'), /inválido/);
});

test('validate: email, uuid, int', () => {
  assert.equal(v.email('  Ana@Ejemplo.COM '), 'ana@ejemplo.com');
  assert.throws(() => v.email('sin-arroba'), /no es válido/);
  assert.throws(() => v.uuid('1; DROP TABLE notes'), /identificador/);
  assert.equal(v.int('20', 'limit', { min: 1, max: 100 }), 20);
  assert.throws(() => v.int('1.5', 'limit', { min: 1 }), /entero/);
  assert.throws(() => v.password('corta'), /al menos 10/);
});
