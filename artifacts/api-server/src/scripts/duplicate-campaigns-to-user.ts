/**
 * Script to duplicate campaigns from krithikad178@gmail.com to olivia@azlonaii.com
 *
 * Usage:
 *   node --env-file=../../.env ./node_modules/tsx/dist/cli.mjs src/scripts/duplicate-campaigns-to-user.ts
 */
import { db, usersTable, campaignsTable, campaignLeadsTable, campaignBatchesTable } from "@workspace/db";
import { eq, or, sql, ilike, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const SOURCE_EMAIL = "krithikad178@gmail.com";
const TARGET_EMAIL = "olivia@azlonaii.com";
const CAMPAIGN_NAMES = ["voiceathon_campaign", "final followup"];

async function main() {
  console.log(`[duplicate-campaigns] Searching for users: ${SOURCE_EMAIL} -> ${TARGET_EMAIL}...`);

  const users = await db
    .select({
      id: usersTable.id,
      clerkId: usersTable.clerkId,
      email: usersTable.email,
      name: usersTable.name,
    })
    .from(usersTable)
    .where(
      or(
        ilike(usersTable.email, SOURCE_EMAIL.trim()),
        ilike(usersTable.email, TARGET_EMAIL.trim())
      )
    );

  console.log(`[duplicate-campaigns] Found ${users.length} user(s):`);
  for (const u of users) {
    console.log(`  - ID: ${u.id}, Email: ${u.email}, ClerkID: ${u.clerkId}, Name: ${u.name}`);
  }

  const sourceUser = users.find(
    (u) => (u.email ?? "").toLowerCase() === SOURCE_EMAIL.toLowerCase()
  );
  const targetUser = users.find(
    (u) => (u.email ?? "").toLowerCase() === TARGET_EMAIL.toLowerCase()
  );

  if (!sourceUser) {
    console.error(`[duplicate-campaigns] Error: Source user '${SOURCE_EMAIL}' not found in database!`);
    process.exit(1);
  }

  if (!targetUser) {
    console.error(`[duplicate-campaigns] Error: Target user '${TARGET_EMAIL}' not found in database!`);
    console.log(`[duplicate-campaigns] Target user needs to log in at least once so their account record is created.`);
    process.exit(1);
  }

  console.log(`\n[duplicate-campaigns] Fetching campaigns for source user (clerkId: ${sourceUser.clerkId})...`);
  const sourceCampaigns = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.userId, sourceUser.clerkId));

  console.log(`[duplicate-campaigns] Total campaigns found for ${SOURCE_EMAIL}: ${sourceCampaigns.length}`);
  for (const c of sourceCampaigns) {
    console.log(`  - [${c.id}] "${c.name}" (status: ${c.status}, leads: ${c.totalLeads})`);
  }

  const targetCampaigns = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.userId, targetUser.clerkId));

  const targetExistingNames = new Set(targetCampaigns.map((c) => c.name.toLowerCase().trim()));

  // Filter campaigns matching requested names (case-insensitive)
  const campaignsToClone = sourceCampaigns.filter((c) =>
    CAMPAIGN_NAMES.some((targetName) =>
      c.name.toLowerCase().trim().includes(targetName.toLowerCase().trim())
    )
  );

  if (campaignsToClone.length === 0) {
    console.warn(`[duplicate-campaigns] Warning: None of the requested campaign names (${CAMPAIGN_NAMES.join(", ")}) were found among source user's campaigns.`);
    console.log(`Available campaign names are: ${sourceCampaigns.map((c) => `"${c.name}"`).join(", ")}`);
    process.exit(1);
  }

  console.log(`\n[duplicate-campaigns] Found ${campaignsToClone.length} campaign(s) to clone to ${TARGET_EMAIL}:`);

  for (const original of campaignsToClone) {
    console.log(`\n--- Processing: "${original.name}" (ID: ${original.id}) ---`);

    if (targetExistingNames.has(original.name.toLowerCase().trim())) {
      console.log(`  -> Campaign "${original.name}" already exists for ${TARGET_EMAIL}. Skipping duplicate creation.`);
      continue;
    }

    const newWebhookToken = randomUUID();

    const [inserted] = await db
      .insert(campaignsTable)
      .values({
        userId: targetUser.clerkId,
        name: original.name,
        description: original.description,
        agentId: original.agentId,
        squadId: original.squadId,
        status: original.status === "active" ? "draft" : original.status,
        webhookToken: newWebhookToken,
        fieldMappings: original.fieldMappings,
        fromNumber: original.fromNumber,
        callDelaySeconds: original.callDelaySeconds,
        maxAttempts: original.maxAttempts,
        retryDelayMinutes: original.retryDelayMinutes,
        totalLeads: 0,
        calledLeads: 0,
        concurrentCallLimit: original.concurrentCallLimit,
        isActive: false,
        leadSource: original.leadSource,
        triggerMode: original.triggerMode,
        timezone: original.timezone,
        businessHoursStart: original.businessHoursStart,
        businessHoursEnd: original.businessHoursEnd,
        isCallingHoursEnabled: original.isCallingHoursEnabled,
        sourceFormId: original.sourceFormId,
        sourcePageId: original.sourcePageId,
        leadTransfer: original.leadTransfer,
        afterCallBranches: original.afterCallBranches,
        analyticsQuestions: original.analyticsQuestions,
      })
      .returning();

    console.log(`  ✓ Successfully cloned campaign:`);
    console.log(`    New Campaign ID: ${inserted.id}`);
    console.log(`    Name: "${inserted.name}"`);
    console.log(`    User: ${targetUser.email} (${inserted.userId})`);
    console.log(`    Webhook Token: ${inserted.webhookToken}`);
  }

  console.log(`\n[duplicate-campaigns] Finished campaign duplication process.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[duplicate-campaigns] Fatal error:", err);
  process.exit(1);
});
