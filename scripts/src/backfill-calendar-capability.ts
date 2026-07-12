/**
 * backfill-calendar-capability.ts
 *
 * Migrates the old 1:1 agent→calendar link (scheduling_calendars.agent_id) into
 * the new agentConfig.calendarCapability shape so that the Phase 3 dashboard
 * calendar picker hydrates correctly for all existing agents.
 *
 * What it does:
 *   1. Finds every row in scheduling_calendars where agent_id IS NOT NULL.
 *   2. For each, loads the linked agent.
 *   3. Skips agents that already have agentConfig.calendarCapability set
 *      (idempotent — safe to re-run without overwriting manual config).
 *   4. Writes agentConfig.calendarCapability = {
 *        enabled: true,
 *        accessibleCalendarIds: [cal.id],
 *        defaultCalendarId: cal.id,
 *      } into the agent row.
 *
 * Dry-run by default (read-only, prints the plan).
 * Add -- --apply to perform the writes.
 *
 * Usage:
 *   # dry-run (safe, no writes)
 *   DATABASE_URL=<url> pnpm --filter @workspace/scripts run backfill-calendar-capability
 *
 *   # apply
 *   DATABASE_URL=<url> pnpm --filter @workspace/scripts run backfill-calendar-capability -- --apply
 *
 * Idempotent: re-running after --apply finds all agents already patched and
 * reports 0 pending rows.
 *
 * Apply requires a confirmed DB backup first.
 */

import { db, pool, agentsTable, schedulingCalendarsTable } from "@workspace/db";
import { isNotNull, eq } from "drizzle-orm";

const apply = process.argv.includes("--apply");

async function main() {
  console.log(`\n=== backfill-calendar-capability  (${apply ? "APPLY" : "DRY-RUN"}) ===\n`);

  // 1. Load all calendars that still have an agent_id
  const calendars = await db
    .select({
      id: schedulingCalendarsTable.id,
      name: schedulingCalendarsTable.name,
      agentId: schedulingCalendarsTable.agentId,
    })
    .from(schedulingCalendarsTable)
    .where(isNotNull(schedulingCalendarsTable.agentId));

  if (calendars.length === 0) {
    console.log("No calendars with agent_id found — nothing to backfill.\n");
    return;
  }

  console.log(`Found ${calendars.length} agent-linked calendar(s):\n`);

  let pending = 0;
  let alreadySet = 0;
  let missing = 0;

  for (const cal of calendars) {
    const agentId = cal.agentId!;

    const [agent] = await db
      .select({ id: agentsTable.id, name: agentsTable.name, agentConfig: agentsTable.agentConfig })
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId));

    if (!agent) {
      console.log(`  SKIP   cal #${cal.id} "${cal.name}" → agent #${agentId} not found (orphan)`);
      missing++;
      continue;
    }

    const existing = (agent.agentConfig as any)?.calendarCapability;
    if (existing != null) {
      console.log(
        `  SKIP   cal #${cal.id} "${cal.name}" → agent #${agentId} "${agent.name}" — calendarCapability already set (defaultCalendarId=${existing.defaultCalendarId})`
      );
      alreadySet++;
      continue;
    }

    const newCap = {
      enabled: true,
      accessibleCalendarIds: [cal.id],
      defaultCalendarId: cal.id,
    };

    console.log(
      `  ${apply ? "WRITE" : "PLAN "}  cal #${cal.id} "${cal.name}" → agent #${agentId} "${agent.name}"` +
        `  defaultCalendarId=${cal.id}`
    );

    if (apply) {
      const currentConfig = (agent.agentConfig as Record<string, unknown>) ?? {};
      await db
        .update(agentsTable)
        .set({ agentConfig: { ...currentConfig, calendarCapability: newCap } as any })
        .where(eq(agentsTable.id, agentId));
    }

    pending++;
  }

  console.log(`\n── Summary ──────────────────────────────────`);
  console.log(`  ${apply ? "Written" : "Pending"}: ${pending}`);
  console.log(`  Already set (skipped): ${alreadySet}`);
  console.log(`  Orphan calendars (no agent row): ${missing}`);

  if (!apply && pending > 0) {
    console.log(
      `\nRun with -- --apply to write ${pending} agent config update(s).\n` +
        `Confirm a DB backup first.\n`
    );
  } else if (apply && pending > 0) {
    console.log(`\n${pending} agent(s) updated. Re-run to confirm idempotency.\n`);
  } else if (pending === 0) {
    console.log(`\nNothing to do — all agents already have calendarCapability set.\n`);
  }
}

main()
  .catch(err => {
    console.error("Fatal:", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
