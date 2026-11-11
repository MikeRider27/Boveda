import { api, ApiError } from './api.js';
import { mountGraph } from './graph.js';
import { escapeHtml, renderMarkdown } from './markdown.js';

const $ = (sel) => document.querySelector(sel);
const SAVE_DELAY_MS = 800;
const SEARCH_DELAY_MS = 250;

const state = {
  user: null,
  notes: [],
  nextCursor: null,
  tag: null,
  query: '',
  current: null, // nota abierta: { id, title, body, version, ... }
  dirty: false,
  edits: 0, // contador de ediciones: distingue cambios hechos mientras se guardaba
  saveTimer: null,
  saving: null, // promesa del guardado en curso
  titleBlocked: false, // el título actual es inválido/duplicado: se guarda solo el cuerpo
  conflict: false,
  openToken: 0,
};

// ---------- utilidades ----------

const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* modo privado */ } },
};

const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
function timeAgo(iso) {
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  const units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, secs] of units) if (Math.abs(s) >= secs) return rtf.format(Math.round(s / secs), unit);
  return 'ahora';
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

function handleError(err) {
  if (err instanceof ApiError && err.status === 401) return showAuth();
  console.error(err);
  toast(err.message || 'Algo salió mal');
}

function setSaveStatus(text, isError = false) {
  const el = $('#save-status');
  el.textContent = text;
  el.classList.toggle('is-error', isError);
}

// ---------- acceso ----------

let authMode = 'login';

function setAuthMode(mode) {
  authMode = mode;
  for (const tab of document.querySelectorAll('#auth-form [role=tab]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.mode === mode));
  }
  $('#auth-submit').textContent = mode === 'login' ? 'Entrar' : 'Crear cuenta';
  $('#auth-form').password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('#auth-hint').hidden = mode === 'login';
  $('#auth-error').textContent = '';
}

function showAuth() {
  state.user = null;
  $('#app-view').hidden = true;
  $('#auth-view').hidden = false;
  $('#auth-form').email.focus();
}

async function onAuthSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const email = form.email.value.trim();
  const password = form.password.value;
  const errorEl = $('#auth-error');
  errorEl.textContent = '';
  if (!email || !password) return void (errorEl.textContent = 'Completa email y contraseña');
  if (authMode === 'register' && password.length < 10) {
    return void (errorEl.textContent = 'La contraseña debe tener al menos 10 caracteres');
  }
  const button = $('#auth-submit');
  button.disabled = true;
  try {
    const { user } = authMode === 'login' ? await api.login(email, password) : await api.register(email, password);
    form.password.value = '';
    await showApp(user);
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    button.disabled = false;
  }
}

async function logout() {
  await flushSave();
  await api.logout().catch(() => {});
  state.current = null;
  state.notes = [];
  history.replaceState(null, '', location.pathname);
  showAuth();
}

// ---------- lista y etiquetas ----------

function highlight(excerpt) {
  return escapeHtml(excerpt).replaceAll('', '<mark>').replaceAll('', '</mark>');
}

function renderList() {
  const list = $('#note-list');
  if (!state.notes.length) {
    list.innerHTML = `<p class="list-empty">${state.query ? 'Sin resultados.' : state.tag ? 'Ninguna nota con esta etiqueta.' : 'Aún no hay notas.'}</p>`;
  } else {
    list.innerHTML = state.notes.map((n) => {
      const meta = state.query ? highlight(n.excerpt || '') : escapeHtml(timeAgo(n.updated_at));
      const current = n.id === state.current?.id;
      return `<button class="note-item" data-id="${n.id}" aria-current="${current}">
        <span class="note-item-title">${escapeHtml(n.title)}</span>
        <span class="note-item-meta">${meta}</span>
      </button>`;
    }).join('');
  }
  $('#btn-more').hidden = !state.nextCursor || !!state.query;
}

async function loadList({ append = false } = {}) {
  if (!append) $('#note-list').innerHTML = '<div class="skeleton"></div>'.repeat(4);
  try {
    if (state.query) {
      const { items } = await api.search(state.query);
      state.notes = items;
      state.nextCursor = null;
    } else {
      const { items, nextCursor } = await api.listNotes({ tag: state.tag, cursor: append ? state.nextCursor : undefined });
      state.notes = append ? [...state.notes, ...items] : items;
      state.nextCursor = nextCursor;
    }
    renderList();
  } catch (err) {
    handleError(err);
  }
}

async function loadTags() {
  try {
    const { items } = await api.tags();
    $('#tag-cloud').innerHTML = items.length
      ? items.map((t) => `<button class="tag-chip" data-tag="${escapeHtml(t.tag)}" aria-pressed="${t.tag === state.tag}">#${escapeHtml(t.tag)} <span class="muted">${t.count}</span></button>`).join('')
      : '<span class="list-empty">Escribe #algo en una nota.</span>';
  } catch (err) {
    handleError(err);
  }
}
const refreshTags = debounce(loadTags, 1500);

function setTagFilter(tag) {
  state.tag = tag;
  state.query = '';
  $('#search').value = '';
  $('#tag-filter').hidden = !tag;
  $('#tag-filter-name').textContent = tag ? `#${tag}` : '';
  closeSidebar();
  loadList();
  loadTags();
}

/** Refleja en la lista un guardado sin recargarla: actualiza el título y sube la nota arriba. */
function touchListItem(note) {
  if (state.query) return;
  const rest = state.notes.filter((n) => n.id !== note.id);
  const existing = state.notes.find((n) => n.id === note.id);
  if (!existing && state.tag) return; // puede no pertenecer al filtro actual
  state.notes = [{ ...existing, id: note.id, title: note.title, updated_at: note.updated_at }, ...rest];
  renderList();
}

// ---------- editor ----------

function renderPreview() {
  $('#preview').innerHTML = renderMarkdown($('#note-body').value);
}
let previewFrame = 0;
function schedulePreview() {
  cancelAnimationFrame(previewFrame);
  previewFrame = requestAnimationFrame(renderPreview);
}

function showEditor(show) {
  $('#editor').hidden = !show;
  $('#empty-state').hidden = show;
  $('#backlinks').hidden = !show;
  $('#btn-delete').disabled = !show;
}

async function loadBacklinks(id) {
  const list = $('#backlink-list');
  try {
    const { items } = await api.backlinks(id);
    if (state.current?.id !== id) return;
    list.innerHTML = items.length
      ? items.map((n) => `<li><button data-id="${n.id}">${escapeHtml(n.title)}</button></li>`).join('')
      : '<li class="list-empty muted">Ninguna nota enlaza aquí todavía.</li>';
  } catch (err) {
    handleError(err);
  }
}

async function openNote(id, { focusTitle = false } = {}) {
  if (state.current?.id === id) return;
  await flushSave();
  const token = ++state.openToken;
  try {
    const { note } = await api.getNote(id);
    if (token !== state.openToken) return; // el usuario ya abrió otra nota
    state.current = note;
    state.dirty = false;
    state.titleBlocked = false;
    setConflict(false);
    $('#note-title').value = note.title;
    $('#title-error').textContent = '';
    $('#note-body').value = note.body;
    renderPreview();
    showEditor(true);
    setSaveStatus(`Editado ${timeAgo(note.updated_at)}`);
    renderList();
    loadBacklinks(note.id);
    if (location.hash !== `#/n/${note.id}`) location.hash = `/n/${note.id}`;
    document.title = `${note.title} · Bóveda`;
    closeSidebar();
    if (focusTitle) {
      $('#note-title').focus();
      $('#note-title').select();
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      toast('Esa nota ya no existe');
      history.replaceState(null, '', location.pathname);
      return closeNote();
    }
    handleError(err);
  }
}

function closeNote() {
  state.current = null;
  state.dirty = false;
  showEditor(false);
  setSaveStatus('');
  document.title = 'Bóveda';
  renderList();
}

function onEdit() {
  if (!state.current || state.conflict) return;
  state.dirty = true;
  state.edits++;
  setSaveStatus('Cambios sin guardar…');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(save, SAVE_DELAY_MS);
}

async function save() {
  clearTimeout(state.saveTimer);
  if (state.saving) {
    await state.saving;
    return state.dirty ? save() : undefined;
  }
  const note = state.current;
  if (!note || !state.dirty || state.conflict) return;

  const editsAtStart = state.edits;
  const title = $('#note-title').value.trim().replace(/\s+/g, ' ');
  const payload = { body: $('#note-body').value, version: note.version };
  if (!state.titleBlocked && title && title !== note.title) payload.title = title;

  setSaveStatus('Guardando…');
  state.saving = (async () => {
    try {
      const { note: saved } = await api.updateNote(note.id, payload);
      if (state.current?.id !== saved.id) return;
      Object.assign(state.current, saved);
      if (state.edits === editsAtStart) state.dirty = false;
      setSaveStatus(state.dirty ? 'Cambios sin guardar…' : 'Guardado');
      if (payload.title) {
        $('#title-error').textContent = '';
        document.title = `${saved.title} · Bóveda`;
      }
      touchListItem(saved);
      loadBacklinks(saved.id);
      refreshTags();
    } catch (err) {
      if (err.code === 'version_conflict') {
        setConflict(true);
      } else if (err.code === 'title_taken' || (err.status === 400 && payload.title)) {
        // Guardamos el cuerpo igualmente y dejamos el título marcado como erróneo.
        $('#title-error').textContent = err.message;
        state.titleBlocked = true;
        state.dirty = true;
      } else {
        setSaveStatus(err.status === 0 ? 'Sin conexión: reintentando…' : 'Error al guardar', true);
        if (err.status === 401) return handleError(err);
        clearTimeout(state.saveTimer);
        state.saveTimer = setTimeout(save, 5000);
      }
    }
  })();
  await state.saving;
  state.saving = null;
  if (state.titleBlocked && state.dirty && !state.conflict) return save();
  if (state.dirty && !state.conflict && state.edits !== editsAtStart) {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(save, SAVE_DELAY_MS);
  }
}

async function flushSave() {
  clearTimeout(state.saveTimer);
  if (state.saving) await state.saving;
  if (state.dirty && !state.conflict) await save();
}

function setConflict(on) {
  state.conflict = on;
  $('#conflict-banner').hidden = !on;
  if (on) setSaveStatus('Conflicto de versiones', true);
}

async function resolveConflict(overwrite) {
  const id = state.current.id;
  try {
    const { note } = await api.getNote(id);
    setConflict(false);
    if (overwrite) {
      state.current.version = note.version;
      state.dirty = true;
      await save();
    } else {
      state.current = null; // fuerza la recarga
      state.dirty = false;
      await openNote(id);
    }
  } catch (err) {
    handleError(err);
  }
}

async function newNote(title) {
  await flushSave();
  try {
    const { note } = await api.createNote(title ? { title } : {});
    if (!state.query && !state.tag) {
      state.notes = [note, ...state.notes];
      renderList();
    }
    await openNote(note.id, { focusTitle: !title });
  } catch (err) {
    handleError(err);
  }
}

async function deleteCurrent() {
  const note = state.current;
  if (!note || !confirm(`¿Eliminar «${note.title}»? No se puede deshacer.`)) return;
  clearTimeout(state.saveTimer);
  state.dirty = false;
  // Un PATCH en vuelo que termine tras el DELETE devolvería 404 y mostraría un error falso.
  if (state.saving) await state.saving;
  try {
    await api.deleteNote(note.id);
    state.notes = state.notes.filter((n) => n.id !== note.id);
    history.replaceState(null, '', location.pathname);
    closeNote();
    toast('Nota eliminada');
    loadTags();
  } catch (err) {
    handleError(err);
  }
}

async function followWikilink(title) {
  try {
    const { note } = await api.resolve(title);
    await openNote(note.id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return newNote(title);
    handleError(err);
  }
}

function setView(view) {
  const editor = $('#editor');
  editor.classList.remove('view-edit', 'view-split', 'view-read');
  editor.classList.add(`view-${view}`);
  for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
  storage.set('boveda:view', view);
  if (view !== 'edit') renderPreview();
}

// ---------- grafo ----------

let unmountGraph = null;
async function openGraph() {
  const dialog = $('#graph-dialog');
  dialog.showModal();
  $('#graph-info').textContent = 'Cargando…';
  try {
    const data = await api.graph();
    $('#graph-info').textContent = `${data.nodes.length} notas · ${data.edges.length} enlaces${data.truncated ? ' (mostrando las más recientes)' : ''}`;
    unmountGraph?.();
    unmountGraph = mountGraph($('#graph-canvas'), data, (id) => {
      dialog.close();
      openNote(id);
    });
  } catch (err) {
    dialog.close();
    handleError(err);
  }
}

// ---------- navegación ----------

function route() {
  const m = /^#\/n\/([0-9a-f-]{36})$/i.exec(location.hash);
  if (m) openNote(m[1]);
}

const isMobile = window.matchMedia('(max-width: 760px)');

function openSidebar() {
  // En escritorio la barra siempre está visible; el scrim fuera del modo móvil rompería el grid.
  if (!isMobile.matches) return;
  $('#sidebar').classList.add('open');
  $('#scrim').hidden = false;
}
function closeSidebar() {
  $('#sidebar').classList.remove('open');
  $('#scrim').hidden = true;
}

async function showApp(user) {
  state.user = user;
  $('#auth-view').hidden = true;
  $('#app-view').hidden = false;
  $('#user-email').textContent = user.email;
  $('#user-email').title = user.email;
  setView(storage.get('boveda:view') ?? 'split');
  showEditor(false);
  await Promise.all([loadList(), loadTags()]);
  route();
}

// ---------- eventos ----------

function bindEvents() {
  $('#auth-form').addEventListener('submit', onAuthSubmit);
  for (const tab of document.querySelectorAll('#auth-form [role=tab]')) {
    tab.addEventListener('click', () => setAuthMode(tab.dataset.mode));
  }

  $('#btn-new').addEventListener('click', () => newNote());
  $('#btn-new-empty').addEventListener('click', () => newNote());
  $('#btn-delete').addEventListener('click', deleteCurrent);
  $('#btn-logout').addEventListener('click', logout);
  $('#btn-more').addEventListener('click', () => loadList({ append: true }));
  $('#btn-graph').addEventListener('click', openGraph);
  $('#graph-close').addEventListener('click', () => $('#graph-dialog').close());
  $('#graph-dialog').addEventListener('close', () => { unmountGraph?.(); unmountGraph = null; });
  $('#btn-conflict-reload').addEventListener('click', () => resolveConflict(false));
  $('#btn-conflict-overwrite').addEventListener('click', () => resolveConflict(true));
  $('#tag-filter-clear').addEventListener('click', () => setTagFilter(null));
  $('#btn-menu').addEventListener('click', openSidebar);
  $('#scrim').addEventListener('click', closeSidebar);

  $('#note-list').addEventListener('click', (e) => {
    const item = e.target.closest('.note-item');
    if (item) openNote(item.dataset.id);
  });
  $('#backlink-list').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (b) openNote(b.dataset.id);
  });
  $('#tag-cloud').addEventListener('click', (e) => {
    const chip = e.target.closest('.tag-chip');
    if (chip) setTagFilter(chip.dataset.tag === state.tag ? null : chip.dataset.tag);
  });
  $('#preview').addEventListener('click', (e) => {
    const link = e.target.closest('a.wikilink, a.tag');
    if (!link) return;
    e.preventDefault();
    if (link.classList.contains('wikilink')) followWikilink(link.dataset.target);
    else setTagFilter(link.dataset.tag);
  });
  for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => setView(b.dataset.view));

  $('#note-title').addEventListener('input', () => {
    state.titleBlocked = false;
    $('#title-error').textContent = '';
    onEdit();
  });
  $('#note-title').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('#note-body').focus();
    }
  });
  $('#note-body').addEventListener('input', () => {
    onEdit();
    schedulePreview();
  });

  const runSearch = debounce(() => {
    state.query = $('#search').value.trim();
    if (state.query) {
      state.tag = null;
      $('#tag-filter').hidden = true;
    }
    loadList();
  }, SEARCH_DELAY_MS);
  $('#search').addEventListener('input', runSearch);
  $('#search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && state.notes[0]) openNote(state.notes[0].id);
    if (e.key === 'Escape') {
      e.currentTarget.value = '';
      runSearch();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!state.user) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openSidebar(); // solo tiene efecto en móvil
      $('#search').focus();
      $('#search').select();
    } else if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      flushSave();
    } else if (e.altKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      newNote();
    }
  });

  window.addEventListener('hashchange', route);
  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) e.preventDefault();
  });
  // Al ocultar la pestaña (móvil, cambio de app) guardamos lo pendiente.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });
}

async function boot() {
  bindEvents();
  setAuthMode('login');
  try {
    const { user } = await api.me();
    await showApp(user);
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 401)) console.error(err);
    showAuth();
  }
}

boot();
