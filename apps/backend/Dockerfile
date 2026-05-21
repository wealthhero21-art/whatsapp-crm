# --- Build stage ----------------------------------------------------------
FROM node:20-slim AS builder

# pnpm via corepack (ships with node 20)
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /repo

# Copy workspace manifests first for better layer caching
COPY pnpm-workspace.yaml package.json ./
COPY apps/backend/package.json ./apps/backend/
COPY packages/shared/package.json ./packages/shared/
COPY tsconfig.base.json ./

RUN pnpm install --frozen-lockfile=false

# Now the actual source
COPY packages/shared ./packages/shared
COPY apps/backend ./apps/backend

RUN pnpm --filter @crm/backend run build

# Prune dev deps for the runtime stage
RUN pnpm --filter @crm/backend deploy --prod /out

# --- Runtime stage --------------------------------------------------------
FROM node:20-slim

# Tini for proper signal handling
RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates && rm -rf /var/lib/apt/lists/*

# Non-root user with a fixed UID so host bind-mounts can be chowned predictably.
RUN groupadd -r -g 999 app && useradd -r -u 999 -g app -d /app -s /usr/sbin/nologin app

WORKDIR /app
COPY --from=builder /out/node_modules ./node_modules
COPY --from=builder /repo/apps/backend/dist ./dist
COPY --from=builder /repo/apps/backend/src/db/migrations ./dist/db/migrations
COPY --from=builder /repo/apps/backend/package.json ./

USER app
EXPOSE 4000
ENV NODE_ENV=production
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/server.js"]
