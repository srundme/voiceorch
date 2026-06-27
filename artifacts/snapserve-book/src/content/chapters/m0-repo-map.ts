import type { Chapter } from "../types";

export const repoMap: Chapter = {
  slug: "the-repo-map",
  moduleId: "m0",
  number: "1.2",
  title: "The Repo Map: Where Everything Lives",
  summary:
    "SnapServe is a single repository holding many apps that share code. Learn the folder layout once and you'll always know where to look.",
  estMinutes: 9,
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "One repository, many apps",
      paragraphs: [
        "SnapServe is a **monorepo** — one Git repository that contains several separate applications plus the shared libraries they all depend on. Instead of juggling five repos, everything lives together and can share code instantly.",
        "The tool that makes this work is **pnpm workspaces**. It lets one app import another package in the same repo as if it were installed from the internet — but it's just a folder next door.",
      ],
    },
    {
      kind: "concept",
      title: "Why a monorepo at all?",
      body: [
        "Imagine the database table definitions lived in the backend repo. The frontend also needs to know the shape of an 'Agent' or a 'Call'. In separate repos you'd copy-paste those types and they'd drift out of sync the moment someone changed one.",
        "In a monorepo, the database schema lives in **one shared library** (`lib/db`), and both the API server and the dashboard import from it. Change it once, everyone sees the change. No drift. That single source of truth is the whole reason this layout exists.",
      ],
    },
    {
      kind: "code",
      filename: "(top-level folders)",
      language: "text",
      intro:
        "Here's the shape of the whole project. Don't memorize it — just learn the two big buckets: `artifacts/` (runnable apps) and `lib/` (shared code).",
      code: `snapserve/
├── artifacts/              # Deployable apps (each one runs on its own)
│   ├── api-server/         # The Express backend — the brain. THIS is most of the course.
│   ├── dashboard/          # The React app users log into
│   ├── admin/              # SnapServe's internal ops panel
│   ├── gender-service/     # A small Python service for voice analysis
│   └── pitch-deck/         # Marketing slides
│
├── lib/                    # Shared libraries (imported by the apps above)
│   ├── db/                 # Database tables + types (Drizzle ORM)
│   ├── api-spec/           # The OpenAPI contract — source of truth for the API
│   ├── api-zod/            # Auto-generated validation schemas (don't edit)
│   └── api-client-react/   # Auto-generated React data hooks (don't edit)
│
├── scripts/                # One-off maintenance scripts
├── pnpm-workspace.yaml     # Tells pnpm where the packages are
└── package.json            # Repo-wide commands`,
      lines: [
        {
          lines: "2-7",
          label: "artifacts/",
          explanation:
            "Each folder here is a **deployable app**. The one you'll spend ~80% of the course inside is `api-server` — the Express backend that runs every phone call.",
        },
        {
          lines: "9-13",
          label: "lib/",
          explanation:
            "Shared code that the apps import. `lib/db` is the most important: it defines every database table once, and everyone reuses it.",
        },
        {
          lines: "12-13",
          label: "api-zod / api-client-react",
          explanation:
            "These two are **machine-generated** from `lib/api-spec`. You never hand-edit them — you change the OpenAPI spec and re-run a codegen command. We'll cover this 'contract-first' flow in Module 3.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "A naming convention you'll see constantly",
      body: [
        "Shared libraries are imported with the `@workspace/` prefix — e.g. `import { db } from \"@workspace/db\"`. Whenever you see `@workspace/...` in an import, it means \"a package from somewhere else in this same repo,\" not something downloaded from npm.",
      ],
    },
    {
      kind: "concept",
      title: "The contract-first idea (preview)",
      body: [
        "One pattern is worth flagging early because it shapes the whole backend: the API is **contract-first**.",
        "There's a single file, `lib/api-spec/openapi.yaml`, that describes every endpoint the server offers — its URL, its inputs, its outputs. From that one file, a tool auto-generates two things: validation schemas the server uses to check incoming requests, and typed data-fetching hooks the dashboard uses to call the server.",
        "The payoff: the frontend and backend can never disagree about what an endpoint looks like, because both are generated from the same description. You'll see this in depth in Module 3 — for now, just know the spec file is the source of truth.",
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "What are the two big top-level buckets in the repo?",
          choices: [
            "`src/` and `test/`",
            "`artifacts/` (runnable apps) and `lib/` (shared code)",
            "`frontend/` and `backend/`",
            "`client/` and `server/`",
          ],
          correctIndex: 1,
          explanation:
            "`artifacts/` holds deployable apps; `lib/` holds shared libraries those apps import.",
        },
        {
          prompt: "You see `import { agentsTable } from \"@workspace/db\"`. What does `@workspace/` tell you?",
          choices: [
            "It's a package downloaded from npm.",
            "It's a Node.js built-in module.",
            "It's another package inside this same monorepo.",
            "It's a typo.",
          ],
          correctIndex: 2,
          explanation:
            "The `@workspace/` prefix always means a sibling package in the monorepo — here, the shared database library `lib/db`.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "SnapServe is a pnpm monorepo: many apps + shared libs in one repository.",
        "`artifacts/` = runnable apps; `lib/` = shared code they import.",
        "`@workspace/...` imports are sibling packages in the repo, not npm downloads.",
        "`lib/db` is the single source of truth for database tables and types.",
        "The API is contract-first: `lib/api-spec/openapi.yaml` generates both server validation and frontend hooks.",
      ],
    },
  ],
};
