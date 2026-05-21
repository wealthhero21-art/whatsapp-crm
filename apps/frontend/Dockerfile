# --- Build stage ----------------------------------------------------------
FROM node:20-slim AS builder

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /repo
COPY pnpm-workspace.yaml package.json ./
COPY apps/frontend/package.json ./apps/frontend/
COPY packages/shared/package.json ./packages/shared/
COPY tsconfig.base.json ./

RUN pnpm install --frozen-lockfile=false

COPY packages/shared ./packages/shared
COPY apps/frontend ./apps/frontend

RUN pnpm --filter @crm/frontend run build

# --- Runtime stage (internal Caddy: static + reverse proxy, no TLS) -------
# Coolify-Traefik handles TLS termination for the public domain.
FROM caddy:2-alpine

COPY --from=builder /repo/apps/frontend/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile

EXPOSE 8080
