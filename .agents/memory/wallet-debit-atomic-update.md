---
name: Wallet debit must use atomic SQL update
description: Read-then-write wallet debits lose updates under concurrent call-end races; use GREATEST(0, balance - amount) SQL and read the balance back from the update's RETURNING clause for any post-debit threshold logic.
---

Wallet balance debits (call-end billing) must be a single atomic SQL statement — `sql\`GREATEST(0, ${col} - ${amount})\`` in the `.set()` — never a `SELECT balance` followed by a computed `UPDATE`. Two calls ending concurrently for the same user can otherwise interleave and one debit is silently lost (lost-update race).

**Why:** `artifacts/api-server/src/orchestration/session.ts` and `artifacts/api-server/src/routes/calls.ts` both had independent read-then-write debit paths; the wallet top-up flow (`wallet.ts`) already used an atomic increment, so the debit paths were the odd ones out.

**How to apply:** When you need the post-debit balance for follow-on logic (e.g. autopay threshold checks), don't reuse the pre-update `SELECT` value — add `.returning({ walletBalanceCents: ... })` to the atomic `UPDATE` and use that value. Any new debit path must follow this pattern, not copy the old select-then-subtract style.
