import type { Chapter } from "../types";

export const modulesAndImports: Chapter = {
  slug: "modules-and-imports",
  moduleId: "m1",
  number: "1.1",
  title: "Modules, Imports & the Event Loop",
  summary:
    "How Node loads files, what import/export really do, and why JavaScript can do many things 'at once' on one thread.",
  estMinutes: 12,
  prerequisites: ["the-repo-map"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "SnapServe is hundreds of files. Open any one of them and the first thing you'll see is a wall of `import` lines at the top. Before you can read what a file *does*, you need to read what it *depends on* — and that's what imports tell you.",
        "Two ideas unlock the whole backend. First: **modules** — how Node splits code into files that share work through `import` and `export`. Second: the **event loop** — the reason a single-threaded language can juggle thousands of phone calls without freezing. Get these two and every later chapter reads faster.",
      ],
    },
    {
      kind: "concept",
      title: "What a module actually is",
      body: [
        "A **module** is just a file. Each file in Node is its own little world: the variables and functions you declare inside it are **private** unless you deliberately `export` them. Another file can then `import` those exports by name.",
        "This is how a giant codebase stays sane. The audio code lives in `audio.ts`, the database tables live in their own schema files, the routes live in `routes/`. Nobody can reach into another file's internals by accident — they can only touch what was explicitly exported. That boundary is the single most important tool for keeping a big system understandable.",
        "There are two flavors of export. A **named export** ships a specific thing under a specific name (`export function decodeMulaw`, `export const usersTable`). A **default export** ships one main thing per file, imported without braces. SnapServe uses named exports for almost everything, and default exports mostly for Express routers.",
      ],
    },
    {
      kind: "analogy",
      title: "Modules are shops on a street",
      body: [
        "Picture each file as a shop. The stockroom out back is private — customers never see it. The shop window is the `export` list: only what's in the window is for sale.",
        "An `import` is you walking next door and buying something from their window. You don't need to know how the bakery makes bread; you just import a loaf. SnapServe's whole backend is a street of these shops, each selling a few well-labeled things to the others.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/routes/index.ts",
      language: "typescript",
      intro:
        "Here's a real 'barrel' file — its only job is to import every route module and combine them. Notice it imports dozens of files by name. This one file is a table of contents for the entire API.",
      code: `import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import storageRouter from "./storage.js";
import agentsRouter from "./agents.js";
import callsRouter from "./calls.js";
import providersRouter from "./providers.js";
// … dozens more router imports …
import crmRouter from "./crm.js";
import { provisionUser } from "../middlewares/userProvisioning.js";`,
      lines: [
        {
          lines: "1",
          label: "import { Router, type IRouter } from \"express\"",
          explanation:
            "A **named import** from a third-party package. The curly braces mean 'reach into the `express` package and grab the things called `Router` and `IRouter`.' The `type` keyword marks `IRouter` as a type-only import — it vanishes at runtime.",
        },
        {
          lines: "2-3",
          label: "import healthRouter from \"./health.js\"",
          explanation:
            "A **default import** (no braces). `health.js` exports one main thing — its router — and here we give it the local name `healthRouter`. The `./` means 'a file in this same folder.'",
        },
        {
          lines: "8",
          label: "the .js extension on a .ts file",
          explanation:
            "Surprising gotcha: the file on disk is `health.ts`, but we import `./health.js`. Modern Node ES modules require the runtime extension, and TypeScript keeps it as-is. You'll write `.js` in imports even though you're editing `.ts`.",
        },
        {
          lines: "9",
          label: "import { provisionUser } from \"../middlewares/…\"",
          explanation:
            "`../` climbs one folder up. So this reaches out of `routes/` into the sibling `middlewares/` folder to import one named function. Relative paths are how files find their neighbors.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Why imports end in .js even though the files are .ts",
      body: [
        "SnapServe's backend uses native ES modules, where Node insists on the real file extension in every import path. Because the compiled output is `.js`, the import is written as `./health.js` even though you're staring at `health.ts` in your editor.",
        "If you add a new file and forget the `.js` (or write `.ts`), the import will fail at runtime. When an import 'can't be found' but the file is clearly there, check the extension first.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/routes/index.ts",
      language: "typescript",
      intro:
        "After importing, this file wires the routers together and exports the result. Two patterns to see: `router.use(...)` mounting, and a single default export at the bottom.",
      code: `const router: IRouter = Router();

router.use(agentsRouter);
router.use(callsRouter);
router.use(providersRouter);
// … every other router mounted …

export default router;`,
      lines: [
        {
          lines: "1",
          label: "const router: IRouter = Router()",
          explanation:
            "Create one combined Express router. `: IRouter` is a TypeScript type annotation — the imported type telling us what shape `router` has.",
        },
        {
          lines: "3-5",
          label: "router.use(agentsRouter)",
          explanation:
            "Each imported router is plugged into the combined one. Order can matter here — public routes are mounted before authentication middleware so they stay reachable.",
        },
        {
          lines: "8",
          label: "export default router",
          explanation:
            "The **default export**: the one main thing this file offers. Whoever imports this file (the app bootstrap) gets the fully-assembled router. One file in, the whole API out.",
        },
      ],
    },
    {
      kind: "code",
      filename: "lib/db/src/schema/index.ts",
      language: "typescript",
      intro:
        "The database layer uses a different export trick: `export *` re-exports everything from another file. This barrel makes all ~50 tables importable from one place.",
      code: `export * from "./users";
export * from "./agents";
export * from "./calls";
export * from "./callerProfiles";
// … every schema file re-exported …`,
      lines: [
        {
          lines: "1",
          label: "export * from \"./users\"",
          explanation:
            "'Take every named export from `users.ts` and re-export it from here.' So `usersTable`, `User`, `InsertUser` all become available through this single index file.",
        },
        {
          lines: "1-4",
          label: "the barrel pattern",
          explanation:
            "Because of this file, any other module can write `import { usersTable, agentsTable } from \"@workspace/db\"` instead of hunting down each individual schema path. One tidy front door for fifty tables.",
        },
      ],
    },
    {
      kind: "code",
      filename: "lib/db/src/schema/users.ts",
      language: "typescript",
      intro:
        "And here's the other end — a file that produces named exports. Each `export const` or `export type` is a thing the barrel above can re-share.",
      code: `export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  clerkId: text("clerk_id").notNull().unique(),
  email: text("email"),
  // … more columns …
});

export type User = typeof usersTable.$inferSelect;`,
      lines: [
        {
          lines: "1",
          label: "export const usersTable = …",
          explanation:
            "A **named export**. Anything that imports `usersTable` gets exactly this table definition. Without the `export`, it would be private to this file and unusable elsewhere.",
        },
        {
          lines: "8",
          label: "export type User = …",
          explanation:
            "You can export **types** too, not just values. This one is a type derived from the table — you'll meet `$inferSelect` in the TypeScript chapter. Types are exported and imported just like functions.",
        },
      ],
    },
    {
      kind: "concept",
      title: "The event loop: one thread, no waiting around",
      body: [
        "Node runs your JavaScript on a **single thread** — one worker doing one thing at a time. That sounds like a disaster for a server handling many calls at once. The magic that saves it is the **event loop**.",
        "Here's the trick: most of what a server does is *waiting* — waiting for the database to answer, for a network request to return, for a timer to fire. Instead of standing frozen during those waits, Node hands off the slow job, writes a note that says 'call me back when it's done,' and immediately moves on to other work. When the slow job finishes, the note (a callback) gets queued and run.",
        "So the one thread is never blocked on slow I/O. It's always either doing a quick burst of real work or picking up the next finished job. That's how a single-threaded language serves thousands of concurrent phone calls — it never sits idle waiting.",
      ],
    },
    {
      kind: "analogy",
      title: "The event loop is a short-order cook",
      body: [
        "One cook, one stove. An order comes in for a steak — but the cook doesn't stand and stare at it for ten minutes. They put it on the grill, set a timer, and start chopping veggies for the next order.",
        "When the steak timer dings, they plate it. The cook is never *blocked* by the steak's cooking time; they only spend real effort at the start and the end. The grill (the database, the network) does the slow part. `await` is exactly that timer ding — 'wake me when this is ready, and meanwhile do other tables.'",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/routes/agents.ts",
      language: "typescript",
      intro:
        "A real route handler. The `async` keyword and the `await` on the database query are the event loop in action — this function pauses at `await` without freezing the whole server.",
      code: `router.get("/agents", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const agents = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.userId, clerkId))
    .orderBy(agentsTable.createdAt);
  const sourceIdMap = await getKnowledgeSourceIdsByAgent(agents);
  res.json(ListAgentsResponse.parse(agents.map((a) => prepareAgentForResponse(a, sourceIdMap.get(a.id) ?? []))));
});`,
      lines: [
        {
          lines: "1",
          label: "async (req, res): Promise<void> =>",
          explanation:
            "The `async` keyword marks a function that can `await`. It promises to eventually finish, even though it will pause in the middle. `Promise<void>` says 'this resolves with no return value.'",
        },
        {
          lines: "3-7",
          label: "await db.select()…",
          explanation:
            "`await` says 'pause here until the database answers.' Crucially, while *this* handler is paused, the single thread is free to serve other requests. The database does the slow part on its own.",
        },
        {
          lines: "8",
          label: "a second await",
          explanation:
            "Another pause, this time waiting on a helper that itself queries the DB. Each `await` is another point where the thread can go do other work and come back.",
        },
        {
          lines: "9",
          label: "res.json(...)",
          explanation:
            "Only after both awaits resolve does this run, shaping the data and sending the response. The event loop guaranteed this line waits for the data — without freezing anyone else.",
        },
      ],
    },
    {
      kind: "connections",
      title: "How modules wire SnapServe together",
      intro:
        "Imports are the wiring diagram of the whole backend. This chapter is the foundation for reading any file's top section.",
      nodes: [
        { id: "modules", label: "Modules & imports", sublabel: "this chapter", current: true },
        { id: "async", label: "Async & await", sublabel: "the event loop in code", chapterSlug: "async-await-promises" },
        { id: "routes", label: "routes/index.ts", sublabel: "the route barrel", chapterSlug: "routes-anatomy" },
        { id: "express", label: "Express app", sublabel: "mounts the router", chapterSlug: "express-app" },
        { id: "db", label: "db schema barrel", sublabel: "~50 tables, one door", chapterSlug: "drizzle-intro" },
      ],
      edges: [
        { from: "modules", to: "async", label: "leads to" },
        { from: "routes", to: "express", label: "default export" },
        { from: "db", to: "routes", label: "imported by" },
        { from: "modules", to: "db", label: "export * barrel" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "What's the difference between a named import and a default import?",
          choices: [
            "Named imports are faster.",
            "A named import uses braces to grab specific exports by name; a default import (no braces) grabs the file's single main export.",
            "Default imports only work for types.",
            "There is no difference.",
          ],
          correctIndex: 1,
          explanation:
            "`import { Router } from \"express\"` is named (braces, by name); `import healthRouter from \"./health.js\"` is the default export with a local name you choose.",
        },
        {
          prompt: "Why do SnapServe's imports end in `.js` when the files are `.ts`?",
          choices: [
            "It's a typo that somehow works.",
            "Native ES modules require the runtime file extension, and the compiled output is `.js`.",
            "TypeScript files are secretly JavaScript.",
            "To make imports shorter.",
          ],
          correctIndex: 1,
          explanation:
            "Node's ES module loader needs the real extension in the path. Since code compiles to `.js`, imports are written `./health.js` even while you edit `health.ts`.",
        },
        {
          prompt: "While one request handler is paused at `await db.select()`, what is Node's single thread doing?",
          choices: [
            "Frozen, doing nothing until the database answers.",
            "Spawning a new thread for the query.",
            "Free to serve other requests; it returns to this one when the DB responds.",
            "Crashing.",
          ],
          correctIndex: 2,
          explanation:
            "That's the event loop. `await` hands off the slow I/O and frees the thread, which is why one thread can serve many concurrent calls.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "A module is a file; its insides are private unless `export`ed, and other files reach them via `import`.",
        "Named exports use braces (`import { x }`); a default export is the file's one main thing (`import x`).",
        "Barrel files (`export *` or many re-imports) give a folder one tidy front door.",
        "Imports use the `.js` extension at runtime even though you edit `.ts` files.",
        "Node is single-threaded, but the event loop hands off slow I/O so the thread never freezes — that's why `await` scales.",
      ],
    },
  ],
};
