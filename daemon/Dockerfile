# Production image for the trace2e daemon (HTTP ingest + read API).
# Build context is the repo root:  docker build -f daemon/Dockerfile -t trace2e-daemon .
FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable
# Manifests first for layer caching
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/schema/package.json packages/schema/
COPY daemon/package.json daemon/
RUN pnpm install --frozen-lockfile
# Sources
COPY packages/schema packages/schema
COPY daemon daemon
RUN pnpm --filter @trace2e/schema build && pnpm --filter @trace2e/daemon build

FROM node:20-alpine AS runtime
WORKDIR /app
RUN corepack enable && addgroup -S app && adduser -S app -G app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/schema/package.json packages/schema/
COPY daemon/package.json daemon/
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/packages/schema/dist packages/schema/dist
COPY --from=build /app/daemon/dist daemon/dist
COPY daemon/templates daemon/templates

# Store lives on a mounted volume; bind to all interfaces for the platform to route.
ENV TRACE2E_HOME=/data \
    TRACE2E_HOST=0.0.0.0 \
    TRACE2E_PORT=8787
# Create the store dir owned by the non-root user before dropping privileges.
RUN mkdir -p /data && chown -R app:app /data
VOLUME ["/data"]
EXPOSE 8787
USER app

# TRACE2E_TOKEN must be provided as a secret at runtime.
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/health || exit 1
CMD ["node", "daemon/dist/cli.js", "serve"]
