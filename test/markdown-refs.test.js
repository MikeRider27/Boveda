import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractLinks, extractTags, titleKey, validateTitle } from '../src/lib/markdown-refs.js';

test('extrae wikilinks normalizados y sin duplicados', () => {
  const body = 'Ver [[Proyecto  Alfa]], [[proyecto alfa|alias]] y [[Notas#sección]].';
  assert.deepEqual(extractLinks(body), ['proyecto alfa', 'notas']);
});

test('ignora wikilinks dentro de código', () => {
  const body = 'Real [[Uno]]\n```\n[[Falso]]\n```\nY `[[Inline]]`';
  assert.deepEqual(extractLinks(body), ['uno']);
});

test('extrae tags con acentos, anidados y sin numéricos puros', () => {
  const body = '#Idea sobre #diseño/ui en (#café). No: #2024, C#sharp, ## título\n#proyecto-2024';
  assert.deepEqual(extractTags(body), ['idea', 'diseño/ui', 'café', 'proyecto-2024']);
});

test('reconoce tags dentro de énfasis, como el render del cliente', () => {
  assert.deepEqual(extractTags('**#importante** y ~~#tal~~'), ['importante', 'tal']);
});

test('no confunde encabezados con tags', () => {
  assert.deepEqual(extractTags('# Título\n## Otro'), []);
});

test('titleKey es insensible a mayúsculas y espacios', () => {
  assert.equal(titleKey('  Ámbito   Global '), 'ámbito global');
});

test('validateTitle rechaza caracteres que rompen los enlaces', () => {
  assert.throws(() => validateTitle('a [b]'), /no puede contener/);
  assert.throws(() => validateTitle('   '), /vacío/);
  assert.equal(validateTitle('  Hola   mundo '), 'Hola mundo');
});
