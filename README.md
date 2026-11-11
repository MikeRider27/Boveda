# Bóveda

Notas enlazadas autoalojadas, inspiradas en Obsidian: Markdown, `[[wikilinks]]`, backlinks automáticos, `#etiquetas`, búsqueda de texto completo en español y vista de grafo. Multiusuario, en tu servidor, corriendo íntegramente en Docker.

## Arranque rápido

Solo necesitas Docker.

```bash
cp .env.example .env          # cambia POSTGRES_PASSWORD
docker compose up -d --build
# → http://localhost:3000
```

Tests unitarios (sin instalar Node en el host):

```bash
docker build --target test .
```

## Qué hace

| Función | Detalle |
|---|---|
| Editor | Markdown con vista Editar / Dividido / Lectura, autoguardado (800 ms) y `Ctrl+S` |
| Enlaces | `[[Título]]`, `[[Título\|alias]]`, `[[Título#sección]]`. Clic en un enlace a una nota inexistente la crea |
| Backlinks | Panel derecho con las notas que enlazan a la actual. Se resuelven por título, sin distinguir mayúsculas |
| Etiquetas | `#tema`, `#tema/subtema`, con acentos. Nube de etiquetas y filtrado |
| Búsqueda | Texto completo con stemming en español (`arquitecturas` encuentra `arquitectura`), más coincidencia parcial de título. `Ctrl+K` |
| Grafo | Vista de fuerzas en canvas: arrastra, haz zoom y abre notas con un clic |
| Concurrencia | Control optimista por versión: si editas la misma nota en dos pestañas, la segunda ve un aviso de conflicto en lugar de pisar datos |

Atajos: `Ctrl+K` buscar · `Alt+N` nueva nota · `Ctrl+S` guardar ya · `Enter` en el título salta al cuerpo.

## Arquitectura

```
 Navegador (SPA vanilla JS, módulos ES, sin build)
     │  HTTPS · cookie de sesión HttpOnly · cabecera anti-CSRF
     ▼
 Ingress / balanceador (TLS)
     ▼
 Node 24 + Express 5   ×N réplicas sin estado
  ├─ middleware: request-id · logs JSON · helmet/CSP · CSRF · sesión · rate limit
  ├─ routes/   → validación de entrada
  └─ services/ → lógica de negocio + SQL parametrizado
     ▼
 PostgreSQL 17 (tsvector + GIN para búsqueda, índices keyset para paginar)
```

**Decisiones clave**

- **Monolito modular, sin estado.** Cualquier réplica atiende cualquier petición porque la sesión vive en Postgres. Escalar es subir réplicas (hay un HPA en `k8s/`).
- **Postgres hace de motor de búsqueda.** El `tsvector` es una columna generada con índice GIN, así que no hay que mantener Elasticsearch para un MVP. La interfaz de `searchNotes` permite cambiarlo más adelante.
- **Enlaces por clave de título, no por id.** Así `[[Nota futura]]` funciona antes de que la nota exista y el backlink aparece solo al crearla. La clave (`title_key`) se calcula en JS para no depender de la collation de la base de datos.
- **Paginación keyset** `(updated_at, id)` con cursor opaco. El coste es constante sea cual sea la página, a diferencia de `OFFSET`.
- **Frontend sin build.** Las librerías (marked, DOMPurify) se sirven desde `node_modules` con la versión del lockfile, sin CDN de terceros. Eso permite una CSP `script-src 'self'`.

## Estructura

```
src/
  server.js              arranque, migraciones, apagado ordenado
  app.js                 composición de Express (seguridad, API, estáticos)
  config.js              configuración por variables de entorno
  db/pool.js             pool de pg + helper de transacciones
  db/migrate.js          migraciones SQL con advisory lock (seguro con N réplicas)
  db/migrations/*.sql    esquema
  lib/                   errores HTTP, validación, scrypt, logger, cursor, parser de refs
  middleware/            auth, csrf, rate-limit, request-context, error-handler
  routes/                auth, notes, health
  services/              auth.service, notes.service
public/
  index.html · css/app.css
  js/app.js              controlador de la UI y estado
  js/api.js              cliente HTTP
  js/markdown.js         render seguro + extensiones wikilink/tag
  js/graph.js            simulación de fuerzas en canvas
test/                    node:test (sin dependencias)
k8s/                     Deployment, Service, Ingress, HPA, PDB, Secret de ejemplo
.github/workflows/ci.yml tests → smoke con compose → publicar imagen en GHCR
```

## Esquema de base de datos

| Tabla | Columnas principales | Índices |
|---|---|---|
| `users` | `id`, `email` (único, en minúsculas), `password_hash` (scrypt) | `email` |
| `sessions` | `token_hash` (SHA-256 del token), `user_id`, `expires_at` | `user_id`, `expires_at` |
| `notes` | `id`, `user_id`, `title`, `title_key`, `body` (≤200k), `version`, `search` (tsvector generado) | `(user_id, title_key)` único · `(user_id, updated_at DESC, id DESC)` · GIN `search` |
| `note_links` | `source_id`, `user_id`, `target_key` | `(user_id, target_key)` |
| `note_tags` | `note_id`, `user_id`, `tag` | `(user_id, tag)` |

## API

Todas las rutas `/api/*` responden JSON. Las mutaciones exigen la cabecera `X-Requested-With: boveda`. Los errores tienen la forma `{ "error": { "code", "message", "details?" } }`.

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/auth/register` | `{email, password}` (mínimo 10 caracteres) → 201 + cookie |
| POST | `/api/auth/login` | `{email, password}` → cookie |
| POST | `/api/auth/logout` | invalida la sesión |
| GET | `/api/auth/me` | usuario actual |
| GET | `/api/notes?limit&cursor&tag` | lista paginada `{items, nextCursor}` |
| POST | `/api/notes` | `{title?, body?}` → 201. Sin título: «Sin título», «Sin título 2»… |
| GET | `/api/notes/resolve?title=` | id de la nota con ese título |
| GET | `/api/notes/:id` | nota completa |
| PATCH | `/api/notes/:id` | `{title?, body?, version}` → 409 `version_conflict` o `title_taken` |
| DELETE | `/api/notes/:id` | 204 |
| GET | `/api/notes/:id/backlinks` | notas que enlazan aquí |
| GET | `/api/search?q=` | resultados con fragmento resaltado |
| GET | `/api/tags` | etiquetas con recuento |
| GET | `/api/graph` | `{nodes, edges, truncated}` (máximo 1000 nodos) |
| GET | `/healthz` · `/readyz` | liveness (proceso) · readiness (BD + sin apagado en curso) |

## Seguridad

| Riesgo | Mitigación |
|---|---|
| Robo de la BD | Contraseñas con scrypt (N=2¹⁵, r=8, p=3, parámetros OWASP). En sesiones solo se guarda el SHA-256 del token |
| Robo de sesión por XSS | Cookie `HttpOnly`, `SameSite=Lax` y, en https, prefijo `__Host-` con `Secure` |
| XSS en notas | El Markdown pasa por DOMPurify. Títulos y fragmentos se escapan. CSP sin `unsafe-inline` |
| CSRF | SameSite, más una cabecera propia obligatoria, más comprobación de `Origin` |
| Inyección SQL | Todas las consultas van parametrizadas. Los ids se validan como UUID antes de llegar a la BD |
| IDOR (leer notas ajenas) | Cada consulta filtra por `user_id`. Pedir una nota ajena da 404, no 403, para no revelar que existe |
| Fuerza bruta | 10 intentos/min por IP en login y registro, scrypt lento y hash señuelo para que el tiempo de respuesta no delate usuarios |
| Abuso de API | 600 peticiones/min por usuario, body ≤1 MB, `statement_timeout` de 5 s |
| Contenedor | Usuario no root, filesystem de solo lectura, `cap_drop: ALL`, `no-new-privileges`. Postgres sin puerto publicado |
| Fuga de detalles | Los 500 devuelven solo el `requestId`. El detalle va a los logs |

**Verificado contra la instancia en marcha:** sin cabecera CSRF → 403, `Origin` ajeno → 403, sin sesión → 401, otro usuario leyendo o borrando una nota ajena → 404, id con SQL → 400, JSON roto → 400, pasar de 10 intentos de login o registro en un minuto → 429.

## Despliegue a producción (checklist)

- [ ] Postgres gestionado (RDS, Cloud SQL, Neon…) con backups automáticos y PITR. Prueba una restauración al menos una vez
- [ ] `DATABASE_URL` con `sslmode=require`, guardada en un gestor de secretos (nunca en el repo)
- [ ] TLS terminado en el ingress. **No** definas `COOKIE_SECURE=false`
- [ ] `TRUST_PROXY=1` (o el número real de proxies) para que el rate limit vea la IP del cliente
- [ ] Imagen con tag inmutable (SHA del commit), no `latest`
- [ ] `kubectl apply -k k8s/`, tras crear el Secret (ver `k8s/secret.example.yaml`). `preStop.sleep` requiere Kubernetes ≥1.30
- [ ] Logs JSON enviados a Loki, CloudWatch o Datadog. Alertas sobre tasa de 5xx, latencia p95 y `/readyz` fallando
- [ ] `DB_POOL_MAX × réplicas máximas` por debajo de `max_connections` de Postgres. Con muchas réplicas, usa PgBouncer
- [ ] Rate limit compartido (Redis) si hay más de una réplica (ver limitaciones)

## Variables de entorno

| Variable | Por defecto | Uso |
|---|---|---|
| `DATABASE_URL` | — (obligatoria) | conexión a Postgres |
| `PORT` | `3000` | puerto HTTP |
| `COOKIE_SECURE` | `true` | `false` solo para desarrollo local en http |
| `TRUST_PROXY` | `loopback` | saltos de proxy de confianza |
| `DB_POOL_MAX` | `10` | conexiones por réplica |
| `SESSION_TTL_DAYS` | `30` | duración de la sesión |
| `MIGRATE_ON_START` | `true` | aplicar migraciones al arrancar |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` o `error` |

## Limitaciones conocidas y siguientes pasos

Para escalar a millones de usuarios, en orden de prioridad:

1. **El rate limit es por réplica** (en memoria): con N réplicas, el límite efectivo es N×. Siguiente paso: Redis, con la misma interfaz que `middleware/rate-limit.js`.
2. **Renombrar una nota no reescribe los `[[enlaces]]`** que apuntaban al título viejo; quedan como enlaces a una nota inexistente. Obsidian sí los actualiza. Se haría en `updateNote`, dentro de la misma transacción.
3. **Cada petición autenticada consulta la sesión en Postgres.** Con mucho tráfico, añadir una caché (Redis o LRU con TTL corto).
4. **La búsqueda parcial de título usa `LIKE '%…%'`**, que recorre las notas del usuario. Con usuarios de decenas de miles de notas, añadir `pg_trgm` con índice GIN.
5. **Sin cambio de contraseña, recuperación por email ni "cerrar todas las sesiones".** Además, el registro revela si un email ya existe (aceptable para un MVP autoalojado; para un SaaS público, usar verificación por email).
6. **En local con Docker Desktop** todas las peticiones llegan desde la IP del gateway, así que el rate limit de login se comparte entre clientes. En Kubernetes con `TRUST_PROXY` no ocurre.
7. **Sin adjuntos ni imágenes subidas.** Siguiente paso: almacenamiento S3 con URLs prefirmadas.
