-- Usuarios. El email se guarda ya normalizado a minúsculas por la aplicación.
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Sesiones opacas: solo guardamos el SHA-256 del token, nunca el token.
-- Si la tabla se filtra, los tokens no sirven para suplantar a nadie.
CREATE TABLE sessions (
  token_hash bytea PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title      text NOT NULL,
  -- Clave canónica calculada en la app (trim + espacios + minúsculas Unicode), así no
  -- dependemos de la collation de Postgres para resolver [[enlaces]].
  title_key  text NOT NULL,
  body       text NOT NULL DEFAULT '',
  version    integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  search     tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('spanish', title), 'A') ||
    setweight(to_tsvector('spanish', body), 'B')
  ) STORED,
  CONSTRAINT notes_body_size CHECK (length(body) <= 200000)
);
CREATE UNIQUE INDEX notes_user_title_key_idx ON notes (user_id, title_key);
CREATE INDEX notes_user_recent_idx ON notes (user_id, updated_at DESC, id DESC);
CREATE INDEX notes_search_idx ON notes USING gin (search);

-- Enlaces salientes por clave de título: permite enlazar a notas que aún no existen
-- y que los backlinks aparezcan solos cuando se crean.
CREATE TABLE note_links (
  source_id  uuid NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  target_key text NOT NULL,
  PRIMARY KEY (source_id, target_key)
);
CREATE INDEX note_links_target_idx ON note_links (user_id, target_key);

CREATE TABLE note_tags (
  note_id uuid NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  tag     text NOT NULL,
  PRIMARY KEY (note_id, tag)
);
CREATE INDEX note_tags_user_tag_idx ON note_tags (user_id, tag);
