import type { Chapter } from "../types";

export const memoryGuards: Chapter = {
  slug: "memory-guards",
  moduleId: "m8",
  number: "9.6",
  title: "How Caller Memory Avoids Embarrassing Itself",
  summary:
    "Remembering a caller is easy. Remembering them correctly — without leaking a stale persona, resurrecting an old fact, or copying a broken conversation — is where the real engineering lives.",
  fileRef: "artifacts/api-server/src/orchestration/callerMemory.ts",
  estMinutes: 16,
  prerequisites: ["caller-memory", "caller-memory-tables"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "The difference between memory and good memory",
      paragraphs: [
        "You've already met caller memory's three layers: the **profile** (who this caller is), **facts** (durable things we've learned), and the **archive** of past call summaries. Storing and reloading those is the easy 80%. This chapter is about the hard 20% — the guards that stop memory from becoming a liability.",
        "Think about how a returning-customer greeting goes wrong. The agent that was an insurance bot last month is a real-estate bot today, but it greets a caller about their old policy. Or it states a fact that the caller corrected on the previous call. Or the last call dropped mid-sentence and the agent eagerly resumes a conversation that was already broken. Each of these is worse than having no memory at all. The code in `callerMemory.ts` (on GitHub at `srundme/voiceorch` → `artifacts/api-server/src/orchestration/callerMemory.ts`) has a specific guard for each.",
      ],
    },
    {
      kind: "concept",
      title: "Guard 1 — Persona whiplash",
      body: [
        "An agent can be **repurposed**: a user edits its system prompt and it goes from selling real estate to selling insurance. All the domain memory captured under the old persona is now misleading. We must not let it bleed into the new one.",
        "The trick: store a **fingerprint of the persona** that last wrote this caller's memory, as a reserved hidden fact. On each call, compare the stored fingerprint to the current one. If they differ, the agent was repurposed — flag it and suppress the stale domain memory for this call. If there's no stored fingerprint at all, this is the first persona ever seen, so there's nothing stale to suppress.",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/callerMemory.ts",
      language: "typescript",
      intro:
        "The fingerprint is a short hash of the system prompt only — deliberately NOT of compliance toggles or dates, which would cause false 'persona changed' alarms on every edit.",
      code: `export const PERSONA_HASH_FACT_KEY = "__agent_persona_hash";

export function computePersonaHash(systemPrompt: string | null | undefined): string {
  const src = (systemPrompt ?? "").trim();
  if (!src) return "";
  return createHash("sha1").update(src).digest("hex").slice(0, 16);
}`,
      lines: [
        {
          lines: "1",
          label: "a hidden, reserved fact key",
          explanation:
            "The fingerprint is stored as a fact with a reserved key, so it rides along with the caller's other facts — but it's filtered out before facts are ever shown to the LLM.",
        },
        {
          lines: "4-6",
          label: "hash the persona, nothing else",
          explanation:
            "Only the system prompt (the persona definition) feeds the hash. Including dates or toggles would change the hash on unrelated edits and falsely trigger suppression every call.",
        },
      ],
    },
    {
      kind: "code",
      filename: "orchestration/callerMemory.ts",
      language: "typescript",
      intro: "On load, the stored fingerprint is compared to the current one. Note the careful handling of 'first time' (absence).",
      code: `const storedPersonaHash =
  currentFacts.find(r => r.key === PERSONA_HASH_FACT_KEY)?.value ?? null;

const personaChanged =
  !!currentPersonaHash && !!storedPersonaHash && storedPersonaHash !== currentPersonaHash;`,
      lines: [
        {
          lines: "4-5",
          label: "three conditions, all required",
          explanation:
            "Persona is only 'changed' if we have a current hash AND a stored hash AND they differ. Missing either side means 'no basis for comparison' → not a mismatch → don't suppress. Absence is treated as first-contact, not change.",
        },
      ],
    },
    {
      kind: "concept",
      title: "Guard 2 — Facts are superseded, never overwritten",
      body: [
        "When a caller updates something (\"actually my budget is now 50 lakh, not 30\"), the wrong move is to UPDATE the old fact in place — you'd lose the history and risk races. Instead, memory uses **supersession**: the old fact stays in the table but gets a `superseded_by_id` pointing to the newer fact. A fact is 'current' precisely when its `superseded_by_id` is NULL.",
        "So loading current memory is just: select facts where `superseded_by_id IS NULL`. The full history remains for auditing, but the agent only ever sees the latest truth. This is the same append-only, never-destroy philosophy you'll see in well-built financial and audit systems.",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/callerMemory.ts",
      language: "typescript",
      intro: "The 'current facts' query is the supersession rule in action — one extra WHERE clause does all the work.",
      code: `// L0 — only CURRENT facts (WHERE superseded_by_id IS NULL)
db.select()
  .from(callerFactsTable)
  .where(and(
    eq(callerFactsTable.agentId, agentId),
    eq(callerFactsTable.phoneNumber, phoneNumber),
    isNull(callerFactsTable.supersededById),
  ))
  .orderBy(desc(callerFactsTable.createdAt))`,
      lines: [
        {
          lines: "7",
          label: "isNull(supersededById)",
          explanation:
            "The single line that makes supersession work on read. Superseded (outdated) facts are still in the table for history, but this filter hides them so the agent only sees the latest version.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Guard 3 — One canonical phone identity",
      body: [
        "All three memory tables are keyed on `(agent_id, phone_number)`. But the same caller's number can arrive in many shapes across calls: `+919876543210`, `919876543210`, `09876543210`. If the read path and write path normalise differently, you store memory under one key and look it up under another — and the agent greets a returning caller as a total stranger.",
        "The fix is to run **both** the read and the write through the **same** `canonicalizeCallerKey`. You can see it on the read path: the phone number is canonicalised as the very first step, with a comment calling it 'defense-in-depth'. The guard isn't clever — it's disciplined. The bug it prevents is silent and maddening.",
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Guard 4 — Don't resume a broken conversation",
      body: [
        "When a previous call dropped mid-sentence (within a recent window), memory can load the tail of that conversation so the agent picks the thread back up instead of cold-starting — lovely when it works. The danger: if that dropped call was itself looping or producing garbage, resuming copies the broken thread straight into the new call, which then re-drops the same way. A doom-loop.",
        "So resume is **quality-gated** and strictly best-effort: loading the tail is wrapped in a try/catch that, on any failure, simply continues without resume context rather than blocking memory. An unresumable tail must degrade to a clean cold start, never to a re-played breakdown.",
      ],
    },
    {
      kind: "connections",
      title: "The four guards around memory",
      intro: "Each guard protects a different way returning-caller memory can go wrong.",
      nodes: [
        { id: "load", label: "loadCallerContext", sublabel: "THIS CHAPTER", current: true },
        { id: "persona", label: "Persona hash", sublabel: "suppress stale domain" },
        { id: "supersede", label: "Supersession", sublabel: "only current facts" },
        { id: "canon", label: "Canonical key", sublabel: "same on read + write" },
        { id: "mem", label: "Caller memory", sublabel: "the 3 layers", chapterSlug: "caller-memory" },
      ],
      edges: [
        { from: "load", to: "persona", label: "compare fingerprints" },
        { from: "load", to: "supersede", label: "WHERE superseded IS NULL" },
        { from: "load", to: "canon", label: "normalise first" },
        { from: "mem", to: "load", label: "feeds the prompt" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "How does memory detect that an agent has been repurposed (persona whiplash)?",
          choices: [
            "It checks the agent's creation date.",
            "It stores a hash of the system prompt as a hidden fact and compares it to the current prompt's hash on each call.",
            "It asks the caller.",
            "It counts the number of facts.",
          ],
          correctIndex: 1,
          explanation:
            "A short hash of the system prompt is stored as a reserved fact. If it differs from the current persona's hash, the agent was repurposed and stale domain memory is suppressed.",
        },
        {
          prompt: "What does it mean for a fact to be 'current' under the supersession model?",
          choices: [
            "It was created today.",
            "Its superseded_by_id is NULL — no newer fact has replaced it.",
            "It has the highest id.",
            "It is marked active=true.",
          ],
          correctIndex: 1,
          explanation:
            "Updates never overwrite; they add a new fact and point the old one's superseded_by_id at it. Current facts are exactly those with superseded_by_id IS NULL.",
        },
        {
          prompt: "Why must the read and write paths use the SAME canonicalizeCallerKey?",
          choices: [
            "To save database space.",
            "Because the same number arrives in different formats; mismatched normalisation stores memory under one key and looks it up under another, so a returning caller is missed.",
            "To encrypt the phone number.",
            "It doesn't matter which is used.",
          ],
          correctIndex: 1,
          explanation:
            "Format drift (+91 / 91 / 0 prefixes) means inconsistent keys. Canonicalising identically on both paths guarantees stored memory is found again.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Good caller memory is mostly about guards that prevent embarrassing mistakes, not about storage.",
        "Persona whiplash: a system-prompt hash detects a repurposed agent and suppresses stale domain memory; absence = first contact.",
        "Facts are superseded, never overwritten — 'current' means superseded_by_id IS NULL, preserving full history.",
        "One canonical phone key on BOTH read and write, or a returning caller is silently missed.",
        "Dropped-call resume is quality-gated and best-effort — an unresumable tail degrades to a clean cold start, never a re-played breakdown.",
      ],
    },
  ],
};
