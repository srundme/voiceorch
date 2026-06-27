import type { Chapter } from "../types";

export const minuteRates: Chapter = {
  slug: "minute-rates",
  moduleId: "m8",
  number: "8.1",
  title: "Billing: Managed vs BYOP per Call",
  summary:
    "How each call's cost and billing mode is resolved at call-end, and where wallet balances live.",
  estMinutes: 16,
  fileRef: "artifacts/api-server/src/services/minute-rates.ts",
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "SnapServe makes money one way: it charges a small fee for **every minute** an AI agent spends on a call. But the fee isn't the same for everyone. There are two plans, and which one applies to a given call isn't decided when the agent is created — it's decided the **moment the call ends**.",
        "`minute-rates.ts` is the tiny, sharp file that answers two questions at call-end: *which plan is this call on?* and *how many cents per minute is that?* It's only ~70 lines, but it sits on the cash register of the entire product. Understanding it means understanding SnapServe's business model in code form.",
      ],
    },
    {
      kind: "concept",
      title: "Two plans: Managed vs BYOP",
      body: [
        "**Managed plan** (the default for every new sign-up): the user creates agents, and SnapServe supplies all the provider keys — the OpenAI key, the Deepgram key, the ElevenLabs key. Because SnapServe is paying those vendors, it charges more: **$0.05/min** (5 cents).",
        "**BYOP — Bring Your Own Providers**: the user pastes their own API keys into the Providers page. Now they pay OpenAI, Deepgram, etc. directly, and SnapServe is only orchestrating the call. So the fee drops to a pure orchestration charge: **$0.035/min** (3.5 cents).",
        "The clever part: nobody flips a 'plan' switch. The mode is **inferred** from whether the user has their own keys for the providers this agent actually uses. Add keys → you're BYOP. Remove them → you're back on managed. It's all decided fresh at billing time.",
      ],
    },
    {
      kind: "callout",
      variant: "why",
      title: "Why resolve the mode at call-end, not store it?",
      body: [
        "Agents have an `agentMode` column that defaults to `\"managed\"`, but it can go **stale** — a user adds provider keys long after creating the agent, and that column never gets updated.",
        "By recomputing the mode from the live `providers` table every time a call ends, the bill is **always correct** regardless of what the column says. The source of truth is 'does this user have keys right now?', not a value frozen at creation.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/services/minute-rates.ts",
      language: "typescript",
      intro:
        "First, the two rates as named constants and a one-line helper that turns a mode into a number.",
      code: `export const MANAGED_RATE_CENTS_PER_MIN = 5;    // $0.050 / min
export const BYOP_RATE_CENTS_PER_MIN    = 3.5;  // $0.035 / min

/**
 * Returns the flat per-minute charge in cents for a given billing mode.
 */
export function getFlatRateCentsPerMin(mode: "managed" | "byop" | string | null | undefined): number {
  return mode === "byop" ? BYOP_RATE_CENTS_PER_MIN : MANAGED_RATE_CENTS_PER_MIN;
}`,
      lines: [
        {
          lines: "1-2",
          label: "the two rates, in cents",
          explanation:
            "Money is stored in **cents**, not dollars, to avoid floating-point rounding bugs (the classic reason `$0.10 + $0.20 !== $0.30` in JS). Managed is `5`, BYOP is `3.5` — note BYOP is a fraction of a cent, which matters when we round the final bill.",
        },
        {
          lines: "7-9",
          label: "getFlatRateCentsPerMin",
          explanation:
            "A pure function: give it a mode string, get back a number. The type `\"managed\" | \"byop\" | string | null | undefined` is deliberately loose so callers can pass whatever they have. **Anything that isn't exactly `\"byop\"` falls back to the managed rate** — a safe default that never accidentally undercharges.",
        },
      ],
    },
    {
      kind: "analogy",
      title: "Two checkout lanes at a grocery store",
      body: [
        "Imagine a store with two lanes. The **full-service lane** (managed) bags your groceries for you — pricier, but you bring nothing. The **self-checkout lane** (BYOP) is cheaper because you do the scanning yourself.",
        "You don't pick a lane when you walk in the door. The cashier looks at your cart at the very end: *did you bring your own bags and scan your own items?* If yes → cheaper lane. `resolveAgentBillingMode` is that cashier glance at the cart, performed the instant the call hangs up.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/services/minute-rates.ts",
      language: "typescript",
      intro:
        "The heart of the file: deciding managed vs BYOP by comparing the agent's providers against the user's own keys.",
      code: `export async function resolveAgentBillingMode(
  clerkId: string | null | undefined,
  agent: {
    asrProvider?: string | null;
    llmProvider?: string | null;
    ttsProvider?: string | null;
  },
): Promise<"managed" | "byop"> {
  if (!clerkId) return "managed";

  const agentProviders = [agent.asrProvider, agent.llmProvider, agent.ttsProvider]
    .filter((p): p is string => !!p)
    .map(p => p.toLowerCase());

  if (agentProviders.length === 0) return "managed";

  const userProviders = await db
    .select({ providerName: providersTable.providerName })
    .from(providersTable)
    .where(eq(providersTable.userId, clerkId));

  const userProviderSet = new Set(
    userProviders.map(p => p.providerName.toLowerCase()),
  );

  const isActuallyByop = agentProviders.some(p => userProviderSet.has(p));
  return isActuallyByop ? "byop" : "managed";
}`,
      lines: [
        {
          lines: "1-8",
          label: "the signature",
          explanation:
            "Takes the user's id (`clerkId` — which here is actually the Google `sub`, see the Auth model) and a tiny slice of the agent: just its three AI providers. It returns a `Promise` because it has to hit the database. The return type is narrowed to exactly `\"managed\" | \"byop\"`.",
        },
        {
          lines: "9",
          label: "no user → managed",
          explanation:
            "If there's no user id (e.g. an anonymous or system call), we can't look up any keys, so we safely default to the managed rate. **Fail toward charging the standard price**, never toward free.",
        },
        {
          lines: "11-13",
          label: "collect the agent's providers",
          explanation:
            "Build a list of the agent's ASR + LLM + TTS provider names. `.filter((p): p is string => !!p)` drops any null/empty ones — and that `p is string` is a TypeScript **type guard** that tells the compiler the survivors are definitely strings. Everything is lowercased so `\"OpenAI\"` and `\"openai\"` compare equal.",
        },
        {
          lines: "15",
          label: "no providers configured → managed",
          explanation:
            "If the agent somehow has no providers listed, there's nothing to match against, so it's managed. Another safe early-out.",
        },
        {
          lines: "17-20",
          label: "fetch the user's own keys",
          explanation:
            "One Drizzle query: select every provider name the user has saved keys for, filtered to this user (`eq(providersTable.userId, clerkId)`). This is the 'look in the cart' step.",
        },
        {
          lines: "22-24",
          label: "build a fast lookup Set",
          explanation:
            "Put the user's provider names into a `Set` (lowercased). A `Set` gives O(1) membership checks, so the next step stays fast even if a user has dozens of keys.",
        },
        {
          lines: "26-27",
          label: "the decision",
          explanation:
            "`.some(...)` asks: does the user own a key for **any one** of this agent's providers? If even one matches → BYOP. Otherwise → managed. Per replit.md: 'Any match → BYOP rate. No match → managed rate.'",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/session.ts",
      language: "typescript",
      intro:
        "Here's where it all gets called — inside the telephony session's end-of-call path, which computes the cost and debits the user's wallet.",
      code: `const billingMode     = await resolveAgentBillingMode(sessionCallUserId, ag);
const rateCentsPerMin = getFlatRateCentsPerMin(billingMode);
const billableMinutes = Math.ceil(durationSeconds / 60);
const modeLabel       = billingMode === "managed" ? "managed" : "BYOP";
const rateLabel       = \`$\${(rateCentsPerMin / 100).toFixed(3)}/min (\${modeLabel})\`;
const debitCents      = Math.round(billableMinutes * rateCentsPerMin);
if (debitCents > 0) {
  await db.update(callsTable).set({ costCents: debitCents }).where(eq(callsTable.id, session.callId));
  const [billingUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, sessionCallUserId));
  if (billingUser) {
    const newBalance = Math.max(0, billingUser.walletBalanceCents - debitCents);
    await db.update(usersTable).set({ walletBalanceCents: newBalance }).where(eq(usersTable.id, billingUser.id));
    await db.insert(walletTransactionsTable).values({
      userId:      billingUser.id,
      type:        "call_debit",
      amountCents: -debitCents,
      description: \`Call #\${session.callId} — \${billableMinutes} min × \${rateLabel}\`,
      status:      "completed",
      callId:      session.callId,
    });
  }
}`,
      lines: [
        {
          lines: "1-2",
          label: "resolve mode, then rate",
          explanation:
            "The two functions from this chapter, called back-to-back: first figure out the plan, then convert it to cents-per-minute.",
        },
        {
          lines: "3",
          label: "Math.ceil — round minutes UP",
          explanation:
            "`Math.ceil(durationSeconds / 60)` rounds **up** to the next whole minute. A 61-second call bills as 2 minutes. This is standard telecom billing — you pay for the minute you started.",
        },
        {
          lines: "6",
          label: "compute the debit",
          explanation:
            "`Math.round(billableMinutes * rateCentsPerMin)` gives the final whole-cent charge. Rounding matters because BYOP's `3.5` cents can produce a half-cent (e.g. 3 min × 3.5 = 10.5 → 11 cents).",
        },
        {
          lines: "8",
          label: "store cost on the call",
          explanation:
            "Write `costCents` onto the call row. This both records the bill **and** acts as a 'already billed' flag — the surrounding code skips billing if `costCents` is already set, preventing a double-debit if the HTTP end route also fires.",
        },
        {
          lines: "11-12",
          label: "where wallet balances live",
          explanation:
            "The user's balance is a single column, `usersTable.walletBalanceCents`. Debiting is just subtracting, clamped at zero with `Math.max(0, ...)` so a balance can never go negative.",
        },
        {
          lines: "13-20",
          label: "the audit trail",
          explanation:
            "Every charge also inserts a `wallet_transactions` row — a `call_debit` with a negative amount and a human-readable description. This ledger is what the Wallet page shows the user, and it's how finance reconciles revenue.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "New users get a $5 welcome credit",
      body: [
        "First-time users are provisioned with a **$5 welcome credit** (`userProvisioning.ts`). That's 500 cents — enough for 100 minutes on managed, or ~142 minutes on BYOP. The debit logic above quietly draws this balance down call by call.",
        "The `clerkId` you pass to `resolveAgentBillingMode` is **not** a Clerk id — SnapServe dropped Clerk. The `users.clerk_id` column was repurposed to hold the Google OAuth `sub`. The name stuck so ~20 route files didn't have to change.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "minute-rates.ts is small but central. Here's everything that leans on it at call-end. Click a box to jump to its chapter.",
      nodes: [
        { id: "session", label: "session.ts endSession()", sublabel: "telephony call-end path", chapterSlug: "session-and-pipeline" },
        { id: "calls", label: "PATCH /calls/:id/end", sublabel: "routes/calls.ts — API call-end" },
        { id: "rates", label: "minute-rates.ts", sublabel: "THIS FILE — resolve mode + rate", current: true },
        { id: "providers", label: "providers table", sublabel: "user's own API keys", chapterSlug: "calls-and-providers" },
        { id: "wallet", label: "users.walletBalanceCents", sublabel: "+ wallet_transactions ledger" },
        { id: "billingApi", label: "GET /billing/rates", sublabel: "exposes both rates to the UI" },
      ],
      edges: [
        { from: "session", to: "rates", label: "resolveAgentBillingMode()" },
        { from: "calls", to: "rates", label: "getFlatRateCentsPerMin()" },
        { from: "rates", to: "providers", label: "does user own keys?" },
        { from: "rates", to: "wallet", label: "cents to debit" },
        { from: "rates", to: "billingApi", label: "exported constants" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "A user created an agent months ago (mode column = \"managed\") but yesterday added their own OpenAI key, which this agent uses for its LLM. What rate does today's call bill at?",
          choices: [
            "Managed ($0.05) — the column still says managed.",
            "BYOP ($0.035) — the mode is recomputed from live provider keys at call-end.",
            "It errors because the column and reality disagree.",
            "Free — the user supplies the key.",
          ],
          correctIndex: 1,
          explanation:
            "`resolveAgentBillingMode` ignores the stale column entirely. It checks the live `providers` table; since the user now owns a key for one of the agent's providers, `.some(...)` matches → BYOP.",
        },
        {
          prompt: "Why does `getFlatRateCentsPerMin` return the managed rate for any input that isn't exactly \"byop\"?",
          choices: [
            "Managed is alphabetically first.",
            "It's a safe default — unknown/null/undefined modes never accidentally undercharge.",
            "BYOP is the rarer plan.",
            "Required by TypeScript.",
          ],
          correctIndex: 1,
          explanation:
            "Defaulting to the higher managed rate means a bug or missing value can never silently give away the cheaper price. You fail toward charging the standard amount.",
        },
        {
          prompt: "A call lasts 61 seconds on the managed plan. How many cents is the debit?",
          choices: [
            "5 cents (1 minute).",
            "10 cents (Math.ceil rounds 61s up to 2 minutes × 5¢).",
            "5.08 cents (exact proportional).",
            "0 cents.",
          ],
          correctIndex: 1,
          explanation:
            "`Math.ceil(61 / 60)` = 2 billable minutes. 2 × 5¢ = 10 cents. Telecom billing rounds partial minutes up.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "SnapServe has two plans: managed ($0.05/min, platform keys) and BYOP ($0.035/min, user's own keys).",
        "The plan is resolved dynamically at call-end by `resolveAgentBillingMode`, never read from a stored column.",
        "Rule: if the user owns a key for ANY of the agent's ASR/LLM/TTS providers → BYOP; otherwise → managed.",
        "`getFlatRateCentsPerMin` turns a mode into cents and safely defaults to the managed rate for anything unknown.",
        "Billable minutes round UP (`Math.ceil`); the debit is `Math.round(minutes × rate)` in whole cents.",
        "Balances live in `users.walletBalanceCents`, with every charge mirrored as a `call_debit` row in `wallet_transactions`.",
      ],
    },
  ],
};
