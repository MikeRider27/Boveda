// Migraciones SQL secuenciales. El advisory lock permite arrancar N réplicas a la vez:
// solo una aplica cambios, el resto espera y luego no encuentra nada pendiente.
import { readdir, readFile } from 'node:fs/promises';
import { logger } from '../lib/logger.js';
import { pool } from './pool.js';

const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url);
const LOCK_ID = 72_617_401;

export async function migrate() {
  const client = await pool.connect();
  try {
    // Esperar el lock puede superar el statement_timeout del pool.
    await client.query('SET statement_timeout = 0');
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(new URL(file, MIGRATIONS_DIR), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        logger.info('migración aplicada', { file });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    await client.query('RESET statement_timeout').catch(() => {});
    client.release();
  }
}
