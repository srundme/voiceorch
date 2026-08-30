# Build: 2026-06-18 — include all workspace package.json in builder; keep prod stage minimal
FROM node:24.20.0-bookworm-slim AS builder
WORKDIR /workspace

RUN npm install -g pnpm@10.26.1

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY tsconfig.base.json tsconfig.json ./
COPY lib/db/package.json ./lib/db/
COPY lib/brand-icons/package.json ./lib/brand-icons/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY lib/sdk-node/package.json ./lib/sdk-node/
COPY lib/mcp/package.json ./lib/mcp/
COPY lib/snapserve-mcp/package.json ./lib/snapserve-mcp/
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/dashboard/package.json ./artifacts/dashboard/
COPY artifacts/admin/package.json ./artifacts/admin/
COPY artifacts/gender-service/package.json ./artifacts/gender-service/
COPY artifacts/mockup-sandbox/package.json ./artifacts/mockup-sandbox/
COPY artifacts/pitch-deck/package.json ./artifacts/pitch-deck/
COPY scripts/package.json ./scripts/

RUN pnpm install --frozen-lockfile

COPY lib/ ./lib/
COPY artifacts/api-server/ ./artifacts/api-server/
COPY artifacts/dashboard/ ./artifacts/dashboard/
COPY artifacts/admin/ ./artifacts/admin/

RUN PORT=3000 BASE_PATH=/ pnpm --filter @workspace/dashboard run build

RUN PORT=3000 BASE_PATH=/admin-ui/ pnpm --filter @workspace/admin run build

# Hosted MCP is @snapserve/mcp (bundled into api-server). Do not tsc
# @snapserveai/mcp here — that package re-exports @snapserve/mcp and Docker's
# install layout makes tsc fail with TS2307.
RUN pnpm --filter @snapserveai/sdk build \
 && pnpm --filter @snapserve/mcp build \
 && pnpm --filter @workspace/api-server run build

FROM node:24.20.0-bookworm-slim
WORKDIR /workspace

# libgomp1 is required by onnxruntime-node's native CPU-execution addon at runtime.
# node:*-bookworm-slim doesn't ship it; without it the server crashes
# at startup with "libgomp.so.1: cannot open shared object file" before binding the port.
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@10.26.1

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY lib/db/package.json ./lib/db/
COPY lib/brand-icons/package.json ./lib/brand-icons/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY lib/sdk-node/package.json ./lib/sdk-node/
COPY lib/mcp/package.json ./lib/mcp/
COPY lib/snapserve-mcp/package.json ./lib/snapserve-mcp/
COPY artifacts/api-server/package.json ./artifacts/api-server/

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /workspace/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=builder /workspace/artifacts/dashboard/dist ./artifacts/dashboard/dist
COPY --from=builder /workspace/artifacts/admin/dist ./artifacts/admin/dist
COPY --from=builder /workspace/lib/sdk-node/dist ./lib/sdk-node/dist
COPY --from=builder /workspace/lib/snapserve-mcp/dist ./lib/snapserve-mcp/dist
COPY lib/db/drizzle ./lib/db/drizzle
COPY docs/webinar/SnapServe-Portal-Button-Guide.pdf ./docs/webinar/SnapServe-Portal-Button-Guide.pdf
COPY docs/webinar/SnapServe-Team-QA-Prep.pdf ./docs/webinar/SnapServe-Team-QA-Prep.pdf
COPY docs/webinar/SnapServe-Webinar-Architecture-Cheat-Sheet.pdf ./docs/webinar/SnapServe-Webinar-Architecture-Cheat-Sheet.pdf

ENV NODE_ENV=production
ENV FRONTEND_DIST_PATH=artifacts/dashboard/dist/public
ENV ADMIN_DIST_PATH=artifacts/admin/dist/public

EXPOSE 8080

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
