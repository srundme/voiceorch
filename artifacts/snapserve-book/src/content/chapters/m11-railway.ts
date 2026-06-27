import type { Chapter } from "../types";

export const railwayDeployment: Chapter = {
  slug: "railway-deployment",
  moduleId: "m11",
  number: "12.1",
  title: "Railway Deployment",
  summary:
    "How SnapServe ships to production — the Dockerfile, the GitHub push workflow, Railway's deploy pipeline, and what's different between dev and prod.",
  estMinutes: 18,
  fileRef: "Dockerfile",
  prerequisites: ["server-bootstrap", "wallet-system"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "From code to live call: the deploy chain",
      paragraphs: [
        "Every code change in this codebase follows the same path to production: edit files on Replit → push to GitHub → Railway auto-deploys. Understanding this chain tells you where to look when production is broken and local dev is fine, and vice versa.",
        "Railway is a Platform-as-a-Service (PaaS) that watches your GitHub repository and builds + deploys a new container whenever main branch changes. The build is driven by a `Dockerfile` in the repo root. The container runs the `api-server` bundle, serving both the API and the React dashboard from a single process.",
      ],
    },
    {
      kind: "concept",
      title: "Docker multi-stage builds",
      body: [
        "The `Dockerfile` uses a **multi-stage build** — a technique that produces a small production image by using separate stages for building and running. The first stage (the 'builder') has Node.js, pnpm, and all dev dependencies installed. It compiles TypeScript, bundles the server, and builds the React app. The second stage (the 'runner') starts from a minimal Node.js base, copies only the compiled output, and installs only production dependencies.",
        "A typical Node.js dev environment is ~1.5 GB. The production container is ~200 MB. Multi-stage builds achieve this reduction by not copying the TypeScript compiler, dev tooling, or source files into the final image.",
        "The critical constraint: **everything the runtime needs must be COPY'd into the production stage**. The classic gotcha is the Drizzle migrations folder — `lib/db/drizzle/` must be copied explicitly, otherwise Railway starts with 'Can't find meta/_journal.json' and all DB queries return 500.",
      ],
    },
    {
      kind: "code",
      filename: "Dockerfile",
      language: "dockerfile",
      intro:
        "The Dockerfile structure. Two stages: builder (compiles everything) and runner (only what's needed at runtime).",
      code: `# ── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM node:24-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm@9.15.4

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY lib/ ./lib/
COPY artifacts/api-server/ ./artifacts/api-server/
COPY artifacts/dashboard/ ./artifacts/dashboard/

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @workspace/api-server run build
RUN pnpm --filter @workspace/dashboard run build

# ── Stage 2: Runner ───────────────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app

RUN npm install -g pnpm@9.15.4

COPY --from=builder /app/package.json .
COPY --from=builder /app/pnpm-workspace.yaml .
COPY --from=builder /app/pnpm-lock.yaml .
COPY --from=builder /app/artifacts/api-server/dist/ ./artifacts/api-server/dist/
COPY --from=builder /app/lib/db/drizzle/ ./lib/db/drizzle/   # ← critical

RUN pnpm install --prod --frozen-lockfile

CMD ["node", "artifacts/api-server/dist/index.js"]`,
      lines: [
        {
          lines: "5",
          label: "pin pnpm version",
          explanation:
            "The pnpm version is pinned to exactly `9.15.4` in BOTH stages. `npm install -g pnpm@9` would install the latest 9.x, which can have a different lockfile format than the one in the repo, causing `--frozen-lockfile` to fail with 'lockfile is not up-to-date'.",
        },
        {
          lines: "7-9",
          label: "COPY before install",
          explanation:
            "Only the files needed for the workspace install are copied before `pnpm install`. This preserves Docker layer caching — if `package.json` hasn't changed, Docker reuses the cached layer and skips the full `pnpm install` on the next build. Always copy `package.json` and lock files before source files.",
        },
        {
          lines: "25",
          label: "COPY the migrations folder",
          explanation:
            "The Drizzle migration journal (`lib/db/drizzle/meta/_journal.json`) and migration SQL files must be present at runtime because `migrate()` reads them to decide which migrations to run on startup. Missing this causes the infamous 'Can't find meta/_journal.json' error.",
        },
        {
          lines: "27",
          label: "--prod install in runner",
          explanation:
            "`pnpm install --prod` skips all `devDependencies`. This keeps the production image lean — no TypeScript compiler, no esbuild, no test libraries.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "The GitHub push workflow",
      paragraphs: [
        "Railway deploys from the `srundme/voiceorch` GitHub repository's `main` branch. Every file edit must be pushed there to reach production. Since Replit doesn't have `git push` integrated with GitHub by default, SnapServe uses the **GitHub REST API contents endpoint** to push files programmatically.",
        "The push uses the `GITHUB_PERSONAL_ACCESS_TOKEN` secret (note: NOT `GITHUB_PAT`, which is stale). The flow: read the current file's SHA from GitHub, compute the base64-encoded new content, PUT to `https://api.github.com/repos/srundme/voiceorch/contents/<path>`. GitHub requires the current SHA to do a non-conflicting update.",
        "This approach is fragile for large refactors (every file needs a separate API call) but reliable for targeted edits. Always verify the push succeeded — the REST API returns the new commit SHA on success.",
      ],
    },
    {
      kind: "concept",
      title: "Dev vs. prod: the key differences",
      body: [
        "**Port**: dev binds to `PORT` env var (Replit assigns a unique port per artifact); prod binds to `PORT` set by Railway (default 8080 if unset). Always read `process.env.PORT` — never hardcode a port.",
        "**Database**: dev uses a Replit-hosted PostgreSQL instance (connection string in `DATABASE_URL`). Prod uses a Railway-provisioned PostgreSQL service. The two databases are separate — schema changes in dev must be pushed to prod via the migration system.",
        "**Migrations**: dev uses `pnpm --filter @workspace/db run push` (Drizzle Kit push, instant but lossy). Prod requires the migration SQL to be in `lib/db/drizzle/` and applied via `migrate()` at startup.",
        "**Object storage**: Replit Object Storage doesn't exist inside Railway containers. Recordings are stored as `bytea` in PostgreSQL. Background audio (GCS) is configured via `GCS_*` env vars.",
        "**No hot-reload**: the dev server is a prebuilt esbuild bundle. Restart the workflow after any backend changes. Railway redeploys automatically from GitHub.",
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "The `REPLIT_DOMAINS` vs `APP_DOMAIN` distinction",
      body: [
        "`REPLIT_DOMAINS` is set automatically in the Replit environment and contains the dev preview URL. It's NOT available in Railway production containers. All public-URL derivation goes through `lib/app-domain.ts`, which reads `APP_DOMAIN` env var first, then falls back to `REPLIT_DOMAINS`. Always set `APP_DOMAIN` in your Railway environment variables.",
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "Railway health check",
      body: [
        "Railway uses the `GET /api/healthz` endpoint to confirm the new deployment is healthy before switching traffic. If `/api/healthz` returns anything other than 200, Railway will roll back to the previous deployment. Make sure this endpoint responds quickly (it just returns `{ ok: true }`) and doesn't block on database migrations.",
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why does the Dockerfile pin the pnpm version explicitly in both stages?",
          choices: [
            "Railway requires a pinned pnpm version for its build cache",
            "Floating `pnpm@9` installs the latest 9.x, which can differ from the lockfile's format",
            "To ensure the dev and prod environments use different package managers",
            "pnpm requires explicit versioning to enable workspace mode",
          ],
          correctIndex: 1,
          explanation:
            "Floating version specifiers like `pnpm@9` resolve to different patch versions over time. If the installed version differs from the one that generated the lockfile, `--frozen-lockfile` fails. Pinning ensures reproducibility.",
        },
        {
          prompt: "Why is `lib/db/drizzle/` copied into the production stage of the Dockerfile?",
          choices: [
            "It contains the TypeScript source for Drizzle ORM",
            "The migration journal and SQL files are read at runtime by `migrate()` on startup",
            "Railway requires all lib folders to be present",
            "It contains the Drizzle query builder which is needed at runtime",
          ],
          correctIndex: 1,
          explanation:
            "`migrate()` reads `lib/db/drizzle/meta/_journal.json` to determine which migrations have been applied and which need to run. Without this folder, the server crashes on startup with 'Can't find meta/_journal.json'.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Edit → GitHub push → Railway auto-deploy: the three-step production chain",
        "Multi-stage Dockerfile: builder stage compiles everything, runner stage ships only what's needed (~200 MB vs 1.5 GB)",
        "Pin pnpm version in BOTH stages — floating versions cause --frozen-lockfile failures",
        "Always COPY `lib/db/drizzle/` into the runner stage or startup crashes with missing journal",
        "Use `APP_DOMAIN` env var in Railway — `REPLIT_DOMAINS` is Replit-only",
      ],
    },
  ],
};
