import type { Chapter } from "../types";

export const routesAnatomy: Chapter = {
  slug: "routes-anatomy",
  moduleId: "m3",
  number: "3.5",
  title: "Anatomy of a Route Handler",
  summary:
    "Reading one real CRUD route end to end: validate input, check ownership, hit the DB, shape the response.",
  estMinutes: 14,
  fileRef: "artifacts/api-server/src/routes/agents.ts",
  prerequisites: ["middleware-and-auth", "contract-first-openapi"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "You've seen the request pipeline (`app.ts`), how the server boots (`index.ts`), the contract that defines every shape (`openapi.yaml`), and how identity gets attached (`attachSession`). Now we reach the place where the actual work happens: a **route handler**. This is the function that runs when a verified request finally arrives at, say, `GET /api/agents/42`.",
        "Almost every handler in SnapServe follows the same four-beat rhythm: **validate** the input, **check ownership**, **hit the database**, **shape the response**. Learn that rhythm once from `routes/agents.ts` and you can read any of the ~80 route files in the codebase. This chapter walks real handlers end to end so the pattern becomes second nature.",
      ],
    },
    {
      kind: "concept",
      title: "The four-beat rhythm of a CRUD route",
      body: [
        "**Validate**: never trust the client. Parse the request body and params through a Zod schema (generated from the OpenAPI spec) so malformed input is rejected with a clear `400` before it touches your logic.",
        "**Check ownership**: authentication told you *who* the user is (`req.clerkUserId`); authorization decides *what they can touch*. In a multi-tenant app, user A must never read user B's agents — so every query is scoped by `userId`, and a row that isn't theirs returns `404` (not `403`, so you don't even reveal it exists).",
        "**Hit the database**: run the Drizzle query — select, insert, update, delete — already filtered to this user.",
        "**Shape the response**: don't dump the raw DB row. Strip admin-only and secret fields, mask sensitive tokens, then run it through the response Zod schema so what you send matches the contract exactly.",
      ],
    },
    {
      kind: "analogy",
      title: "A bank teller serving a customer",
      body: [
        "Walk up to a bank teller and they don't just hand you cash. First they check your slip is filled out correctly (validate). Then they confirm the account is **yours** before showing a balance (ownership). Then they go to the vault for your record (the database). Finally they hand you a printed statement — not the bank's raw internal ledger — with the sensitive bits redacted (response shaping).",
        "A route handler is that teller. Skip any step and you get chaos: garbage input crashes the vault, or worse, you hand customer A customer B's statement. The four beats are the discipline that keeps every transaction safe.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/routes/agents.ts",
      language: "typescript",
      intro:
        "The simplest handler shows beats 2–4 in their purest form: list the current user's agents. The router is created once and every route hangs off it.",
      code: `const router: IRouter = Router();

router.get("/agents", requireAuth, async (req, res): Promise<void> => {
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
          label: "Router()",
          explanation:
            "An Express `Router` is a mini-app you attach routes to. This whole file builds one `router`, and `routes/index.ts` mounts it under `/api` alongside all the others — that's why the path here is `/agents`, not `/api/agents`.",
        },
        {
          lines: "3",
          label: 'router.get("/agents", requireAuth, ...)',
          explanation:
            "Register a GET handler. The `requireAuth` middleware sits between the path and the handler — this route's opt-in gate. If `attachSession` didn't attach a user, `requireAuth` returns 401 and the handler never runs.",
        },
        {
          lines: "4",
          label: "read clerkUserId",
          explanation:
            "Pull the verified user id that `attachSession` stamped on the request. The `as any` cast is a pragmatic shortcut for the augmented request type. This id scopes everything below.",
        },
        {
          lines: "5-9",
          label: "ownership-scoped query",
          explanation:
            "The Drizzle query selects from `agentsTable` but is filtered `.where(eq(agentsTable.userId, clerkId))` — so it can only ever return THIS user's agents. Ownership is baked into the query itself, not bolted on after.",
        },
        {
          lines: "11",
          label: "shape via ListAgentsResponse.parse",
          explanation:
            "`prepareAgentForResponse` strips secrets and admin-only fields from each row; then `ListAgentsResponse.parse(...)` (the generated Zod schema) validates the final shape matches the contract before `res.json` sends it. Response shaping, done right.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/routes/agents.ts",
      language: "typescript",
      intro:
        "Response shaping deserves a closer look. These two helpers are how a raw DB row becomes a safe, contract-shaped object.",
      code: `function maskLeadToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const plain = decryptKey(token);
  if (plain.length <= 4) return "****";
  return "..." + plain.slice(-4);
}

function prepareAgentForResponse(
  agent: typeof agentsTable.$inferSelect,
  knowledgeSourceIds: number[] = [],
) {
  // Strip admin-only fields from dashboard responses
  const { generatedPrompt: _gp, promptTemplateVersion: _pv, wizardInputs: _wi, ...rest } = agent;
  return {
    ...rest,
    knowledgeSourceIds,
    leadSourceToken: maskLeadToken(agent.leadSourceToken),
    hasGeneratedPrompt: !!agent.generatedPrompt,
  };
}`,
      lines: [
        {
          lines: "1-6",
          label: "maskLeadToken",
          explanation:
            "Secrets must never leave the server in the clear. This decrypts the stored lead token, then returns only the last 4 characters (e.g. `...a1b2`) — enough for a user to recognize it, useless to a thief. Short tokens become `****`.",
        },
        {
          lines: "13",
          label: "strip admin-only fields",
          explanation:
            "Destructuring with `...rest` pulls OUT `generatedPrompt`, `promptTemplateVersion`, and `wizardInputs` (internal/admin fields) and keeps everything else in `rest`. The underscore names signal 'intentionally discarded.' A clean way to omit fields.",
        },
        {
          lines: "14-19",
          label: "build the safe object",
          explanation:
            "Spread the safe `rest`, attach the resolved `knowledgeSourceIds`, replace the raw token with its masked form, and expose a boolean `hasGeneratedPrompt` instead of the prompt itself. The result is exactly what the dashboard needs and nothing it shouldn't see.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "warning",
      title: "Never return the raw database row",
      body: [
        "A DB row often holds encrypted keys, internal prompt-engineering fields, and admin metadata. `res.json(agent)` straight from the query would leak all of it to the browser.",
        "That's why every handler funnels rows through `prepareAgentForResponse` (strip + mask) and then a generated `*.parse(...)` Zod schema. The Zod parse is a second safety net: if you accidentally include a field the contract doesn't allow, you find out immediately rather than shipping a leak.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/routes/agents.ts",
      language: "typescript",
      intro:
        "The GET-one handler shows all four beats together, including param validation and the ownership 404.",
      code: `router.get("/agents/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params = GetAgentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Validation failed", issues: params.error.issues });
    return;
  }
  const [agent] = await db
    .select()
    .from(agentsTable)
    .where(and(eq(agentsTable.id, params.data.id), eq(agentsTable.userId, clerkId)));
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  const sourceIdMap = await getKnowledgeSourceIdsByAgent([agent]);
  res.json(GetAgentResponse.parse(prepareAgentForResponse(agent, sourceIdMap.get(agent.id) ?? [])));
});`,
      lines: [
        {
          lines: "1",
          label: ":id route param",
          explanation:
            "The `:id` in the path is a URL parameter — Express puts it in `req.params.id`. This route matches `/agents/42`, `/agents/99`, etc.",
        },
        {
          lines: "3-7",
          label: "validate params (beat 1)",
          explanation:
            "`GetAgentParams.safeParse(req.params)` coerces and validates the id (the spec says it's an integer). `safeParse` returns a success/failure object instead of throwing; on failure we send a `400` with the Zod issues and `return` early. Bad input never reaches the DB.",
        },
        {
          lines: "8-11",
          label: "ownership-scoped fetch (beats 2 + 3)",
          explanation:
            "The `and(eq(id), eq(userId))` filter fuses authorization and lookup into one query: fetch the agent **only if** it belongs to this user. There's no separate 'is this mine?' check to forget.",
        },
        {
          lines: "12-15",
          label: "404 on miss",
          explanation:
            "If no row comes back — whether the id doesn't exist OR it belongs to someone else — we return `404 Agent not found`. Returning 404 (not 403) means we never even confirm that another user's agent exists. Privacy by default.",
        },
        {
          lines: "16-17",
          label: "shape & send (beat 4)",
          explanation:
            "Same finish as the list route: resolve related data, strip/mask via `prepareAgentForResponse`, validate with `GetAgentResponse.parse`, send. The four beats, complete.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/routes/agents.ts",
      language: "typescript",
      intro:
        "A write route (POST) adds body validation and an extra business rule, but the rhythm is identical. Here's the start of create-agent.",
      code: `router.post("/agents", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const parsed = CreateAgentBody.safeParse(req.body);
  if (!parsed.success) {
    const issues = parsed.error.issues;
    req.log.warn({ issues, body: req.body }, "Create agent validation failed");
    res.status(400).json({ error: "Validation failed", issues });
    return;
  }
  if (parsed.data.webhookUrl && !parsed.data.webhookUrl.startsWith("https://")) {
    res.status(400).json({ error: "webhookUrl must be a valid https:// URL" });
    return;
  }
  // ...
  const [agent] = await db
    .insert(agentsTable)
    .values(insertData as typeof agentsTable.$inferInsert)
    .returning();
  // ...
  res.status(201).json(GetAgentResponse.parse(prepareAgentForResponse(agent, createdSourceIds)));
});`,
      lines: [
        {
          lines: "3-9",
          label: "validate the body (beat 1)",
          explanation:
            "`CreateAgentBody.safeParse(req.body)` enforces the `AgentInput` contract you saw in the OpenAPI chapter — required fields, the non-blank name, the enums. On failure it logs the issues (handy for debugging) and returns a `400`. The body is now a trusted, typed object.",
        },
        {
          lines: "10-13",
          label: "extra business rule",
          explanation:
            "Beyond schema validation, some rules are domain-specific: a webhook URL must be `https://`. These guards live in the handler because they're about *meaning*, not just *shape*. Each returns its own clear `400`.",
        },
        {
          lines: "15-18",
          label: "insert & return the row (beat 3)",
          explanation:
            "Drizzle's `.insert(...).values(...).returning()` writes the new agent and hands back the created row in one round-trip — `userId` was attached to `insertData` so the new agent is owned by this user from birth.",
        },
        {
          lines: "20",
          label: "201 + shaped response (beat 4)",
          explanation:
            "A successful create returns `201 Created` (the status the spec documented) with the same strip→mask→`parse` shaping. Even freshly-created rows never bypass response shaping.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "safeParse vs parse — pick on purpose",
      body: [
        "Route handlers use `safeParse` for **incoming** data (`req.body`, `req.params`) because bad input is expected and should become a graceful `400`, not a thrown exception.",
        "They use plain `.parse(...)` for **outgoing** data (`ListAgentsResponse.parse(...)`) because a response that doesn't match the contract is a *bug on our side* — you WANT it to throw loudly during development so you catch the leak before users do.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "A route handler is where every earlier layer pays off. Click any box to jump to its chapter.",
      nodes: [
        { id: "router", label: "routes/index.ts", sublabel: "mounts the agents router", chapterSlug: "express-app" },
        { id: "require", label: "requireAuth", sublabel: "gate before the handler", chapterSlug: "middleware-and-auth" },
        { id: "handler", label: "agents.ts handler", sublabel: "THIS FILE — the four beats", current: true },
        { id: "zod", label: "@workspace/api-zod", sublabel: "CreateAgentBody / *Response", chapterSlug: "contract-first-openapi" },
        { id: "db", label: "Drizzle / agentsTable", sublabel: "ownership-scoped query", chapterSlug: "users-and-agents" },
        { id: "client", label: "dashboard hook", sublabel: "useListAgents()", chapterSlug: "data-hooks" },
      ],
      edges: [
        { from: "router", to: "handler", label: "dispatch /agents" },
        { from: "require", to: "handler", label: "401 if no user" },
        { from: "handler", to: "zod", label: "safeParse / parse" },
        { from: "handler", to: "db", label: "where userId = me" },
        { from: "handler", to: "client", label: "JSON response" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt:
            "Why does the GET-one handler return `404` when the agent belongs to a different user, instead of `403`?",
          choices: [
            "404 is faster to send.",
            "Returning 404 (not 403) avoids revealing that another user's agent even exists — privacy by default.",
            "403 isn't a valid status code.",
            "It's a mistake in the code.",
          ],
          correctIndex: 1,
          explanation:
            "The ownership filter fuses lookup and authorization. A miss could mean 'doesn't exist' or 'not yours' — returning an identical 404 for both means you never leak the existence of someone else's data.",
        },
        {
          prompt:
            "Why do handlers use `safeParse` for `req.body` but plain `.parse` for the response?",
          choices: [
            "They are interchangeable.",
            "Bad incoming input is expected and should become a graceful 400 (safeParse); a non-conforming response is a server bug that should throw loudly (.parse).",
            "parse is deprecated.",
            "safeParse only works on objects.",
          ],
          correctIndex: 1,
          explanation:
            "`safeParse` returns success/failure so client mistakes become 400s. `.parse` throws — which is what you want for an outgoing shape that violates the contract, so you catch the bug in development.",
        },
        {
          prompt:
            "What is the role of `prepareAgentForResponse` before sending an agent?",
          choices: [
            "It saves the agent to the database.",
            "It strips admin-only fields and masks secrets (like the lead token) so the raw DB row never leaks to the client.",
            "It validates the incoming request.",
            "It authenticates the user.",
          ],
          correctIndex: 1,
          explanation:
            "It transforms the raw row into a safe shape: drops internal fields via destructuring, masks the decrypted lead token to its last 4 chars, and exposes booleans instead of secrets — then the response Zod schema double-checks it.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Almost every route follows four beats: validate input, check ownership, hit the DB, shape the response.",
        "`requireAuth` is the per-route gate; the handler then reads the verified `req.clerkUserId`.",
        "Ownership is enforced inside the query (`where userId = me`), and a miss returns 404 to avoid leaking existence.",
        "Use `safeParse` for incoming data (graceful 400) and `.parse` for outgoing data (throw on contract violation).",
        "Never return raw DB rows — strip admin fields, mask secrets, then validate the shape against the generated schema.",
        "Drizzle's `.insert(...).returning()` writes and reads back the row in one round-trip, with ownership baked in.",
      ],
    },
  ],
};
