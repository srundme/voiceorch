FROM node:24-slim AS builder
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

RUN pnpm install --frozen-lockfile

COPY lib/ ./lib/
COPY artifacts/api-server/ ./artifacts/api-server/
COPY artifacts/dashboard/ ./artifacts/dashboard/

RUN PORT=3000 BASE_PATH=/ pnpm --filter @workspace/dashboard run build

RUN pnpm --filter @workspace/api-server run build

FROM node:24-slim
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
COPY --from=builder /workspace/lib/db/drizzle ./lib/db/drizzle

ENV NODE_ENV=production
ENV FRONTEND_DIST_PATH=artifacts/dashboard/dist/public

EXPOSE 8080

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
