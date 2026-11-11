# syntax=docker/dockerfile:1

# ---- Dependencias de producción (capa cacheada mientras no cambie el lockfile) ----
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ---- Tests (CI: docker build --target test .) ----
FROM deps AS test
COPY src ./src
COPY test ./test
RUN npm test

# ---- Imagen final: mínima, sin root, sin herramientas de build ----
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache tini
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# tini reenvía SIGTERM a node (PID 1 no lo haría) y recoge procesos zombis.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
