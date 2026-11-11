import pg from 'pg';
import { config } from '../config.js';
import { errorFields, logger } from '../lib/logger.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.dbPoolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // Ninguna consulta de la API debería tardar más; evita que una query lenta acapare el pool.
  statement_timeout: 5_000,
  application_name: 'boveda',
});

pool.on('error', (err) => logger.error('error en cliente inactivo de pg', errorFields(err)));

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
