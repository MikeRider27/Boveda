import { pool, withTransaction } from '../db/pool.js';
import { decodeCursor, encodeCursor } from '../lib/cursor.js';
import { conflict, notFound } from '../lib/errors.js';
import { extractLinks, extractTags, titleKey } from '../lib/markdown-refs.js';

const NOTE_COLUMNS = 'id, title, body, version, created_at, updated_at';
const DEFAULT_TITLE = 'Sin título';
// Delimitadores de resaltado en zona de uso privado Unicode: el cliente escapa el
// HTML y luego los convierte en <mark>, así ts_headline nunca inyecta marcado.
const HEADLINE_OPTIONS = 'MaxFragments=1, MaxWords=24, MinWords=8, StartSel="", StopSel=""';

function titleTaken(err) {
  return err.code === '23505' && err.constraint === 'notes_user_title_key_idx';
}

async function syncRefs(client, userId, noteId, body) {
  await client.query('DELETE FROM note_links WHERE source_id = $1', [noteId]);
  await client.query('DELETE FROM note_tags WHERE note_id = $1', [noteId]);
  const links = extractLinks(body);
  const tags = extractTags(body);
  if (links.length) {
    await client.query(
      'INSERT INTO note_links (source_id, user_id, target_key) SELECT $1, $2, unnest($3::text[])',
      [noteId, userId, links],
    );
  }
  if (tags.length) {
    await client.query(
      'INSERT INTO note_tags (note_id, user_id, tag) SELECT $1, $2, unnest($3::text[])',
      [noteId, userId, tags],
    );
  }
}

async function nextFreeDefaultTitle(client, userId) {
  const { rows } = await client.query(
    "SELECT title_key FROM notes WHERE user_id = $1 AND title_key LIKE 'sin título%'",
    [userId],
  );
  const taken = new Set(rows.map((r) => r.title_key));
  if (!taken.has(titleKey(DEFAULT_TITLE))) return DEFAULT_TITLE;
  for (let i = 2; ; i++) {
    const candidate = `${DEFAULT_TITLE} ${i}`;
    if (!taken.has(titleKey(candidate))) return candidate;
  }
}

export async function listNotes(userId, { limit, cursor, tag }) {
  const params = [userId];
  let where = 'n.user_id = $1';
  if (tag) {
    params.push(tag);
    where += ` AND EXISTS (SELECT 1 FROM note_tags t WHERE t.user_id = $1 AND t.note_id = n.id AND t.tag = $${params.length})`;
  }
  if (cursor) {
    const { updatedAt, id } = decodeCursor(cursor);
    params.push(updatedAt, id);
    where += ` AND (n.updated_at, n.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
  }
  params.push(limit + 1);
  const { rows } = await pool.query(
    `SELECT n.id, n.title, left(n.body, 160) AS excerpt, n.updated_at, n.updated_at::text AS cursor_ts
     FROM notes n WHERE ${where}
     ORDER BY n.updated_at DESC, n.id DESC
     LIMIT $${params.length}`,
    params,
  );
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(({ cursor_ts, ...note }) => note),
    nextCursor: hasMore ? encodeCursor(last.cursor_ts, last.id) : null,
  };
}

export async function getNote(userId, id) {
  const { rows } = await pool.query(`SELECT ${NOTE_COLUMNS} FROM notes WHERE id = $1 AND user_id = $2`, [id, userId]);
  if (!rows[0]) throw notFound('La nota no existe');
  return rows[0];
}

export async function resolveTitle(userId, title) {
  const { rows } = await pool.query('SELECT id, title FROM notes WHERE user_id = $1 AND title_key = $2', [
    userId, titleKey(title),
  ]);
  if (!rows[0]) throw notFound('No hay ninguna nota con ese título');
  return rows[0];
}

export async function createNote(userId, { title, body = '' }) {
  try {
    return await withTransaction(async (client) => {
      const finalTitle = title ?? (await nextFreeDefaultTitle(client, userId));
      const { rows } = await client.query(
        `INSERT INTO notes (user_id, title, title_key, body) VALUES ($1, $2, $3, $4) RETURNING ${NOTE_COLUMNS}`,
        [userId, finalTitle, titleKey(finalTitle), body],
      );
      await syncRefs(client, userId, rows[0].id, body);
      return rows[0];
    });
  } catch (err) {
    if (titleTaken(err)) throw conflict('title_taken', 'Ya tienes una nota con ese título');
    throw err;
  }
}

/** Actualización con concurrencia optimista: falla con 409 si `version` no es la actual. */
export async function updateNote(userId, id, { title, body, version }) {
  try {
    return await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE notes SET
           title = coalesce($3, title),
           title_key = coalesce($4, title_key),
           body = coalesce($5, body),
           version = version + 1,
           updated_at = now()
         WHERE id = $1 AND user_id = $2 AND version = $6
         RETURNING ${NOTE_COLUMNS}`,
        [id, userId, title ?? null, title ? titleKey(title) : null, body ?? null, version],
      );
      if (!rows[0]) {
        const current = await client.query('SELECT version FROM notes WHERE id = $1 AND user_id = $2', [id, userId]);
        if (!current.rows[0]) throw notFound('La nota no existe');
        throw conflict('version_conflict', 'La nota cambió desde otra pestaña o dispositivo', {
          currentVersion: current.rows[0].version,
        });
      }
      if (body !== undefined) await syncRefs(client, userId, id, body);
      return rows[0];
    });
  } catch (err) {
    if (titleTaken(err)) throw conflict('title_taken', 'Ya tienes una nota con ese título');
    throw err;
  }
}

export async function deleteNote(userId, id) {
  const { rowCount } = await pool.query('DELETE FROM notes WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!rowCount) throw notFound('La nota no existe');
}

export async function getBacklinks(userId, id) {
  await getNote(userId, id);
  const { rows } = await pool.query(
    `SELECT s.id, s.title, s.updated_at
     FROM notes t
     JOIN note_links l ON l.user_id = t.user_id AND l.target_key = t.title_key
     JOIN notes s ON s.id = l.source_id
     WHERE t.id = $1 AND t.user_id = $2 AND s.id <> t.id
     ORDER BY s.updated_at DESC
     LIMIT 200`,
    [id, userId],
  );
  return rows;
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, (c) => '\\' + c);
}

export async function searchNotes(userId, q, limit) {
  const { rows } = await pool.query(
    `SELECT n.id, n.title, n.updated_at,
            ts_headline('spanish', n.body, query, $5) AS excerpt
     FROM notes n, websearch_to_tsquery('spanish', $2) query
     WHERE n.user_id = $1 AND (n.search @@ query OR n.title_key LIKE $3)
     ORDER BY (n.title_key LIKE $3) DESC, ts_rank(n.search, query) DESC, n.updated_at DESC
     LIMIT $4`,
    [userId, q, `%${escapeLike(titleKey(q))}%`, limit, HEADLINE_OPTIONS],
  );
  return rows;
}

export async function listTags(userId) {
  const { rows } = await pool.query(
    `SELECT tag, count(*)::int AS count FROM note_tags WHERE user_id = $1
     GROUP BY tag ORDER BY count DESC, tag LIMIT 200`,
    [userId],
  );
  return rows;
}

const GRAPH_NODE_LIMIT = 1000;

export async function getGraph(userId) {
  const nodes = await pool.query(
    'SELECT id, title FROM notes WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2',
    [userId, GRAPH_NODE_LIMIT],
  );
  const edges = await pool.query(
    `SELECT DISTINCT l.source_id AS source, t.id AS target
     FROM note_links l
     JOIN notes t ON t.user_id = l.user_id AND t.title_key = l.target_key
     WHERE l.user_id = $1 AND l.source_id <> t.id`,
    [userId],
  );
  const ids = new Set(nodes.rows.map((n) => n.id));
  return {
    nodes: nodes.rows,
    edges: edges.rows.filter((e) => ids.has(e.source) && ids.has(e.target)),
    truncated: nodes.rows.length === GRAPH_NODE_LIMIT,
  };
}
