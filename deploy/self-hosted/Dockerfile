# Self-hosted orchestration-layer image: api-server + dashboard only.
# Excludes the SnapServe internal admin panel and any managed-key seeding —
# self-hosted deployments are BYOP-only (bring your own provider keys).
FROM node:22-slim AS builder
WORKDIR /workspace

RUN npm install -g pnpm@10.26.1

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY tsconfig.base.json tsconfig.json ./
COPY lib/db/package.json ./lib/db/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/dashboard/package.json ./artifacts/dashboard/
COPY scripts/package.json ./scripts/

RUN pnpm install --frozen-lockfile

COPY lib/ ./lib/
COPY artifacts/api-server/ ./artifacts/api-server/
COPY artifacts/dashboard/ ./artifacts/dashboard/

RUN PORT=3000 BASE_PATH=/ pnpm --filter @workspace/dashboard run build

RUN pnpm --filter @workspace/api-server run build

FROM node:22-slim
WORKDIR /workspace

# libgomp1 is required by onnxruntime-node's native CPU-execution addon at runtime
# (used for Silero VAD). Without it the server crashes at startup with
# "libgomp.so.1: cannot open shared object file" before binding the port.
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@10.26.1

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY lib/db/package.json ./lib/db/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY artifacts/api-server/package.json ./artifacts/api-server/

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /workspace/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=builder /workspace/artifacts/dashboard/dist ./artifacts/dashboard/dist
COPY lib/db/drizzle ./lib/db/drizzle

ENV NODE_ENV=production
ENV FRONTEND_DIST_PATH=artifacts/dashboard/dist/public
# No ADMIN_DIST_PATH — the internal ops admin panel is never shipped to self-hosted customers.
# No managed-key seeding envs (GEMINI_API_KEY / GROQ_API_KEY / etc.) are set here —
# self-hosted instances are BYOP-only: customers add their own provider keys in the
# Providers page, since there is no way for us to meter/bill their usage remotely.

EXPOSE 8080

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
