// Extrae [[wikilinks]] y #tags del cuerpo de una nota. La misma gramática se usa
// en el frontend (public/js/markdown.js) para que lo que se ve coincida con lo indexado.
import { badRequest } from './errors.js';

export const MAX_TITLE = 200;
const MAX_REFS = 500;

const WIKILINK_RE = /\[\[([^[\]|#\n]+)(?:#[^[\]|\n]*)?(?:\|[^[\]\n]*)?\]\]/g;
// Un tag necesita al menos un carácter no numérico (#2024 no es tag, #proyecto-2024 sí).
// También tras delimitadores de énfasis (**#tag**), que el render del cliente trata como tag.
const TAG_RE = /(?:^|[\s(*_~])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;
const FORBIDDEN_TITLE_CHARS = /[[\]|#\n\r]/;

/** Normaliza un título para mostrarlo: sin espacios redundantes. */
export function cleanTitle(title) {
  return title.trim().replace(/\s+/g, ' ');
}

/** Clave canónica para unicidad y resolución de enlaces (independiente de mayúsculas). */
export function titleKey(title) {
  return cleanTitle(title).toLowerCase();
}

export function validateTitle(raw) {
  if (typeof raw !== 'string') throw badRequest('"title" debe ser texto');
  const title = cleanTitle(raw);
  if (!title) throw badRequest('El título no puede estar vacío');
  if (title.length > MAX_TITLE) throw badRequest(`El título admite como máximo ${MAX_TITLE} caracteres`);
  if (FORBIDDEN_TITLE_CHARS.test(title)) throw badRequest('El título no puede contener [ ] | #');
  return title;
}

function stripCode(body) {
  return body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

export function extractLinks(body) {
  const keys = new Set();
  for (const m of stripCode(body).matchAll(WIKILINK_RE)) {
    const key = titleKey(m[1]);
    if (key && key.length <= MAX_TITLE) keys.add(key);
    if (keys.size >= MAX_REFS) break;
  }
  return [...keys];
}

export function extractTags(body) {
  const tags = new Set();
  for (const m of stripCode(body).matchAll(TAG_RE)) {
    const tag = m[1].toLowerCase().replace(/\/+$/, '');
    if (tag && tag.length <= 100) tags.add(tag);
    if (tags.size >= MAX_REFS) break;
  }
  return [...tags];
}
