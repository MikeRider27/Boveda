import { Router } from 'express';
import { badRequest } from '../lib/errors.js';
import { validateTitle } from '../lib/markdown-refs.js';
import * as v from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';
import * as notes from '../services/notes.service.js';

export const notesRouter = Router();
notesRouter.use(requireAuth);

const MAX_BODY = 200_000;
const body = (value) => v.str(value, 'body', { max: MAX_BODY, trim: false });

notesRouter.get('/notes', async (req, res) => {
  const limit = req.query.limit === undefined ? 50 : v.int(req.query.limit, 'limit', { min: 1, max: 100 });
  const cursor = req.query.cursor === undefined ? undefined : v.str(req.query.cursor, 'cursor', { max: 512 });
  const tag = req.query.tag === undefined ? undefined : v.str(req.query.tag, 'tag', { min: 1, max: 100 }).toLowerCase();
  res.json(await notes.listNotes(req.user.id, { limit, cursor, tag }));
});

notesRouter.post('/notes', async (req, res) => {
  const input = req.body ?? {};
  const note = await notes.createNote(req.user.id, {
    title: input.title === undefined || input.title === '' ? undefined : validateTitle(input.title),
    body: input.body === undefined ? '' : body(input.body),
  });
  res.status(201).json({ note });
});

notesRouter.get('/notes/resolve', async (req, res) => {
  const title = validateTitle(req.query.title ?? '');
  res.json({ note: await notes.resolveTitle(req.user.id, title) });
});

notesRouter.get('/notes/:id', async (req, res) => {
  res.json({ note: await notes.getNote(req.user.id, v.uuid(req.params.id)) });
});

notesRouter.patch('/notes/:id', async (req, res) => {
  const input = req.body ?? {};
  if (input.title === undefined && input.body === undefined) throw badRequest('Nada que actualizar');
  const note = await notes.updateNote(req.user.id, v.uuid(req.params.id), {
    title: input.title === undefined ? undefined : validateTitle(input.title),
    body: input.body === undefined ? undefined : body(input.body),
    version: v.int(input.version, 'version', { min: 1 }),
  });
  res.json({ note });
});

notesRouter.delete('/notes/:id', async (req, res) => {
  await notes.deleteNote(req.user.id, v.uuid(req.params.id));
  res.status(204).end();
});

notesRouter.get('/notes/:id/backlinks', async (req, res) => {
  res.json({ items: await notes.getBacklinks(req.user.id, v.uuid(req.params.id)) });
});

notesRouter.get('/search', async (req, res) => {
  const q = v.str(req.query.q ?? '', 'q', { min: 1, max: 200 });
  res.json({ items: await notes.searchNotes(req.user.id, q, 20) });
});

notesRouter.get('/tags', async (req, res) => {
  res.json({ items: await notes.listTags(req.user.id) });
});

notesRouter.get('/graph', async (req, res) => {
  res.json(await notes.getGraph(req.user.id));
});
