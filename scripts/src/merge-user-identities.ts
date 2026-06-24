/**
 * merge-user-identities.ts
 *
 * Consolidates duplicate `users` rows created by the Clerk → Google OAuth
 * migration. For each email that has a surviving Google identity row plus one
 * or more legacy `user_…` (or duplicate) rows, every piece of that user's data
 * is relinked onto the Google identity, wallet balances/credits are merged, and
 * the now-empty legacy rows are deleted.
 *
 * Shares ALL merge logic with the Google login callback via
 * `@workspace/db`'s identity-merge helpers, so the script and the runtime
 * auto-linking can never drift apart.
 *
 * Canonical identity = the bare-numeric Google sub (matches the live session id;
 * see lib/db/src/identity-merge.ts).
 *
 * Usage:
 *   # dry-run (default, read-only) — prints the plan and exits
 *   DATABASE_URL=<url> pnpm --filter @workspace/scripts run merge-user-identities
 *
 *   # apply the merges (one transaction per email group)
 *   DATABASE_URL=<url> pnpm --filter @workspace/scripts run merge-user-identities -- --apply
 *
 * Idempotent: re-running after a successful apply (or on a clean DB) is a no-op.
 * The apply step requires a confirmed production backup first — see replit.md.
 */

import {
  db,
  pool,
  planAllMerges,
  countRelinks,
  sumSourceWallet,
  executeMergeGroup,
  type SqlExecutor,
} from "@workspace/db";

function fmtCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const host = process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "(local)";

  console.log("\n=== SnapServe — User Identity Merge ===");
  console.log(`DATABASE_URL host: ${host}`);
  console.log(`Mode: ${apply ? "APPLY (writes enabled)" : "DRY-RUN (read-only, default)"}\n`);

  const groups = await planAllMerges(db as unknown as SqlExecutor);

  if (groups.length === 0) {
    console.log("No duplicate identities found — nothing to merge. ✅\n");
    await pool.end();
    return;
  }

  console.log(`Found ${groups.length} email(s) to consolidate:\n`);

  let totalSources = 0;
  let totalWallet = 0;

  for (const group of groups) {
    const walletAdd = sumSourceWallet(group);
    totalSources += group.sources.length;
    totalWallet += walletAdd;

    console.log(`▶ ${group.email}`);
    console.log(`    survivor (Google): ${group.survivor.clerkId}  [users.id=${group.survivor.id}]`);
    if (group.survivorNeedsRename) {
      console.log(`    ⚠ survivor will be renamed to bare sub: ${group.canonicalClerkId}`);
    }
    for (const src of group.sources) {
      console.log(
        `    merge source: ${src.clerkId}  [users.id=${src.id}]  wallet ${fmtCents(src.walletBalanceCents)}` +
          `${src.freeCreditsGranted ? "  (free-credit granted)" : ""}`,
      );
    }
    console.log(`    wallet added to survivor: ${fmtCents(walletAdd)}`);

    const counts = await countRelinks(db as unknown as SqlExecutor, group);
    if (counts.length === 0) {
      console.log(`    rows to relink: none`);
    } else {
      const rendered = counts.map((c) => `${c.table}.${c.column}=${c.rows}`).join(", ");
      const sum = counts.reduce((a, c) => a + c.rows, 0);
      console.log(`    rows to relink (${sum}): ${rendered}`);
    }
    console.log("");
  }

  console.log(
    `Summary: ${groups.length} survivor(s), ${totalSources} legacy/duplicate row(s) to remove, ` +
      `${fmtCents(totalWallet)} wallet to merge.\n`,
  );

  if (!apply) {
    console.log("Dry-run only — no changes made. Re-run with `-- --apply` to perform the merge.\n");
    await pool.end();
    return;
  }

  console.log("Applying merges (one transaction per email group)...\n");
  let done = 0;
  for (const group of groups) {
    await db.transaction(async (tx) => {
      await executeMergeGroup(tx as unknown as SqlExecutor, group);
    });
    done++;
    console.log(`  ✓ ${group.email} merged (${done}/${groups.length})`);
  }

  // Re-plan to confirm idempotency / completeness.
  const remaining = await planAllMerges(db as unknown as SqlExecutor);
  console.log("");
  if (remaining.length === 0) {
    console.log("✅ Merge complete. No duplicate identities remain.\n");
  } else {
    console.log(`⚠ ${remaining.length} email(s) still report work after apply — investigate.\n`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error("Identity merge failed:", err);
  process.exit(1);
});
