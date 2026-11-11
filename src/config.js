const env = process.env;

function required(name) {
  const value = env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

function int(name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name} debe ser un entero`);
  return value;
}

// Express interpreta "1" como IP, no como número de saltos: lo convertimos.
function trustProxy(raw = 'loopback') {
  if (/^\d+$/.test(raw)) return Number(raw);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}

export const config = Object.freeze({
  port: int('PORT', 3000),
  databaseUrl: required('DATABASE_URL'),
  dbPoolMax: int('DB_POOL_MAX', 10),
  // Por defecto seguro: solo se desactiva explícitamente para desarrollo local en http.
  cookieSecure: env.COOKIE_SECURE !== 'false',
  sessionTtlDays: int('SESSION_TTL_DAYS', 30),
  trustProxy: trustProxy(env.TRUST_PROXY),
  migrateOnStart: env.MIGRATE_ON_START !== 'false',
});
