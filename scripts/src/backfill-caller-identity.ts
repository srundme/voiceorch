/**
 * backfill-caller-identity.ts
 *
 * Rewrites `phone_number` to its canonical form across the three phone-keyed
 * caller-memory tables (caller_profiles, caller_facts, caller_call_archive) so
 * memory captured under non-canonical keys (e.g. "+919876543210" on one call,
 * "919876543210" or "09876543210" on another) is found on future calls.
 *
 * Uses the SAME `canonicalizeCallerKey` the runtime read/write paths use
 * (@workspace/db), so migrated rows and live calls can never disagree.
 *
 * What it does, per table:
 *   - caller_profiles      → rewrite phone_number to canonical. When several rows
 *                            collapse to one (agent_id, canonical) key, KEEP the
 *                            newest profile (most recently called/updated), set its
 *                            call_count to the SUM across the merged rows, and
 *                            delete the now-duplicate rows.
 *   - caller_facts         → rewrite phone_number to canonical. When several CURRENT
 *                            (superseded_by_id IS NULL) facts collapse to the same
 *                            (agent_id, canonical, key), keep the newest as live and
 *                            supersede the older ones (union respecting supersession).
 *   - caller_call_archive  → rewrite phone_number to canonical. All episodes kept;
 *                            episodes are append-only and never merged.
 *
 * The link/sentence tables (caller_sentences, caller_fact_sentence_links,
 * caller_episode_fact_links) are keyed by row id, not phone_number, so they need
 * no rewrite and their edges stay intact.
 *
 * Idempotent: a second run finds everything already canonical with one current
 * fact per key, so it reports (and changes) nothing.
 *
 * Usage:
 *   # dry-run (default, read-only) — prints the plan and exits
 *   DATABASE_URL=<url> pnpm --filter @workspace/scripts run backfill-caller-identity
 *
 *   # apply the rewrite/merge (single transaction)
 *   DATABASE_URL=<url> pnpm --filter @workspace/scripts run backfill-caller-identity -- --apply
 *
 * The apply step rewrites/deletes rows — confirm a production DB backup first.
 */

import {
  db,
  pool,
  callerProfilesTable,
  callerFactsTable,
  callerCallArchiveTable,
  canonicalizeCallerKey,
} from "@workspace/db";
import { eq } from "drizzle-orm";

function canon(p: string): string {
  return canonicalizeCallerKey(p) ?? p;
}

/** Comparable "recency" timestamp for a profile row (newest wins). */
function profileRecency(r: {
  lastCalledAt: Date | null;
  updatedAt: Date | null;
  createdAt: Date | null;
}): number {
  return (r.lastCalledAt ?? r.updatedAt ?? r.createdAt ?? new Date(0)).getTime();
}

async function main() {
  const apply = process.argv.includes("--apply");
  const host = process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "(local)";

  console.log("\n=== SnapServe — Caller Memory Identity Backfill ===");
  console.log(`DATABASE_URL host: ${host}`);
  console.log(`Mode: ${apply ? "APPLY (writes enabled)" : "DRY-RUN (read-only, default)"}\n`);

  // ── Plan: caller_profiles ──────────────────────────────────────────────────
  const profiles = await db
    .select({
      id: callerProfilesTable.id,
      agentId: callerProfilesTable.agentId,
      phoneNumber: callerProfilesTable.phoneNumber,
      callCount: callerProfilesTable.callCount,
      lastCalledAt: callerProfilesTable.lastCalledAt,
      updatedAt: callerProfilesTable.updatedAt,
      createdAt: callerProfilesTable.createdAt,
    })
    .from(callerProfilesTable);

  // Group by (agentId, canonical).
  const profileGroups = new Map<string, typeof profiles>();
  for (const p of profiles) {
    const gk = `${p.agentId}::${canon(p.phoneNumber)}`;
    const arr = profileGroups.get(gk) ?? [];
    arr.push(p);
    profileGroups.set(gk, arr);
  }

  const profilePlans: Array<{
    agentId: number;
    canonical: string;
    survivorId: number;
    mergedCallCount: number;
    rewriteSurvivor: boolean;
    deleteIds: number[];
  }> = [];

  for (const [gk, rows] of profileGroups) {
    const canonical = gk.split("::").slice(1).join("::");
    const survivor = rows.reduce((a, b) => (profileRecency(b) > profileRecency(a) ? b : a));
    const deleteIds = rows.filter(r => r.id !== survivor.id).map(r => r.id);
    const mergedCallCount = rows.reduce((s, r) => s + (r.callCount ?? 0), 0);
    const rewriteSurvivor = survivor.phoneNumber !== canonical;
    // Skip no-ops: single row, already canonical, call_count unchanged.
    if (deleteIds.length === 0 && !rewriteSurvivor) continue;
    profilePlans.push({
      agentId: survivor.agentId,
      canonical,
      survivorId: survivor.id,
      mergedCallCount,
      rewriteSurvivor: rewriteSurvivor || deleteIds.length > 0,
      deleteIds,
    });
  }

  // ── Plan: caller_facts ─────────────────────────────────────────────────────
  const facts = await db
    .select({
      id: callerFactsTable.id,
      agentId: callerFactsTable.agentId,
      phoneNumber: callerFactsTable.phoneNumber,
      key: callerFactsTable.key,
      supersededById: callerFactsTable.supersededById,
      createdAt: callerFactsTable.createdAt,
    })
    .from(callerFactsTable);

  const factRewriteIds: number[] = [];
  for (const f of facts) {
    if (f.phoneNumber !== canon(f.phoneNumber)) factRewriteIds.push(f.id);
  }

  // Dedup current (non-superseded) facts that collapse to the same key.
  // newestId stays live; the rest get superseded_by_id = newestId.
  const currentByKey = new Map<string, typeof facts>();
  for (const f of facts) {
    if (f.supersededById !== null) continue;
    const gk = `${f.agentId}::${canon(f.phoneNumber)}::${f.key}`;
    const arr = currentByKey.get(gk) ?? [];
    arr.push(f);
    currentByKey.set(gk, arr);
  }
  const factSupersede: Array<{ loserId: number; winnerId: number }> = [];
  for (const rows of currentByKey.values()) {
    if (rows.length < 2) continue;
    const winner = rows.reduce((a, b) => {
      const at = a.createdAt?.getTime() ?? 0;
      const bt = b.createdAt?.getTime() ?? 0;
      if (bt !== at) return bt > at ? b : a;
      return b.id > a.id ? b : a;
    });
    for (const r of rows) {
      if (r.id !== winner.id) factSupersede.push({ loserId: r.id, winnerId: winner.id });
    }
  }

  // ── Plan: caller_call_archive ──────────────────────────────────────────────
  const archives = await db
    .select({
      id: callerCallArchiveTable.id,
      phoneNumber: callerCallArchiveTable.phoneNumber,
    })
    .from(callerCallArchiveTable);
  const archiveRewriteIds: number[] = [];
  for (const a of archives) {
    if (a.phoneNumber !== canon(a.phoneNumber)) archiveRewriteIds.push(a.id);
  }

  // ── Report ─────────────────────────────────────────────────────────────────
  const profileRewrites = profilePlans.filter(p => p.rewriteSurvivor).length;
  const profileDeletes = profilePlans.reduce((s, p) => s + p.deleteIds.length, 0);

  console.log("Planned changes:");
  console.log(`  caller_profiles:      ${profileRewrites} canonicalized, ${profileDeletes} duplicate row(s) merged & removed`);
  console.log(`  caller_facts:         ${factRewriteIds.length} phone_number rewritten, ${factSupersede.length} duplicate current fact(s) superseded`);
  console.log(`  caller_call_archive:  ${archiveRewriteIds.length} phone_number rewritten`);
  console.log("");

  if (profilePlans.length > 0) {
    console.log("caller_profiles merges/rewrites:");
    for (const p of profilePlans) {
      const tag = p.deleteIds.length > 0 ? `merge ${p.deleteIds.length + 1}→1` : "rewrite";
      console.log(
        `  agent ${p.agentId} → ${p.canonical}  [${tag}]  survivor id=${p.survivorId}, ` +
          `call_count=${p.mergedCallCount}${p.deleteIds.length ? `, delete ids=[${p.deleteIds.join(",")}]` : ""}`,
      );
    }
    console.log("");
  }

  const totalChanges =
    profileRewrites + profileDeletes + factRewriteIds.length + factSupersede.length + archiveRewriteIds.length;

  if (totalChanges === 0) {
    console.log("Nothing to do — all caller-memory rows are already canonical. ✅\n");
    await pool.end();
    return;
  }

  if (!apply) {
    console.log("Dry-run only — no changes made. Re-run with `-- --apply` to perform the backfill.\n");
    await pool.end();
    return;
  }

  // ── Apply (single transaction) ─────────────────────────────────────────────
  console.log("Applying backfill (single transaction)...\n");
  await db.transaction(async (tx) => {
    // 1. caller_call_archive — rewrite phone_number (no merging).
    for (const id of archiveRewriteIds) {
      const a = archives.find(r => r.id === id)!;
      await tx
        .update(callerCallArchiveTable)
        .set({ phoneNumber: canon(a.phoneNumber) })
        .where(eq(callerCallArchiveTable.id, id));
    }

    // 2. caller_facts — rewrite phone_number, then supersede duplicate currents.
    for (const id of factRewriteIds) {
      const f = facts.find(r => r.id === id)!;
      await tx
        .update(callerFactsTable)
        .set({ phoneNumber: canon(f.phoneNumber) })
        .where(eq(callerFactsTable.id, id));
    }
    for (const s of factSupersede) {
      await tx
        .update(callerFactsTable)
        .set({ supersededById: s.winnerId })
        .where(eq(callerFactsTable.id, s.loserId));
    }

    // 3. caller_profiles — delete duplicates first (frees the unique key), then
    //    rewrite the survivor to the canonical key with the merged call_count.
    for (const p of profilePlans) {
      for (const delId of p.deleteIds) {
        await tx.delete(callerProfilesTable).where(eq(callerProfilesTable.id, delId));
      }
      if (p.rewriteSurvivor) {
        await tx
          .update(callerProfilesTable)
          .set({ phoneNumber: p.canonical, callCount: p.mergedCallCount })
          .where(eq(callerProfilesTable.id, p.survivorId));
      }
    }
  });

  console.log(`✅ Backfill complete — ${totalChanges} change(s) applied.\n`);
  await pool.end();
}

main().catch((err) => {
  console.error("Caller identity backfill failed:", err);
  process.exit(1);
});
