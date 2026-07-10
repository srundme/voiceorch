/**
 * Idempotent seeder for the curated pinned Galaxy KB summary entry.
 *
 * Upserts ONE knowledge entry (matched by its exact title,
 * GALAXY_SUMMARY_TITLE) into the target knowledge source, with pinned=true so
 * it sorts first in every full-dump KB injection (call-start baked block +
 * per-turn prefetch fallback). Requires migration 0048 (the `pinned` column)
 * to be applied first.
 *
 * Usage:
 *   DATABASE_URL=<url> pnpm --filter @workspace/scripts run seed-galaxy-kb-summary            # dry-run (default)
 *   DATABASE_URL=<url> pnpm --filter @workspace/scripts run seed-galaxy-kb-summary -- --apply # perform the upsert
 *   pnpm --filter @workspace/scripts run seed-galaxy-kb-summary -- --print                    # print entry for manual paste (no DB needed)
 *   ... -- --source-id 30 --apply                                                             # explicit source (skips name search)
 *
 * Source resolution (when --source-id absent): searches knowledge_sources for
 * name ILIKE '%galaxy%'; exactly one match required, otherwise it lists the
 * candidates and exits so you can pass --source-id explicitly.
 *
 * Idempotency: matched by (source_id, title). Insert if absent; update
 * content/keywords/pinned if present. Any content change resets embedding to
 * NULL (the single re-embed signal — the embed worker back-fills it).
 */
import {
  GALAXY_SUMMARY_TITLE,
  GALAXY_SUMMARY_CONTENT,
  GALAXY_SUMMARY_KEYWORDS,
} from "./galaxy-kb-summary-content";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const PRINT = args.includes("--print");
const sourceIdArgIdx = args.indexOf("--source-id");
const SOURCE_ID_ARG =
  sourceIdArgIdx >= 0 ? Number.parseInt(args[sourceIdArgIdx + 1] ?? "", 10) : null;

async function main(): Promise<void> {
  if (PRINT) {
    console.log("── Title ──────────────────────────────────────────────");
    console.log(GALAXY_SUMMARY_TITLE);
    console.log("── Keywords ───────────────────────────────────────────");
    console.log(GALAXY_SUMMARY_KEYWORDS);
    console.log("── Content (" + GALAXY_SUMMARY_CONTENT.length + " chars) ──");
    console.log(GALAXY_SUMMARY_CONTENT);
    return;
  }

  if (!process.env["DATABASE_URL"]) {
    console.error("DATABASE_URL is required (or use --print for manual-paste output).");
    process.exit(1);
  }

  // Import lazily so --print works without a DB.
  const { db, knowledgeSourcesTable, knowledgeEntriesTable } = await import("@workspace/db");
  const { eq, and, ilike, sql } = await import("drizzle-orm");

  // ── Resolve the target source ─────────────────────────────────────────────
  let sourceId: number;
  let sourceName: string;
  let sourceUserId: string;
  if (SOURCE_ID_ARG !== null && Number.isFinite(SOURCE_ID_ARG)) {
    const rows = await db
      .select({ id: knowledgeSourcesTable.id, name: knowledgeSourcesTable.name, userId: knowledgeSourcesTable.userId })
      .from(knowledgeSourcesTable)
      .where(eq(knowledgeSourcesTable.id, SOURCE_ID_ARG));
    if (rows.length === 0) {
      console.error(`No knowledge source with id=${SOURCE_ID_ARG}.`);
      process.exit(1);
    }
    ({ id: sourceId, name: sourceName, userId: sourceUserId } = rows[0]!);
  } else {
    const candidates = await db
      .select({ id: knowledgeSourcesTable.id, name: knowledgeSourcesTable.name, userId: knowledgeSourcesTable.userId })
      .from(knowledgeSourcesTable)
      .where(ilike(knowledgeSourcesTable.name, "%galaxy%"));
    if (candidates.length === 0) {
      console.error('No knowledge source matching name ILIKE \'%galaxy%\'. Pass --source-id <id> explicitly.');
      process.exit(1);
    }
    if (candidates.length > 1) {
      console.error("Multiple Galaxy sources found — pass --source-id <id> explicitly:");
      for (const c of candidates) console.error(`  id=${c.id}  name="${c.name}"  userId=${c.userId}`);
      process.exit(1);
    }
    ({ id: sourceId, name: sourceName, userId: sourceUserId } = candidates[0]!);
  }
  console.log(`Target source: id=${sourceId} name="${sourceName}"`);

  // ── Find existing entry by (source_id, title) ─────────────────────────────
  const existing = await db
    .select({
      id: knowledgeEntriesTable.id,
      content: knowledgeEntriesTable.content,
      keywords: knowledgeEntriesTable.keywords,
      pinned: knowledgeEntriesTable.pinned,
    })
    .from(knowledgeEntriesTable)
    .where(and(
      eq(knowledgeEntriesTable.sourceId, sourceId),
      eq(knowledgeEntriesTable.title, GALAXY_SUMMARY_TITLE),
    ));

  if (existing.length === 0) {
    console.log(`Plan: INSERT new pinned entry "${GALAXY_SUMMARY_TITLE}" (${GALAXY_SUMMARY_CONTENT.length} chars).`);
    if (!APPLY) { console.log("Dry-run — re-run with -- --apply to write."); return; }
    await db.insert(knowledgeEntriesTable).values({
      sourceId,
      userId: sourceUserId,
      title: GALAXY_SUMMARY_TITLE,
      content: GALAXY_SUMMARY_CONTENT,
      keywords: GALAXY_SUMMARY_KEYWORDS,
      pinned: true,
      // embedding left NULL → embed worker back-fills.
    });
    await db.update(knowledgeSourcesTable)
      .set({ entryCount: sql`${knowledgeSourcesTable.entryCount} + 1` })
      .where(eq(knowledgeSourcesTable.id, sourceId));
    console.log("Inserted pinned summary entry.");
    return;
  }

  const row = existing[0]!;
  const contentChanged = row.content !== GALAXY_SUMMARY_CONTENT || row.keywords !== GALAXY_SUMMARY_KEYWORDS;
  if (!contentChanged && row.pinned) {
    console.log(`Entry id=${row.id} already up to date and pinned — nothing to do.`);
    return;
  }
  console.log(`Plan: UPDATE entry id=${row.id} (contentChanged=${contentChanged}, pinned ${row.pinned} → true${contentChanged ? ", embedding → NULL for re-embed" : ""}).`);
  if (!APPLY) { console.log("Dry-run — re-run with -- --apply to write."); return; }
  await db.update(knowledgeEntriesTable)
    .set({
      content: GALAXY_SUMMARY_CONTENT,
      keywords: GALAXY_SUMMARY_KEYWORDS,
      pinned: true,
      ...(contentChanged ? { embedding: null, embeddingModel: null, embeddedAt: null } : {}),
    })
    .where(eq(knowledgeEntriesTable.id, row.id));
  console.log("Updated pinned summary entry.");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
