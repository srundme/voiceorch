import { db, usersTable, campaignsTable } from "@workspace/db";
import { eq, or, ilike } from "drizzle-orm";
import { randomUUID, randomBytes } from "node:crypto";
import { logger } from "../lib/logger.js";

const SOURCE_EMAIL = "krithikad178@gmail.com";
const TARGET_EMAIL = "olivia@azlonaii.com";
const TARGET_CAMPAIGN_PATTERNS = ["voiceathon_campaign", "final followup"];

export interface DuplicateCampaignsSummary {
  scanned: number;
  duplicated: number;
  details: Array<{ originalId: number; newId: number; name: string; targetUserId: string }>;
}

/**
 * Ensures 'voiceathon_campaign' and 'final followup' campaigns from krithikad178@gmail.com
 * are duplicated and made available in olivia@azlonaii.com's workspace.
 * Idempotent — will not create duplicate copies if a campaign with that name already exists for the target user.
 */
export async function duplicateSpecificCampaigns(): Promise<DuplicateCampaignsSummary> {
  const details: DuplicateCampaignsSummary["details"] = [];

  try {
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

    const sourceUser = users.find(
      (u) => (u.email ?? "").toLowerCase().trim() === SOURCE_EMAIL.toLowerCase().trim()
    );
    let targetUser = users.find(
      (u) => (u.email ?? "").toLowerCase().trim() === TARGET_EMAIL.toLowerCase().trim()
    );

    if (!sourceUser) {
      logger.info(
        { sourceEmail: SOURCE_EMAIL },
        "[duplicateSpecificCampaigns] Source user not found in DB yet; skipping duplication"
      );
      return { scanned: 0, duplicated: 0, details };
    }

    // If target user doesn't exist yet, ensure a placeholder user profile with unique clerkId
    if (!targetUser) {
      const generatedClerkId = `user_${randomBytes(12).toString("hex")}`;
      const [created] = await db
        .insert(usersTable)
        .values({
          email: TARGET_EMAIL.toLowerCase().trim(),
          clerkId: generatedClerkId,
          name: "Olivia",
        })
        .onConflictDoNothing()
        .returning({
          id: usersTable.id,
          clerkId: usersTable.clerkId,
          email: usersTable.email,
          name: usersTable.name,
        });

      if (created) {
        targetUser = created;
        logger.info(
          { targetEmail: TARGET_EMAIL, clerkId: targetUser.clerkId },
          "[duplicateSpecificCampaigns] Created initial user record for target email"
        );
      } else {
        // Fetch again in case of race
        const [fetched] = await db
          .select({
            id: usersTable.id,
            clerkId: usersTable.clerkId,
            email: usersTable.email,
            name: usersTable.name,
          })
          .from(usersTable)
          .where(ilike(usersTable.email, TARGET_EMAIL.trim()));
        targetUser = fetched;
      }
    }

    if (!targetUser?.clerkId) {
      logger.warn(
        { targetEmail: TARGET_EMAIL },
        "[duplicateSpecificCampaigns] Could not resolve target user clerkId"
      );
      return { scanned: 0, duplicated: 0, details };
    }

    // Fetch campaigns for both users
    const sourceCampaigns = await db
      .select()
      .from(campaignsTable)
      .where(eq(campaignsTable.userId, sourceUser.clerkId));

    const targetCampaigns = await db
      .select({ id: campaignsTable.id, name: campaignsTable.name })
      .from(campaignsTable)
      .where(eq(campaignsTable.userId, targetUser.clerkId));

    const targetExistingNames = new Set(
      targetCampaigns.map((c) => c.name.toLowerCase().trim())
    );

    // Filter campaigns matching the requested names
    const campaignsToClone = sourceCampaigns.filter((c) =>
      TARGET_CAMPAIGN_PATTERNS.some((pattern) =>
        c.name.toLowerCase().trim().includes(pattern.toLowerCase().trim())
      )
    );

    logger.info(
      {
        sourceEmail: SOURCE_EMAIL,
        targetEmail: TARGET_EMAIL,
        foundCampaigns: campaignsToClone.map((c) => ({ id: c.id, name: c.name })),
      },
      "[duplicateSpecificCampaigns] Found campaigns to clone"
    );

    for (const original of campaignsToClone) {
      if (targetExistingNames.has(original.name.toLowerCase().trim())) {
        logger.info(
          { campaignName: original.name, targetEmail: TARGET_EMAIL },
          "[duplicateSpecificCampaigns] Target user already has this campaign; skipping"
        );
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

      if (inserted) {
        details.push({
          originalId: original.id,
          newId: inserted.id,
          name: inserted.name,
          targetUserId: targetUser.clerkId,
        });
        targetExistingNames.add(inserted.name.toLowerCase().trim());
      }
    }

    if (details.length > 0) {
      logger.info(
        { count: details.length, details },
        "[duplicateSpecificCampaigns] Successfully duplicated campaigns for target user"
      );
    }
  } catch (err) {
    logger.error({ err }, "[duplicateSpecificCampaigns] Error during campaign duplication");
  }

  return { scanned: TARGET_CAMPAIGN_PATTERNS.length, duplicated: details.length, details };
}
