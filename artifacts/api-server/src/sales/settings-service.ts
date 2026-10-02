import { and, asc, eq, gte, lte } from "drizzle-orm";
import { salesSettingsTable, salesTargetsTable } from "@workspace/db/schema";
import { notFound, SalesError, writeAudit, type SalesActor, type SalesDb } from "./db.js";
import { DEFAULT_SALES_CONFIG, salesConfigSchema, type SalesConfig } from "./settings-schema.js";
import { addDays, isoWeekday } from "./time.js";

const SETTINGS_ID = 1;

export interface SettingsView {
  config: SalesConfig;
  updatedBy: number | null;
  updatedAt: Date | null;
}

export async function getSettings(db: SalesDb): Promise<SettingsView> {
  const [row] = await db.select().from(salesSettingsTable).where(eq(salesSettingsTable.id, SETTINGS_ID));
  if (!row) return { config: DEFAULT_SALES_CONFIG, updatedBy: null, updatedAt: null };
  const stored = (row.config && typeof row.config === "object" ? row.config : {}) as Record<string, unknown>;
  const parsed = salesConfigSchema.safeParse({ ...DEFAULT_SALES_CONFIG, ...stored });
  return { config: parsed.success ? parsed.data : DEFAULT_SALES_CONFIG, updatedBy: row.updatedBy, updatedAt: row.updatedAt };
}

export async function putSettings(db: SalesDb, actor: SalesActor, config: SalesConfig, reason?: string | null): Promise<SettingsView> {
  return db.transaction(async (tx) => {
    const before = await getSettings(tx);
    const now = new Date();
    await tx
      .insert(salesSettingsTable)
      .values({ id: SETTINGS_ID, config, updatedBy: actor.id, updatedAt: now })
      .onConflictDoUpdate({ target: salesSettingsTable.id, set: { config, updatedBy: actor.id, updatedAt: now } });
    await writeAudit(tx, { actorUserId: actor.id, entity: "sales_settings", entityId: SETTINGS_ID, action: "updated", before: before.config, after: config, reason });
    return { config, updatedBy: actor.id, updatedAt: now };
  });
}

export async function listTargets(db: SalesDb, filter: { from?: string; to?: string; kind?: string }) {
  const conds = [];
  if (filter.from) conds.push(gte(salesTargetsTable.date, filter.from));
  if (filter.to) conds.push(lte(salesTargetsTable.date, filter.to));
  if (filter.kind) conds.push(eq(salesTargetsTable.kind, filter.kind));
  return db
    .select()
    .from(salesTargetsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(salesTargetsTable.date), asc(salesTargetsTable.kind));
}

export type TargetPatch = Partial<Pick<
  typeof salesTargetsTable.$inferInsert,
  "dayType" | "visits" | "conversations" | "demos" | "pilots" | "operatingPaid" | "stretchPaid" | "note"
>>;

const MAX_GENERATED_DAYS = 120;

/**
 * Fills missing target rows for the sprint (or a given range) from the configured daily targets.
 * Existing rows are never overwritten. Sundays become review days when `sundayIsReview` is on, and the
 * last day gets a cumulative paid milestone from the sprint goals if it has none.
 */
export async function generateTargets(db: SalesDb, actor: SalesActor, config: SalesConfig, range: { from?: string; to?: string } = {}) {
  const from = range.from ?? config.sprint.start;
  const to = range.to ?? config.sprint.end;
  if (from > to) throw new SalesError(400, "from must be on or before to");
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    days.push(d);
    if (days.length > MAX_GENERATED_DAYS) throw new SalesError(400, `Generate at most ${MAX_GENERATED_DAYS} days at a time`);
  }
  const t = config.dailyTargets;
  const daily = days.map((date) => {
    const review = config.sundayIsReview && isoWeekday(date) === 7;
    return {
      date,
      kind: "daily",
      dayType: review ? "review" : "selling",
      visits: review ? 0 : t.visits,
      conversations: review ? 0 : t.conversationsMin,
      demos: review ? 0 : t.demosMin,
      pilots: review ? 0 : t.pilots,
    };
  });
  return db.transaction(async (tx) => {
    const created = await tx.insert(salesTargetsTable).values(daily).onConflictDoNothing().returning({ id: salesTargetsTable.id });
    const milestone = await tx
      .insert(salesTargetsTable)
      .values({
        date: to,
        kind: "cumulative_paid",
        dayType: config.sundayIsReview && isoWeekday(to) === 7 ? "review" : "selling",
        operatingPaid: config.goals.operatingNewPaid,
        stretchPaid: config.goals.stretchNewPaid,
      })
      .onConflictDoNothing()
      .returning({ id: salesTargetsTable.id });
    const total = created.length + milestone.length;
    if (total) {
      await writeAudit(tx, { actorUserId: actor.id, entity: "sales_target", entityId: null, action: "generated", after: { from, to, daily: created.length, milestones: milestone.length } });
    }
    return { from, to, created: { daily: created.length, milestones: milestone.length }, skippedExisting: days.length - created.length };
  });
}

export async function updateTarget(db: SalesDb, actor: SalesActor, id: number, patch: TargetPatch, reason?: string | null) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(salesTargetsTable).where(eq(salesTargetsTable.id, id));
    if (!before) throw notFound("Target");
    const [after] = await tx.update(salesTargetsTable).set(patch).where(eq(salesTargetsTable.id, id)).returning();
    await writeAudit(tx, { actorUserId: actor.id, entity: "sales_target", entityId: id, action: "updated", before, after, reason });
    return after!;
  });
}
