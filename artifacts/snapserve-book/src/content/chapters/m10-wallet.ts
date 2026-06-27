import type { Chapter } from "../types";

export const walletSystem: Chapter = {
  slug: "wallet-system",
  moduleId: "m10",
  number: "11.1",
  title: "The Wallet System",
  summary:
    "How SnapServe tracks credits, debits, and free-credit grants — the `wallet_transactions` ledger and the balance column that drives access control.",
  estMinutes: 15,
  fileRef: "artifacts/api-server/src/middlewares/userProvisioning.ts",
  prerequisites: ["minute-rates"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "Why a wallet and not a subscription?",
      paragraphs: [
        "Traditional SaaS billing uses subscriptions: charge a flat fee per month, regardless of usage. SnapServe uses a **prepaid wallet model** instead — users deposit money and calls are debited in real time. This matches how the product is actually used: a call centre might make 10,000 calls in one month and 500 in the next. A flat subscription punishes lean months and creates sticker shock in heavy ones.",
        "The wallet model also dramatically simplifies fraud prevention. A user can't rack up unlimited debt — they can only spend what's in their wallet. The pre-flight balance check before each outbound call (`walletBalanceCents <= 0`) acts as a hard spending gate.",
      ],
    },
    {
      kind: "concept",
      title: "The ledger pattern: transactions as the source of truth",
      body: [
        "The `wallet_transactions` table is a classic accounting **ledger**: an append-only log of every credit and debit. Each row represents one transaction with an `amountCents` (positive for credits, negative for debits) and a `type` (`welcome_credit`, `topup`, `call_debit`, `refund`).",
        "The `users.walletBalanceCents` column is a **denormalised balance** — a running total maintained alongside the ledger. This is a deliberate optimisation. Computing the balance from `SUM(amountCents)` on the full ledger is accurate but slow. The denormalised column enables instant balance checks with a simple SELECT.",
        "The tradeoff: denormalised columns can drift from the ledger if a transaction is inserted without updating the balance, or vice versa. SnapServe handles this by always doing both inside a transaction: `INSERT INTO wallet_transactions ... ; UPDATE users SET walletBalanceCents = walletBalanceCents + ? WHERE id = ?`.",
      ],
    },
    {
      kind: "code",
      filename: "middlewares/userProvisioning.ts",
      language: "typescript",
      intro:
        "New users get a $5 welcome credit on first sign-in. Both the user row and the first ledger transaction are created in one database transaction.",
      code: `const FREE_CREDIT_CENTS = 500; // $5.00

await db.transaction(async (tx) => {
  // Create the user with the starting balance
  const [newUser] = await tx.insert(usersTable).values({
    clerkId: sub,
    email,
    name,
    walletBalanceCents: FREE_CREDIT_CENTS,
  }).returning({ id: usersTable.id });

  // Record the welcome credit in the ledger
  await tx.insert(walletTransactionsTable).values({
    userId:      newUser!.id,
    amountCents: FREE_CREDIT_CENTS,
    type:        "welcome_credit",
    description: "Welcome credit — $5 free to get started",
    callId:      null,
  });
});`,
      lines: [
        {
          lines: "3",
          label: "db.transaction",
          explanation:
            "The `INSERT` into `users` and the `INSERT` into `wallet_transactions` must be atomic. If the user row is created but the ledger insert fails (e.g. a constraint violation), the transaction is rolled back and the user doesn't exist yet. On retry, both happen together correctly.",
        },
        {
          lines: "5-10",
          label: "walletBalanceCents in the users row",
          explanation:
            "The denormalised balance is set at user creation time. Subsequent debits and credits use `walletBalanceCents = walletBalanceCents + amountCents` (atomic increment/decrement in the UPDATE statement).",
        },
        {
          lines: "12-18",
          label: "ledger entry",
          explanation:
            "Every financial event has a ledger row. The `type` column allows filtering by event type (e.g. 'show me all top-ups this month'). `callId` links debits to the specific call, enabling per-call billing history.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "Debiting a call",
      paragraphs: [
        "At call end, `endSession` computes the call duration in minutes and multiplies by the per-minute rate (in cents). The rate depends on whether the call was on the managed plan or BYOP — covered in the next chapter. The debit amount is then atomically applied to both the ledger and the balance column.",
        "A key design decision: the debit happens at **call end**, not upfront. This means a user with exactly $0.10 balance can still start a 2-minute call and go into negative territory if the per-minute rate is above $0.05. The system tolerates a small amount of overspend for user experience — no one wants their call dropped mid-sentence because their balance hit zero.",
        "The practical protection is the pre-flight check at call initiation. If the balance is ≤ 0, `POST /calls` rejects the dial request. Once a call is in progress, it runs to completion. Accounts that go significantly negative (> $1) can be frozen by admin.",
      ],
    },
    {
      kind: "code",
      filename: "routes/calls.ts",
      language: "typescript",
      intro:
        "The call debit at call end. Duration, rate, and debit all computed in one function. The debit is atomic: balance decremented + ledger row inserted in one transaction.",
      code: `async function debitCallWallet(params: {
  userId:      string;
  callId:      number;
  durationSec: number;
  rateCentsPerMin: number;
}): Promise<void> {
  const durationMins = params.durationSec / 60;
  const debitCents   = Math.ceil(durationMins * params.rateCentsPerMin);
  if (debitCents <= 0) return;

  await db.transaction(async (tx) => {
    await tx.update(usersTable)
      .set({ walletBalanceCents: sql\`wallet_balance_cents - \${debitCents}\` })
      .where(eq(usersTable.clerkId, params.userId));

    await tx.insert(walletTransactionsTable).values({
      userId:      params.userId,  // denormalised for query speed
      callId:      params.callId,
      amountCents: -debitCents,   // negative = debit
      type:        "call_debit",
      description: \`Call \${params.callId}: \${durationMins.toFixed(2)} min @ \${params.rateCentsPerMin}¢/min\`,
    });
  });
}`,
      lines: [
        {
          lines: "7-8",
          label: "Math.ceil the debit",
          explanation:
            "`Math.ceil` rounds up to the nearest cent. A 1.1-minute call at 5¢/min = 5.5¢ rounded up to 6¢. This is standard in per-minute billing — partial minutes are billed as whole minutes in most telephony products.",
        },
        {
          lines: "13-14",
          label: "atomic balance decrement",
          explanation:
            "Using `wallet_balance_cents - ${debitCents}` in a SQL expression (not a read-then-write in application code) ensures the decrement is atomic. If two calls end simultaneously for the same user, their balance updates don't race.",
        },
        {
          lines: "18",
          label: "amountCents is negative for debits",
          explanation:
            "The ledger uses signed amounts: positive = credit, negative = debit. This convention lets you compute the balance as `SUM(amountCents)` without needing separate credit/debit columns, and it's the standard double-entry bookkeeping convention.",
        },
      ],
    },
    {
      kind: "connections",
      title: "Wallet data flows",
      nodes: [
        { id: "prov",  label: "User provisions",        sublabel: "welcome credit" },
        { id: "topup", label: "Admin top-up",            sublabel: "POST /admin/topup" },
        { id: "users", label: "users.walletBalanceCents", sublabel: "denormalised balance" },
        { id: "ledger",label: "wallet_transactions",    sublabel: "ledger",             current: true },
        { id: "call",  label: "Call ends",              sublabel: "endSession" },
        { id: "gate",  label: "Balance pre-flight",     sublabel: "POST /calls" },
      ],
      edges: [
        { from: "prov",  to: "users",  label: "500¢ credit" },
        { from: "prov",  to: "ledger", label: "welcome_credit row" },
        { from: "topup", to: "users",  label: "N¢ credit" },
        { from: "topup", to: "ledger", label: "topup row" },
        { from: "call",  to: "users",  label: "-debitCents" },
        { from: "call",  to: "ledger", label: "call_debit row" },
        { from: "gate",  to: "users",  label: "balance check" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why is the `walletBalanceCents` column on the `users` table kept in sync with the `wallet_transactions` ledger, instead of just computing it from the ledger on demand?",
          choices: [
            "Because the ledger is in a different database",
            "Computing SUM(amountCents) from the full ledger on every balance check would be slow",
            "The ledger only stores debits, not credits",
            "For compliance — auditors require a separate balance column",
          ],
          correctIndex: 1,
          explanation:
            "The `walletBalanceCents` column is a denormalised balance for performance. Computing `SUM(amountCents)` from the full ledger is correct but O(n) in the number of transactions. A user with years of history would have a slow balance check. The denormalised column makes it O(1).",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Prepaid wallet model: users spend what they've deposited, no subscription overage risk",
        "`wallet_transactions` is the append-only ledger; `users.walletBalanceCents` is the denormalised running total",
        "Both are always updated together in a database transaction — never one without the other",
        "Debits happen at call END, not upfront — small overspend is tolerated for UX, prevented at call initiation",
        "`Math.ceil` on the debit: partial minutes always billed as full minutes",
      ],
    },
  ],
};
