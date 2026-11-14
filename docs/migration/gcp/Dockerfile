# syntax=docker/dockerfile:1.7
# ARI-PST Portal: container image for Google Cloud Run (docs/migration/google-cloud.md, section 4.4).
# Build from the REPO ROOT (the build context must be the whole monorepo):
#   docker build -f docs/migration/gcp/Dockerfile --target runtime -t ari-api:local .
#   docker build -f docs/migration/gcp/Dockerfile --target ops     -t ari-ops:local .
#
# Targets
#   runtime  the API + protected SPA (Cloud Run service) and every Node job (predeploy, crons). Non-root, no shell tools.
#   ops      runtime files + PostgreSQL 16 client tools + age. Only for one-off Cloud Run Jobs: preinit, restore, dumps.
# One image per commit. The same digest goes to staging and production (build once, promote).
# Pin the base images by digest in your registry mirror before production (UNVERIFIED tags: check they exist).

ARG NODE_VERSION=22.21.1
ARG PNPM_VERSION=10.28.0

# ---------- base: Node + pnpm (corepack) ----------
FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /src

# ---------- manifests only (keeps the dependency layers cached when only source changes) ----------
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/public-site/package.json apps/public-site/
COPY packages/api-client/package.json packages/api-client/
COPY packages/contracts/package.json packages/contracts/
COPY packages/design-system/package.json packages/design-system/
COPY packages/domain/package.json packages/domain/
COPY packages/i18n/package.json packages/i18n/
COPY packages/synthetic-data/package.json packages/synthetic-data/
COPY db/package.json db/

# ---------- build: full install, build @ari/api (with its workspace deps) and @ari/web ----------
FROM manifests AS build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter "@ari/api..." build && pnpm --filter @ari/web build \
 && test -f apps/api/dist/server.js && test -f apps/api/dist/openapi.yaml && test -f apps/web/dist/index.html

# ---------- prod-deps: production dependencies of the API and of db/ only ----------
FROM manifests AS prod-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @ari/api --filter @ari/db

# ---------- runtime ----------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    WEB_DIST_DIR=/app/apps/web/dist \
    NODE_OPTIONS=--enable-source-maps
WORKDIR /app
# Root-owned, read-only for the app user. The process writes nothing to the image (object store and DB hold state).
COPY --from=prod-deps /src/node_modules ./node_modules
COPY --from=prod-deps /src/apps/api/node_modules ./apps/api/node_modules
COPY --from=prod-deps /src/db/node_modules ./db/node_modules
COPY --from=build /src/package.json ./package.json
COPY --from=build /src/apps/api/package.json ./apps/api/package.json
COPY --from=build /src/apps/api/dist ./apps/api/dist
COPY --from=build /src/apps/web/dist ./apps/web/dist
COPY --from=build /src/packages/contracts/openapi.yaml ./packages/contracts/openapi.yaml
COPY --from=build /src/db/package.json /src/db/bootstrap.sql /src/db/migrate.mjs ./db/
COPY --from=build /src/db/migrations ./db/migrations
COPY --from=build /src/db/seeds ./db/seeds
COPY --from=build /src/scripts/render-predeploy.mjs ./scripts/render-predeploy.mjs
# APP_VERSION is shown by /livez and /readyz. CI passes the git SHA; the deploy step also sets it as an env var.
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
USER node
EXPOSE 8080
# No HEALTHCHECK: Cloud Run uses its own startup and liveness probes (section 4.5).
CMD ["node", "apps/api/dist/server.js"]

# ---------- ops: one-off database work (preinit, restore, pg_dump). Never serves traffic. ----------
FROM postgres:16-bookworm AS ops
RUN apt-get update && apt-get install -y --no-install-recommends age ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=runtime /app /app
COPY docs/migration/gcp/sql /app/docs/migration/gcp/sql
COPY docs/migration/gcp/restore-into-cloudsql.sh /app/docs/migration/gcp/restore-into-cloudsql.sh
COPY scripts/backup-export.sh scripts/restore-drill.sh /app/scripts/
WORKDIR /app
USER postgres
ENTRYPOINT []
CMD ["bash", "-c", "echo 'ops image: pass a command, e.g. bash docs/migration/gcp/restore-into-cloudsql.sh'; exit 2"]
