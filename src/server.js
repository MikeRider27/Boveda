import { createApp } from './app.js';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';
import { errorFields, logger } from './lib/logger.js';
import { startDraining } from './routes/health.js';
import { purgeExpiredSessions } from './services/auth.service.js';

process.on('unhandledRejection', (err) => logger.error('promesa rechazada sin manejar', errorFields(err)));
process.on('uncaughtException', (err) => {
  logger.error('excepción no capturada', errorFields(err));
  process.exit(1);
});

if (config.migrateOnStart) await migrate();

const server = createApp().listen(config.port, () => logger.info('servidor escuchando', { port: config.port }));
// Mayor que el idle timeout típico de los balanceadores (60 s) para evitar 502 intermitentes.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

const purgeTimer = setInterval(() => {
  purgeExpiredSessions()
    .then((n) => n && logger.info('sesiones caducadas eliminadas', { count: n }))
    .catch((err) => logger.warn('no se pudieron purgar sesiones', errorFields(err)));
}, 3_600_000);
purgeTimer.unref();

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('apagado ordenado', { signal });
  startDraining();
  // Termina las peticiones en curso, luego cierra el pool. Si algo se cuelga, salimos igual.
  server.close(async (err) => {
    await pool.end().catch(() => {});
    process.exit(err ? 1 : 0);
  });
  setTimeout(() => process.exit(1), 15_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
