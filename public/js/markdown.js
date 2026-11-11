// Render de Markdown seguro: marked genera HTML y DOMPurify elimina cualquier script,
// manejador de eventos o URL javascript: antes de insertarlo en el DOM.
import { Marked } from '/vendor/marked.js';
import DOMPurify from '/vendor/purify.js';

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Misma gramática que src/lib/markdown-refs.js en el servidor.
const wikilink = {
  name: 'wikilink',
  level: 'inline',
  start: (src) => src.indexOf('[['),
  tokenizer(src) {
    const m = /^\[\[([^[\]|#\n]+)(?:#[^[\]|\n]*)?(?:\|([^[\]\n]+))?\]\]/.exec(src);
    if (!m) return undefined;
    return { type: 'wikilink', raw: m[0], target: m[1].trim(), label: (m[2] ?? m[1]).trim() };
  },
  renderer: (t) => `<a href="#" class="wikilink" data-target="${escapeHtml(t.target)}">${escapeHtml(t.label)}</a>`,
};

const tag = {
  name: 'tag',
  level: 'inline',
  start(src) {
    const m = /(^|\s)#[\p{L}\p{N}_\-/]/u.exec(src);
    return m ? m.index + m[1].length : undefined;
  },
  tokenizer(src) {
    const m = /^#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/u.exec(src);
    if (!m) return undefined;
    return { type: 'tag', raw: m[0], tag: m[1].toLowerCase().replace(/\/+$/, '') };
  },
  renderer: (t) => `<a href="#" class="tag" data-tag="${escapeHtml(t.tag)}">#${escapeHtml(t.tag)}</a>`,
};

const marked = new Marked({ gfm: true, breaks: true });
marked.use({ extensions: [wikilink, tag] });

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && /^https?:/i.test(node.getAttribute('href') ?? '')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export function renderMarkdown(source) {
  return DOMPurify.sanitize(marked.parse(source), { ADD_ATTR: ['target'] });
}
