/**
 * wipe-beta-data.ts
 *
 * Deletes all agents, calls, campaigns, and scheduling data from the database,
 * preserving user accounts, providers, wallet transactions, OAuth connections,
 * and all platform system tables.
 *
 * Usage (production):
 *   DATABASE_URL=<prod-url> pnpm --filter @workspace/scripts run wipe-beta-data
 *
 * Usage (dev, already done via admin console):
 *   pnpm --filter @workspace/scripts run wipe-beta-data
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

async function count(table: string): Promise<number> {
  const [row] = await db.execute<{ n: string }>(sql.raw(`SELECT COUNT(*)::text AS n FROM ${table}`)).then(r => r.rows);
  return parseInt(row?.n ?? "0", 10);
}

async function wipe(label: string, query: string) {
  const result = await db.execute(sql.raw(query)).then(r => r.rowCount ?? 0);
  console.log(`  ✓ ${label}: deleted ${result}`);
}

async function main() {
  console.log("\n=== SnapServe — Beta Data Wipe ===\n");
  console.log("DATABASE_URL host:", process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "(local)");

  // Pre-wipe counts
  const tables = [
    "bookings","availability_overrides","availability_schedules",
    "event_types","scheduling_calendars","campaign_leads","campaigns",
    "call_transfers","caller_profiles","scheduled_callbacks","calls","agents",
    "activity_logs","usage_events","admin_alerts","alert_notification_log",
    "usage_spike_notifications","usage_spike_dismissals",
  ];
  console.log("\nPre-wipe counts:");
  for (const t of tables) {
    const n = await count(t);
    if (n > 0) console.log(`  ${t}: ${n}`);
  }

  console.log("\nKeeping: users, providers, wallet_transactions, google_calendar_*,");
  console.log("         meta_integrations, phone_numbers, webhook_endpoints,");
  console.log("         user_api_keys, vobiz_*, platform_settings, provider_pricing,");
  console.log("         prompt_templates, platform_listed_voices\n");

  console.log("Deleting (in FK-safe order)...");

  // FK-safe delete order (children before parents, RESTRICT constraints handled first)
  await wipe("bookings",                   "DELETE FROM bookings");
  await wipe("availability_overrides",     "DELETE FROM availability_overrides");
  await wipe("availability_schedules",     "DELETE FROM availability_schedules");
  await wipe("event_types",               "DELETE FROM event_types");
  await wipe("scheduling_calendars",       "DELETE FROM scheduling_calendars");
  await wipe("campaign_leads",             "DELETE FROM campaign_leads");
  await wipe("campaigns",                 "DELETE FROM campaigns");
  await wipe("call_transfers",             "DELETE FROM call_transfers");
  await wipe("caller_profiles",           "DELETE FROM caller_profiles");
  await wipe("scheduled_callbacks",        "DELETE FROM scheduled_callbacks");
  await wipe("calls",                     "DELETE FROM calls");
  await wipe("agents",                    "DELETE FROM agents");
  await wipe("activity_logs",             "DELETE FROM activity_logs");
  await wipe("usage_events",              "DELETE FROM usage_events");
  await wipe("admin_alerts",              "DELETE FROM admin_alerts");
  await wipe("alert_notification_log",    "DELETE FROM alert_notification_log");
  await wipe("usage_spike_notifications", "DELETE FROM usage_spike_notifications");
  await wipe("usage_spike_dismissals",    "DELETE FROM usage_spike_dismissals");

  // Post-wipe verification
  console.log("\nPost-wipe verification:");
  const kept = ["users","providers","wallet_transactions","google_calendar_connections",
    "meta_integrations","phone_numbers","webhook_endpoints","user_api_keys"];
  for (const t of kept) {
    const n = await count(t);
    console.log(`  ${t}: ${n} rows kept`);
  }

  // Confirm all user-data tables are empty
  const wiped = ["agents","calls","campaigns","bookings","scheduling_calendars","activity_logs"];
  console.log("\nWiped tables (should all be 0):");
  let allGood = true;
  for (const t of wiped) {
    const n = await count(t);
    if (n > 0) { console.log(`  ⚠️  ${t}: ${n} rows remain!`); allGood = false; }
    else console.log(`  ✓ ${t}: 0`);
  }

  console.log(allGood ? "\n✅ Wipe complete.\n" : "\n⚠️  Some rows remain — check FK constraints.\n");
  process.exit(0);
}

main().catch(err => { console.error("Wipe failed:", err); process.exit(1); });
