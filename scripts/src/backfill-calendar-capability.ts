/**
 * backfill-calendar-capability.ts
 *
 * ONE-TIME MIGRATION — already applied (Phase 4 of the workspace-calendar
 * redesign). The scheduling_calendars.agent_id column has been dropped in
 * migration 0051, so this script is now a no-op.
 *
 * Kept in place so `pnpm --filter @workspace/scripts run backfill-calendar-capability`
 * continues to work without error on old invocations.
 */

import { pool } from "@workspace/db";

async function main() {
  console.log(
    "\n=== backfill-calendar-capability ===\n" +
    "This migration has already been applied.\n" +
    "The scheduling_calendars.agent_id column was dropped in migration 0051.\n" +
    "Nothing to do.\n"
  );
}

main()
  .catch(err => {
    console.error("Fatal:", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
