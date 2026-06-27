import type { Chapter } from "../types";

export const callerMemory: Chapter = {
  slug: "caller-memory",
  moduleId: "m8",
  number: "9.4",
  title: "Caller Memory End to End",
  summary:
    "How facts about a caller are extracted, stored under a canonical phone identity, and recalled next time.",
  estMinutes: 18,
  fileRef: "artifacts/api-server/src/orchestration/callerMemory.ts",
  status: "published",
  prerequisites: ["caller-memory-tables"],
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "The difference between a robotic IVR and an agent that feels human is **memory**. When you call back a week later and the agent says 'Hi Priya, did you decide on the 3-bedroom in Whitefield?', it stops being a bot and starts being a relationship. That magic is `callerMemory.ts`.",
        "This chapter traces the full loop: at the **start** of a call, `loadCallerContext` pulls everything we know about this caller; during and at the **end** of the call, the latch functions and `updateCallerProfile` write new facts back. The whole thing hinges on one quietly critical idea — both paths must agree on **who** the caller is. Get that wrong and the agent greets a returning friend as a stranger.",
      ],
    },
    {
      kind: "concept",
      title: "The 3-layer memory model + the identity key",
      body: [
        "Caller memory is organized in three layers: **L0 facts** (`caller_facts` — atomic key/value truths like `name=Priya`, `budget_range=8000000`), **L1 episodes** (`caller_call_archive` — one summary + sentiment per past call), and **L2 sentences** (the raw transcript lines, linked to the facts they support). Together they let the agent recall both specifics and the gist.",
        "Every one of those rows is keyed on `(agent_id, phone_number)`. The catch: a phone number arrives in many shapes across calls — `+919876543210` on one call, `09876543210` the next, inbound calls key off the caller's number while outbound campaigns key off the number we dialed. If the read path and the write path compute even slightly different strings, the memory is stored but never found.",
        "The fix is a single **canonicalization** function, `canonicalizeCallerKey`, that collapses all those variants into one stable string. Both the read path and the write path run every identity through it — so they can never drift apart.",
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "The cardinal rule: canonicalize on BOTH paths",
      body: [
        "Straight from replit.md: the `phone_number` MUST be derived via `canonicalizeCallerKey` on **both** the read path (`loadCallerContext`) and the write path (`updateCallerProfile`/`archiveCall`/`supersedeFact`/`latch*`) — otherwise format drift (a `+` prefix, a trunk `0`, inbound `fromNumber` vs outbound `toNumber`) silently misses stored memory and the agent greets a returning caller as a stranger.",
        "This is why you'll see the exact same line — `phoneNumber = canonicalizeCallerKey(phoneNumber) ?? phoneNumber;` — at the top of every single function that touches caller memory. It's defense-in-depth: even if a caller comes through that didn't canonicalize earlier, these functions fix it before touching the DB.",
      ],
    },
    {
      kind: "code",
      filename: "lib/db/src/caller-identity.ts",
      language: "typescript",
      intro:
        "The single source of truth for the identity key. It handles synthetic web-call ids and real phone numbers alike.",
      code: `export function canonicalizeCallerKey(identity: string | null | undefined): string | null {
  const raw = (identity ?? "").trim();
  if (!raw) return null;

  // Modern canonical form — pass through unchanged.
  if (raw.startsWith(WEBCALL_KEY_PREFIX)) {
    const id = raw.slice(WEBCALL_KEY_PREFIX.length).trim();
    return id ? \`\${WEBCALL_KEY_PREFIX}\${id}\` : null;
  }
  // Raw transport form emitted by webcall.ts — normalise to canonical.
  if (raw.startsWith(WEBCALL_RAW_PREFIX)) {
    const id = raw.slice(WEBCALL_RAW_PREFIX.length).trim();
    return id ? \`\${WEBCALL_KEY_PREFIX}\${id}\` : null;
  }
  // Legacy DB form ("webcall:<id>" without "user_") written by older deployments.
  // Normalise to the modern "webcall:user_<id>" so old history is found.
  if (raw.startsWith(WEBCALL_KEY_LEGACY_PREFIX)) {
    const id = raw.slice(WEBCALL_KEY_LEGACY_PREFIX.length).trim();
    return id ? \`\${WEBCALL_KEY_PREFIX}\${id}\` : null;
  }

  if (isRealPhoneNumber(raw)) return canonicalizePhone(raw);

  // Not a phone number and not a known synthetic shape — nothing to key on.
  return null;
}`,
      lines: [
        {
          lines: "2-3",
          label: "empty → no key",
          explanation:
            "Trim the input; if there's nothing left, return `null`. A null key means 'we can't key memory on this', and callers fall back to treating the person as new.",
        },
        {
          lines: "5-20",
          label: "normalize the three web-call shapes",
          explanation:
            "Browser web calls don't have phone numbers, so they use a synthetic id like `webcall:user_<id>`. Over time three formats existed; all three are folded to the **one** modern form so a user who called before a format change is still recognized.",
        },
        {
          lines: "22",
          label: "real numbers → canonicalizePhone",
          explanation:
            "If it looks like a dialable number (`isRealPhoneNumber`), hand off to `canonicalizePhone`, which strips the `+`, drops trunk zeros, and expands bare national numbers using the market's calling code (India `91` by default).",
        },
        {
          lines: "24-25",
          label: "unknown → null",
          explanation:
            "Anything that's neither a phone nor a known synthetic shape returns `null`. Better no memory than memory keyed on garbage.",
        },
      ],
    },
    {
      kind: "analogy",
      title: "A library card under your true name",
      body: [
        "Imagine a library that files your borrowing history. If one clerk files you under 'Priya R.', another under 'priya raman', and a third under 'P. Raman', you'd have three half-empty records and the librarian would never recognize you.",
        "`canonicalizeCallerKey` is the rule that says 'always file under the full legal name, formatted exactly this way'. Because every clerk (every function) follows the identical rule, all your history lands in **one** record — and the librarian (the agent) greets you like an old friend.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/callerMemory.ts",
      language: "typescript",
      intro:
        "The READ path. At call start, loadCallerContext canonicalizes the key, then fetches all three memory layers in parallel.",
      code: `export async function loadCallerContext(
  agentId: number,
  phoneNumber: string,
  currentPersonaHash?: string,
): Promise<CallerContext> {
  // Defense-in-depth: read with the SAME canonical key the write path uses, so a
  // non-canonical caller string can never silently miss stored memory.
  phoneNumber = canonicalizeCallerKey(phoneNumber) ?? phoneNumber;
  const [profile, currentFacts, recentCalls] = await Promise.all([
    // L1 profile
    loadCallerProfile(agentId, phoneNumber),

    // L0 — only CURRENT facts (WHERE superseded_by_id IS NULL)
    db
      .select()
      .from(callerFactsTable)
      .where(and(
        eq(callerFactsTable.agentId, agentId),
        eq(callerFactsTable.phoneNumber, phoneNumber),
        isNull(callerFactsTable.supersededById),
      ))
      .orderBy(desc(callerFactsTable.createdAt)),

    // L1 episodes — last 5
    db
      .select({ /* ...episode columns... */ })
      .from(callerCallArchiveTable)
      .where(and(
        eq(callerCallArchiveTable.agentId,     agentId),
        eq(callerCallArchiveTable.phoneNumber, phoneNumber),
      ))
      .orderBy(desc(callerCallArchiveTable.createdAt))
      .limit(5),
  ]);`,
      lines: [
        {
          lines: "8",
          label: "canonicalize FIRST",
          explanation:
            "Before any query runs, the incoming number is canonicalized. This single line is the read-side half of the cardinal rule. `?? phoneNumber` keeps the original if canonicalization returns null, so we still attempt a lookup.",
        },
        {
          lines: "9",
          label: "Promise.all — three reads at once",
          explanation:
            "The profile, facts, and recent episodes are independent queries, so they fire concurrently with `Promise.all`. At call start, latency matters — parallelizing keeps the agent's first words fast.",
        },
        {
          lines: "13-21",
          label: "only LIVE facts",
          explanation:
            "`isNull(callerFactsTable.supersededById)` is the key filter: it loads only **current** facts. Outdated facts aren't deleted — they're superseded (we'll see why in the write path) — so this clause hides the history and shows only what's true now.",
        },
        {
          lines: "24-32",
          label: "last 5 episodes",
          explanation:
            "The five most recent call summaries, newest first. These become the 'we last spoke about…' context the agent can reference. Five is enough for continuity without flooding the LLM prompt.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "A log line you'll be grateful for",
      body: [
        "`loadCallerContext` emits a structured `\"Caller memory retrieval\"` log with `hit`, `callCount`, `factCount`, and `archiveCount`. When someone reports 'the agent didn't remember me', this one line tells you instantly whether it was a **miss** (identity drift — wrong key) or genuinely a **first call**. Observability designed for the exact bug the canonical key prevents.",
      ],
    },
    {
      kind: "concept",
      title: "Supersession: never delete, always supersede",
      body: [
        "Facts change. A caller's budget goes from 50 lakh to 80 lakh; their location moves from Pune to Bangalore. The naive approach is to overwrite the old value — but then you lose history and provenance (which call said what).",
        "Instead, caller memory uses a **supersession graph**. Updating a fact inserts a brand-new row and draws a `superseded_by_id` edge from the old row to the new one. The old fact still exists for auditing; it's just no longer 'current'. The read path's `WHERE superseded_by_id IS NULL` is what makes only the newest version visible.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/callerMemory.ts",
      language: "typescript",
      intro:
        "supersedeFact is the write primitive every fact write goes through. Insert-new, then point old at new.",
      code: `    // Find current (non-superseded) fact with this key
    const [existing] = await db
      .select({ id: callerFactsTable.id, value: callerFactsTable.value })
      .from(callerFactsTable)
      .where(and(
        eq(callerFactsTable.agentId, agentId),
        eq(callerFactsTable.phoneNumber, phoneNumber),
        eq(callerFactsTable.key, key),
        isNull(callerFactsTable.supersededById),
      ))
      .orderBy(desc(callerFactsTable.createdAt))
      .limit(1);

    // Same value → no-op
    if (existing && existing.value === value) return existing.id;

    // Insert new fact node
    const [newRow] = await db
      .insert(callerFactsTable)
      .values({
        agentId, phoneNumber, key,
        value:        value.slice(0, 512),
        confidence:   Math.min(1, Math.max(0, confidence)),
        sourceCallId,
      })
      .returning({ id: callerFactsTable.id });

    if (!newRow) return null;

    // Draw superseded_by edge: old → new
    if (existing) {
      await db
        .update(callerFactsTable)
        .set({ supersededById: newRow.id })
        .where(eq(callerFactsTable.id, existing.id));
    }`,
      lines: [
        {
          lines: "2-12",
          label: "find the current value",
          explanation:
            "Look up the existing **live** fact for this key (same `superseded_by_id IS NULL` filter). This tells us whether we're creating fresh or updating.",
        },
        {
          lines: "14-15",
          label: "no-op on no change",
          explanation:
            "If the new value equals the existing one, return early — don't create a duplicate row. This keeps the graph from bloating when a caller repeats themselves across calls.",
        },
        {
          lines: "17-25",
          label: "insert the new node",
          explanation:
            "Always insert a fresh row. `value.slice(0, 512)` caps length defensively; `Math.min(1, Math.max(0, confidence))` clamps confidence into [0,1]. `sourceCallId` records which call asserted this — provenance.",
        },
        {
          lines: "29-35",
          label: "draw the supersession edge",
          explanation:
            "If there was an old value, set its `supersededById` to the new row's id. Now the old fact drops out of every `IS NULL` read but remains in the table — history preserved, current value clear.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/callerMemory.ts",
      language: "typescript",
      intro:
        "Some facts are caught in real time, mid-call, by regex — like the caller stating their name. latchCallerName shows the write path's canonicalization rule again.",
      code: `export async function latchCallerName(opts: {
  agentId: number;
  phoneNumber: string;
  transcript: string;
  existingName: string | null;
  callId: number;
}): Promise<string | null> {
  const { agentId, transcript, existingName, callId } = opts;
  const phoneNumber = canonicalizeCallerKey(opts.phoneNumber) ?? opts.phoneNumber;

  let detected: string | null = null;
  for (const pattern of NAME_PATTERNS) {
    const match = transcript.match(pattern);
    const candidate = match?.[1]?.trim();
    if (candidate && !NAME_STOPWORDS.has(candidate.toLowerCase())) {
      detected = candidate;
      break;
    }
  }

  if (!detected) return null;
  if (detected.toLowerCase() === existingName?.toLowerCase()) return null;`,
      lines: [
        {
          lines: "9",
          label: "canonicalize on the write path too",
          explanation:
            "The same defensive line as the read path. Every write function repeats it — that's how read and write keys stay byte-for-byte identical.",
        },
        {
          lines: "11-18",
          label: "regex name detection",
          explanation:
            "`NAME_PATTERNS` is a list of regexes for 'my name is X', 'I'm X', 'call me X' — including Tamil and Hindi forms. The first match that isn't a stopword (like 'sorry' or 'calling') becomes the detected name.",
        },
        {
          lines: "20-21",
          label: "two early-outs",
          explanation:
            "No name found → return null. Detected name equals what we already have → return null (nothing to write). Only a genuine, new name proceeds to the DB update.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Identity contamination guard",
      body: [
        "There's a subtle trap: a transcript might contain the agent using a **wrong** stored name (left over from a different caller). An LLM extracting facts could then 'confirm' that wrong name. So at call-end, `updateCallerProfile` checks: if a name was latched mid-call (the caller literally said 'my name is…') and the LLM's extracted name disagrees, the **latched name wins**. The caller's self-statement is ground truth — a real safeguard against cross-caller memory bleed.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/callerMemory.ts",
      language: "typescript",
      intro:
        "The WRITE path's entry point. At call-end, updateCallerProfile canonicalizes, bumps the call counter, then runs LLM extraction and fact supersession.",
      code: `  const { agentId, history, llm, existing, callId, wasDropped = false, durationSeconds, callerNameInCall, personaHash, finalLanguage } = opts;
  // Defense-in-depth: write under the SAME canonical key the read path uses.
  const phoneNumber = canonicalizeCallerKey(opts.phoneNumber) ?? opts.phoneNumber;

  if (history.length < 1) return;

  const now      = new Date();
  const newCount = (existing?.callCount ?? 0) + 1;
  const transcript = history.map(t => \`\${t.role === "user" ? "Caller" : "Agent"}: \${t.content}\`).join("\\n");`,
      lines: [
        {
          lines: "3",
          label: "canonicalize — the write half of the rule",
          explanation:
            "Identical canonicalization to the read path. This is the line that guarantees what you save now is found on the next call's `loadCallerContext`.",
        },
        {
          lines: "5",
          label: "nothing said → nothing to learn",
          explanation:
            "If the conversation has no turns, bail. There's no transcript to extract facts from.",
        },
        {
          lines: "8",
          label: "increment the call counter",
          explanation:
            "`(existing?.callCount ?? 0) + 1` — this is how the agent knows you're a returning caller (and how features like intent prediction wait until call #2).",
        },
        {
          lines: "9",
          label: "build the transcript",
          explanation:
            "Flatten the turn history into a single `Caller:/Agent:` labeled string. This is what gets fed to the LLM extractor to pull out structured facts, a summary, and sentiment.",
        },
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "Caller memory is a read-at-start, write-at-end loop, glued together by the canonical key. Click a box to jump to its chapter.",
      nodes: [
        { id: "identity", label: "caller-identity.ts", sublabel: "canonicalizeCallerKey — the key" },
        { id: "load", label: "loadCallerContext", sublabel: "THIS FILE — read path", current: true },
        { id: "update", label: "updateCallerProfile + latch*", sublabel: "THIS FILE — write path", current: true },
        { id: "tables", label: "caller_profiles / facts / archive", sublabel: "the 3 memory layers", chapterSlug: "caller-memory-tables" },
        { id: "session", label: "the live session", sublabel: "loads at start, writes at end", chapterSlug: "session-and-pipeline" },
        { id: "llm", label: "LLM extraction", sublabel: "facts + summary + sentiment", chapterSlug: "llm-adapters" },
      ],
      edges: [
        { from: "session", to: "load", label: "call start" },
        { from: "load", to: "identity", label: "canonical key" },
        { from: "load", to: "tables", label: "read live facts + episodes" },
        { from: "session", to: "update", label: "call end" },
        { from: "update", to: "identity", label: "same canonical key" },
        { from: "update", to: "llm", label: "extract from transcript" },
        { from: "update", to: "tables", label: "supersede facts + archive" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "A caller's number arrives as `+919876543210` on call 1 (stored) and `09876543210` on call 2 (read). Why does the agent still recognize them?",
          choices: [
            "Postgres ignores `+` and leading zeros automatically.",
            "Both the write and read paths run the number through `canonicalizeCallerKey`, which collapses both shapes to the same key.",
            "The agent re-asks for the number every call.",
            "It doesn't — this is the exact bug the system has.",
          ],
          correctIndex: 1,
          explanation:
            "Canonicalization strips the `+`, drops the trunk `0`, and expands the bare national number with the calling code, so both inputs map to the identical `(agent_id, phone_number)` key — found on read.",
        },
        {
          prompt: "Why does updating a caller's budget INSERT a new fact row and set `superseded_by_id` on the old one, instead of overwriting?",
          choices: [
            "Drizzle can't UPDATE text columns.",
            "It preserves history and provenance; the read path shows only the current value via `WHERE superseded_by_id IS NULL`.",
            "To make the table larger.",
            "Because facts are immutable in Postgres.",
          ],
          correctIndex: 1,
          explanation:
            "The supersession graph keeps every past value (with which call asserted it) while the `IS NULL` filter surfaces only the latest. Overwriting would destroy that audit trail.",
        },
        {
          prompt: "At call-end, a name was latched mid-call ('my name is Arun') but the LLM extraction returns 'Anil'. Which name is kept, and why?",
          choices: [
            "Anil — the LLM is more accurate.",
            "Arun — the caller's self-stated, mid-call latched name is ground truth, guarding against identity contamination.",
            "Both are stored.",
            "Neither — a conflict clears the name.",
          ],
          correctIndex: 1,
          explanation:
            "The identity contamination guard trusts the latched, self-stated name over LLM inference, because the transcript may contain the agent using a wrong stored name the LLM could echo back.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Caller memory has three layers: L0 facts, L1 episodes (per-call summaries), and L2 sentences — all keyed on `(agent_id, phone_number)`.",
        "`canonicalizeCallerKey` collapses every phone-number variant (and web-call id) into one stable key, run on BOTH read and write paths.",
        "The cardinal rule: canonicalize on read AND write, or a returning caller is silently treated as a stranger.",
        "`loadCallerContext` reads at call start — in parallel, and only LIVE facts via `WHERE superseded_by_id IS NULL`.",
        "Facts are never deleted: `supersedeFact` inserts a new row and draws a supersession edge, preserving history and provenance.",
        "Names/facts can be latched mid-call by regex, and a self-stated latched name beats LLM extraction to prevent identity contamination.",
      ],
    },
  ],
};
