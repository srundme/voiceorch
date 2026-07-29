# Redeploy trigger: SnapServe × Sarvam family announcement modal.
FROM node:24-slim AS builder
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
COPY artifacts/admin/package.json ./artifacts/admin/
COPY artifacts/snapserve-book/package.json ./artifacts/snapserve-book/

RUN pnpm install --frozen-lockfile

COPY lib/ ./lib/
COPY artifacts/api-server/ ./artifacts/api-server/
COPY artifacts/dashboard/ ./artifacts/dashboard/
COPY artifacts/admin/ ./artifacts/admin/
COPY artifacts/snapserve-book/ ./artifacts/snapserve-book/

RUN PORT=3000 BASE_PATH=/ pnpm --filter @workspace/dashboard run build

RUN PORT=3000 BASE_PATH=/admin-ui/ pnpm --filter @workspace/admin run build

# The SnapServe Book — served at /snapserve-book/ (NOT /book/, the dashboard
# public booking route). Static SPA; built here, served by the api-server.
RUN PORT=3000 BASE_PATH=/snapserve-book/ pnpm --filter @workspace/snapserve-book run build

RUN pnpm --filter @workspace/api-server run build

FROM node:24-slim
WORKDIR /workspace

# ffmpeg is a PATH fallback for the ambient-sound transcode (uploaded tracks).
# The primary path is the ffmpeg-static npm binary, but installing it here too
# guarantees a working ffmpeg in the runtime regardless of the active builder.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

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
COPY --from=builder /workspace/artifacts/admin/dist ./artifacts/admin/dist
COPY --from=builder /workspace/artifacts/snapserve-book/dist ./artifacts/snapserve-book/dist
COPY --from=builder /workspace/lib/db/drizzle ./lib/db/drizzle

ENV NODE_ENV=production
ENV FRONTEND_DIST_PATH=artifacts/dashboard/dist/public
ENV ADMIN_DIST_PATH=artifacts/admin/dist/public
ENV BOOK_DIST_PATH=artifacts/snapserve-book/dist/public

EXPOSE 8080

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
