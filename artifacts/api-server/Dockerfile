# Build: 2026-06-15 — remove pgvector, add admin panel at /admin-ui/
FROM node:22-slim AS builder
WORKDIR /workspace

RUN npm install -g pnpm@10

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY tsconfig.base.json tsconfig.json ./
COPY lib/db/package.json ./lib/db/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/dashboard/package.json ./artifacts/dashboard/
COPY artifacts/admin/package.json ./artifacts/admin/

RUN pnpm install --frozen-lockfile

COPY lib/ ./lib/
COPY artifacts/api-server/ ./artifacts/api-server/
COPY artifacts/dashboard/ ./artifacts/dashboard/
COPY artifacts/admin/ ./artifacts/admin/

RUN PORT=3000 BASE_PATH=/ pnpm --filter @workspace/dashboard run build

RUN PORT=3000 BASE_PATH=/admin-ui/ pnpm --filter @workspace/admin run build

RUN pnpm --filter @workspace/api-server run build

FROM node:22-slim
WORKDIR /workspace

RUN npm install -g pnpm@10

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY lib/db/package.json ./lib/db/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY artifacts/api-server/package.json ./artifacts/api-server/

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /workspace/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=builder /workspace/artifacts/dashboard/dist ./artifacts/dashboard/dist
COPY --from=builder /workspace/artifacts/admin/dist ./artifacts/admin/dist
COPY lib/db/drizzle ./lib/db/drizzle

ENV NODE_ENV=production
ENV FRONTEND_DIST_PATH=artifacts/dashboard/dist/public
ENV ADMIN_DIST_PATH=artifacts/admin/dist/public

EXPOSE 8080

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
