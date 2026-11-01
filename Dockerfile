# syntax=docker/dockerfile:1
# Built natively on the arm64 VM (Oracle Ampere A1); nothing here is architecture-specific.
# The digest is the multi-arch index for this tag; Dependabot moves tag and digest together.
FROM node:26.13.0-alpine3.24@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    SPECS_DB_PATH=/data/specs.db

# The standalone output leaves out static assets and public/; copy them in beside server.js.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

# The SQLite file lives on a volume; a named volume inherits this ownership on first use.
RUN mkdir -p /data && chown node:node /data
VOLUME /data

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
