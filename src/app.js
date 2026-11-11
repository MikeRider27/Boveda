import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { notFound } from './lib/errors.js';
import { loadSession } from './middleware/auth.js';
import { csrfGuard } from './middleware/csrf.js';
import { errorHandler } from './middleware/error-handler.js';
import { rateLimit } from './middleware/rate-limit.js';
import { requestContext } from './middleware/request-context.js';
import { authRouter } from './routes/auth.js';
import { healthRouter } from './routes/health.js';
import { notesRouter } from './routes/notes.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
// Librerías del cliente servidas desde node_modules: misma versión que el lockfile,
// sin CDN de terceros y compatibles con una CSP estricta (script-src 'self').
const VENDOR = {
  '/vendor/marked.js': fileURLToPath(import.meta.resolve('marked')),
  '/vendor/purify.js': fileURLToPath(import.meta.resolve('dompurify')),
};

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(requestContext);
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );

  app.use(healthRouter);

  const api = express.Router();
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(express.json({ limit: '1mb' }));
  api.use(csrfGuard);
  api.use(loadSession);
  api.use(rateLimit({ windowMs: 60_000, max: 600, key: (req) => req.user?.id ?? req.ip }));
  api.use('/auth', authRouter);
  api.use(notesRouter);
  api.use(() => {
    throw notFound('Ruta de API inexistente');
  });
  app.use('/api', api);

  for (const [route, file] of Object.entries(VENDOR)) {
    app.get(route, (_req, res) => res.sendFile(file, { maxAge: '1d' }));
  }
  app.use(
    express.static(PUBLIC_DIR, {
      setHeaders(res, path) {
        // El HTML siempre se revalida para que los despliegues se vean al instante.
        if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );

  app.use(errorHandler);
  return app;
}
