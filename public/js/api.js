export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'boveda',
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', 'Sin conexión con el servidor');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.code ?? 'unknown', err.message ?? `Error ${res.status}`, err.details);
  }
  return data;
}

const qs = (params) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null));
  return s.size ? `?${s}` : '';
};

export const api = {
  me: () => request('GET', '/auth/me'),
  login: (email, password) => request('POST', '/auth/login', { email, password }),
  register: (email, password) => request('POST', '/auth/register', { email, password }),
  logout: () => request('POST', '/auth/logout'),

  listNotes: ({ cursor, tag } = {}) => request('GET', `/notes${qs({ cursor, tag, limit: 50 })}`),
  getNote: (id) => request('GET', `/notes/${encodeURIComponent(id)}`),
  resolve: (title) => request('GET', `/notes/resolve${qs({ title })}`),
  createNote: (data = {}) => request('POST', '/notes', data),
  updateNote: (id, data) => request('PATCH', `/notes/${encodeURIComponent(id)}`, data),
  deleteNote: (id) => request('DELETE', `/notes/${encodeURIComponent(id)}`),
  backlinks: (id) => request('GET', `/notes/${encodeURIComponent(id)}/backlinks`),
  search: (q) => request('GET', `/search${qs({ q })}`),
  tags: () => request('GET', '/tags'),
  graph: () => request('GET', '/graph'),
};
