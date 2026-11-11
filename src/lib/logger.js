// Logs estructurados en JSON (una línea por evento) para Loki/CloudWatch/Datadog.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(level = 'info', write = (line) => process.stdout.write(line)) {
  const min = LEVELS[level] ?? LEVELS.info;
  const emit = (lvl) => (msg, fields = {}) => {
    if (LEVELS[lvl] < min) return;
    write(JSON.stringify({ ts: new Date().toISOString(), level: lvl, msg, ...fields }) + '\n');
  };
  return { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') };
}

export const logger = createLogger(process.env.LOG_LEVEL);

export function errorFields(err) {
  return { err: err?.message, code: err?.code, stack: err?.stack };
}
