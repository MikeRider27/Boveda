import { Router } from 'express';
import { clearSessionCookie, readSessionToken, requireAuth, setSessionCookie } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import * as v from '../lib/validate.js';
import * as auth from '../services/auth.service.js';

export const authRouter = Router();

// Frena fuerza bruta y relleno de credenciales; además scrypt hace caro cada intento.
const credentialsLimit = rateLimit({ windowMs: 60_000, max: 10 });

authRouter.post('/register', credentialsLimit, async (req, res) => {
  const email = v.email(req.body?.email);
  const password = v.password(req.body?.password);
  const user = await auth.register(email, password);
  setSessionCookie(res, await auth.createSession(user.id));
  res.status(201).json({ user });
});

authRouter.post('/login', credentialsLimit, async (req, res) => {
  const email = v.email(req.body?.email);
  const password = v.str(req.body?.password, 'password', { min: 1, max: 256, trim: false });
  const user = await auth.authenticate(email, password);
  setSessionCookie(res, await auth.createSession(user.id));
  res.json({ user });
});

authRouter.post('/logout', async (req, res) => {
  const token = readSessionToken(req);
  if (token) await auth.destroySession(token);
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});
