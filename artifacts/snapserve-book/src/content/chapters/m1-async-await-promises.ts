import type { Chapter } from "../types";

export const asyncAwaitPromises: Chapter = {
  slug: "async-await-promises",
  moduleId: "m1",
  number: "1.2",
  title: "Async, Await & Promises",
  summary:
    "The single most important pattern in the codebase: doing slow things (network, DB) without freezing everything else.",
  estMinutes: 12,
  prerequisites: ["modules-and-imports"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "Almost everything SnapServe does is **slow**: querying Postgres, calling OpenAI, streaming audio to a phone carrier. Each of those takes anywhere from a few milliseconds to a few seconds — an eternity for a CPU. If the server stopped and waited for each one, a single slow database query would freeze every other call on the box.",
        "It doesn't, because of three keywords you'll see on nearly every line of backend logic: **Promise**, **async**, and **await**. They are how the codebase does slow things without blocking. Understand this one pattern and 80% of the backend stops looking scary.",
      ],
    },
    {
      kind: "concept",
      title: "A Promise is an IOU",
      body: [
        "A **Promise** is an object that represents a value you don't have *yet* but will get *later*. When you call the database, it doesn't hand you rows immediately — it hands you a Promise: 'I owe you rows; I'll fulfill this soon.'",
        "A Promise lives in one of three states: **pending** (still working), **fulfilled** (succeeded, here's your value), or **rejected** (failed, here's the error). It starts pending and settles into exactly one of the other two, once.",
        "You could handle a Promise with `.then()` callbacks, but SnapServe almost always uses the cleaner syntax: `async` and `await`. They let you write code that *reads* top-to-bottom like normal step-by-step code, while still being non-blocking underneath.",
      ],
    },
    {
      kind: "analogy",
      title: "Async/await is a coffee-shop buzzer",
      body: [
        "You order a latte and the barista hands you a buzzer. That buzzer is a **Promise** — not your coffee, but a guarantee you'll get it. You're free to sit down, scroll your phone, chat with a friend. You're not frozen at the counter.",
        "When the buzzer goes off (the Promise resolves), you collect your latte and carry on. `await` is you deciding to wait for *that specific* buzzer before taking your next sip — but the café keeps serving everyone else the whole time. `async` just marks you as someone who's allowed to hold a buzzer.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/routes/agents.ts",
      language: "typescript",
      intro:
        "Here's a real route handler that lists a user's agents. Watch how `async`/`await` turn an inherently slow database call into clean, sequential-looking code.",
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
          label: "async (req, res): Promise<void>",
          explanation:
            "The `async` keyword is the price of admission: you can only use `await` *inside* an `async` function. It also means this function itself returns a Promise — `Promise<void>` here (it resolves with nothing).",
        },
        {
          lines: "3-7",
          label: "const agents = await db.select()…",
          explanation:
            "Without `await`, `agents` would be a Promise (an IOU), not the rows. With `await`, the function pauses until the IOU is paid, then `agents` holds the real array. The thread is free to serve others while paused.",
        },
        {
          lines: "8",
          label: "await a second time",
          explanation:
            "These two awaits run **in sequence**: the second only starts after the first finishes, because the helper needs the `agents` list as its input. Sequential awaits are correct whenever step 2 depends on step 1.",
        },
        {
          lines: "9",
          label: "the line that needs the data",
          explanation:
            "By the time we reach `res.json`, both awaits have resolved, so `agents` and `sourceIdMap` are real values. `await` guarantees this ordering — no callbacks, no nesting, just top-to-bottom reading.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Forget `await` and you ship a Promise instead of a value",
      body: [
        "If you write `const agents = db.select()...` without `await`, `agents` is a pending Promise, not an array. Calling `.map()` on it throws, or worse, you serialize `{}` to the client.",
        "The classic symptom is a value that prints as `Promise { <pending> }` or a 'is not a function' error on what should be an array. When data looks empty or wrong, check that every slow call has its `await`.",
      ],
    },
    {
      kind: "concept",
      title: "Sequential vs parallel awaits",
      body: [
        "Awaiting one thing after another is right when each step **needs** the previous result. But sometimes you have several *independent* slow calls — say, three different database counts. Awaiting them one by one wastes time: you pay for their durations added together.",
        "`Promise.all([...])` fixes that. You kick off all the Promises at once, then `await` the whole array. They run **concurrently**, and you wait only as long as the slowest one. It's the difference between three baristas making three drinks at the same time versus one barista making them back-to-back.",
        "Rule of thumb: if step B uses step A's result, await them in sequence. If they're independent, fire them together with `Promise.all` and await once.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/routes/agents.ts",
      language: "typescript",
      intro:
        "This real handler needs three independent aggregations — call counts, fact counts, episode counts. Because none depends on the others, they're launched together with `Promise.all`.",
      code: `const [callStats, factStats, episodeStats] = await Promise.all([
    db.select({
        agentId: callsTable.agentId,
        cnt:     count(),
        lastAt:  max(callsTable.createdAt),
      })
      .from(callsTable)
      .where(inArray(callsTable.agentId, ids))
      .groupBy(callsTable.agentId),
    db.select({ agentId: callerFactsTable.agentId, cnt: count() })
      .from(callerFactsTable)
      .where(and(inArray(callerFactsTable.agentId, ids), isNull(callerFactsTable.supersededById)))
      .groupBy(callerFactsTable.agentId),
    db.select({ agentId: callerCallArchiveTable.agentId, cnt: count() })
      .from(callerCallArchiveTable)
      .where(inArray(callerCallArchiveTable.agentId, ids))
      .groupBy(callerCallArchiveTable.agentId),
  ]);`,
      lines: [
        {
          lines: "1",
          label: "await Promise.all([ … ])",
          explanation:
            "`Promise.all` takes an array of Promises and returns one Promise that resolves when **all** of them do. A single `await` then waits for the whole batch.",
        },
        {
          lines: "1",
          label: "const [callStats, factStats, episodeStats] = …",
          explanation:
            "Array **destructuring**: the results come back in the same order as the input array, so the first query's result lands in `callStats`, the second in `factStats`, the third in `episodeStats`.",
        },
        {
          lines: "2-9",
          label: "first independent query",
          explanation:
            "These three queries hit three different tables and don't depend on each other — perfect candidates to run concurrently rather than one-after-another.",
        },
        {
          lines: "1-18",
          label: "why this is faster",
          explanation:
            "Sequentially, total time ≈ query1 + query2 + query3. With `Promise.all`, total time ≈ the **slowest single** query. For three DB round-trips that's a real latency win on a hot endpoint.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "warning",
      title: "Promise.all is all-or-nothing",
      body: [
        "If **any** Promise in `Promise.all` rejects, the whole thing rejects immediately with that error — the others' results are discarded.",
        "That's usually what you want for required data (if one count fails, the response is incomplete anyway). But if you need every result regardless of individual failures, reach for `Promise.allSettled` instead, which reports each outcome separately.",
      ],
    },
    {
      kind: "concept",
      title: "Fire-and-forget: when you deliberately don't await",
      body: [
        "Occasionally you want to start a slow job but **not** make the user wait for it — logging, sending a notification, saving a background snapshot. The response should go out now; the side job can finish whenever.",
        "SnapServe handles this with a `void` before an async call, signalling 'I'm intentionally not awaiting this.' The work still runs on the event loop, but the handler moves on. The trade-off: you must handle errors *inside* the un-awaited job, because nobody is `await`ing to catch them.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/routes/agents.ts",
      language: "typescript",
      intro:
        "After responding to a PATCH, this handler saves a draft snapshot in the background. The response already went out; this runs after, on purpose.",
      code: `  res.json(UpdateAgentResponse.parse(prepareAgentForResponse(agent, sourceIdMap.get(agent.id) ?? [])));

  // Fire-and-forget: auto-save a draft snapshot after every successful PATCH.
  // Failures must never surface to the user or affect the save result.
  void (async () => {
    try {
      // … build and insert the draft snapshot …
    } catch (err) {
      req.log.warn({ err }, "auto-draft snapshot failed (non-fatal)");
    }
  })();`,
      lines: [
        {
          lines: "1",
          label: "res.json(...) first",
          explanation:
            "The user's response is sent **before** the background work starts. Their request is already complete — they won't wait one millisecond for the snapshot.",
        },
        {
          lines: "5",
          label: "void (async () => { … })()",
          explanation:
            "An async function defined and immediately called. The leading `void` is a deliberate signal: 'I know I'm not awaiting this Promise, and that's intentional.' The work runs in the background.",
        },
        {
          lines: "6-10",
          label: "try / catch inside",
          explanation:
            "Because nobody awaits this, an error here would become an unhandled rejection. So the job wraps itself in `try/catch` and just logs a non-fatal warning — failures can't break the user's save.",
        },
      ],
    },
    {
      kind: "connections",
      title: "Where async/await flows",
      intro:
        "Async/await is the bloodstream of the backend — every DB query, every provider call, every audio step uses it.",
      nodes: [
        { id: "async", label: "Async & await", sublabel: "this chapter", current: true },
        { id: "modules", label: "Modules & the event loop", sublabel: "the why underneath", chapterSlug: "modules-and-imports" },
        { id: "routes", label: "Route handlers", sublabel: "await the DB", chapterSlug: "routes-anatomy" },
        { id: "pipeline", label: "The call pipeline", sublabel: "awaits STT / LLM / TTS", chapterSlug: "session-and-pipeline" },
        { id: "adapters", label: "Provider adapters", sublabel: "await network calls", chapterSlug: "adapter-pattern" },
      ],
      edges: [
        { from: "modules", to: "async", label: "enables" },
        { from: "async", to: "routes", label: "used by" },
        { from: "async", to: "pipeline", label: "used by" },
        { from: "pipeline", to: "adapters", label: "awaits" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "What does `await db.select()...` give you, compared to leaving off `await`?",
          choices: [
            "Nothing changes.",
            "With `await` you get the resolved value (the rows); without it you get a pending Promise.",
            "`await` makes the query run twice.",
            "`await` only works on network calls, not databases.",
          ],
          correctIndex: 1,
          explanation:
            "A Promise is an IOU. `await` waits for it to settle and unwraps the real value; without `await` the variable holds the unresolved Promise itself.",
        },
        {
          prompt: "When should you use `Promise.all` instead of awaiting calls one by one?",
          choices: [
            "Always — it's faster in every case.",
            "When the calls are independent of each other, so they can run concurrently.",
            "Only for database calls.",
            "When you want errors to be ignored.",
          ],
          correctIndex: 1,
          explanation:
            "Use `Promise.all` for independent work so total time ≈ the slowest call. If step B needs step A's result, you must await them in sequence.",
        },
        {
          prompt: "Why does the fire-and-forget draft snapshot wrap its body in `try/catch`?",
          choices: [
            "To make it run faster.",
            "Because nobody awaits it, so an error would become an unhandled rejection unless caught inside.",
            "TypeScript requires it.",
            "To send the error to the user.",
          ],
          correctIndex: 1,
          explanation:
            "Un-awaited Promises have no caller to catch their rejection. Handling errors inside keeps a background failure from crashing the process — and it stays non-fatal to the user's request.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "A Promise is a placeholder for a value you'll get later; it ends up fulfilled or rejected, exactly once.",
        "`async` marks a function that may pause; `await` unwraps a Promise into its real value without freezing the thread.",
        "Await in sequence when step B needs step A's result; use `Promise.all` for independent calls to run them concurrently.",
        "`Promise.all` is all-or-nothing — one rejection fails the whole batch (use `Promise.allSettled` when you need every outcome).",
        "Forgetting `await` ships a pending Promise instead of data — a top cause of 'empty' or broken responses.",
        "`void (async () => {…})()` is deliberate fire-and-forget; it must catch its own errors.",
      ],
    },
  ],
};
