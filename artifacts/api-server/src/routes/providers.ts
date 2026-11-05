import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, providersTable } from "@workspace/db";
import {
  CreateProviderBody,
  UpdateProviderBody,
  UpdateProviderParams,
  DeleteProviderParams,
  ListProvidersResponse,
  UpdateProviderResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth.js";
import { clientContext } from "../middlewares/clientContext.js";
import { logActivity } from "../lib/activity.js";
import { encryptKey, decryptKey } from "../lib/crypto.js";
import { syncByoNumbers } from "../services/byo-numbers.js";
import { checkVobizCredentials } from "../services/vobiz-account.js";

const router: IRouter = Router();

function maskKey(key: string): string {
  const plain = decryptKey(key);
  if (plain.length <= 4) return "****";
  return "..." + plain.slice(-4);
}

function toProviderConfig(p: typeof providersTable.$inferSelect) {
  return {
    id: p.id,
    providerType: p.providerType,
    providerName: p.providerName,
    apiKeyHint: maskKey(p.apiKey),
    isActive: p.isActive,
    extraConfig: p.extraConfig,
    createdAt: p.createdAt.toISOString(),
  };
}

/**
 * For a client's own VoBiz key, ask VoBiz whether the Auth ID / Auth Token
 * work and the number is on that account. Returns a user-facing error, or null
 * when the key is fine, isn't a VoBiz telephony key, or VoBiz gave no clear answer.
 */
async function vobizKeyError(key: {
  providerType: string; providerName: string; apiKey: string; extraConfig: string | null | undefined; isActive?: boolean;
}): Promise<string | null> {
  if (key.providerType !== "telephony" || key.providerName.toLowerCase() !== "vobiz" || key.isActive === false) return null;
  let cfg: Record<string, string> = {};
  try { cfg = key.extraConfig ? JSON.parse(key.extraConfig) as Record<string, string> : {}; } catch { return null; }
  const authId = (cfg["authId"] ?? "").trim();
  const fromNumber = (cfg["fromNumber"] ?? "").trim();
  if (!authId || !fromNumber || !key.apiKey.trim()) return null;
  const check = await checkVobizCredentials(authId, key.apiKey.trim(), fromNumber);
  if (check.status === "rejected") {
    return "VoBiz didn't accept this Auth ID and Auth Token. Copy both again from VoBiz Console → API Credentials.";
  }
  if (check.status === "number_not_on_account") {
    return `${fromNumber} isn't a number on this VoBiz account. Use a number you bought in your VoBiz console.`;
  }
  return null;
}

router.get("/providers", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const providers = await db
    .select()
    .from(providersTable)
    .where(eq(providersTable.userId, clerkId))
    .orderBy(providersTable.createdAt);
  res.json(ListProvidersResponse.parse(providers.map(toProviderConfig)));
});

router.post("/providers", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const parsed = CreateProviderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }
  const vobizError = await vobizKeyError({ ...parsed.data, extraConfig: parsed.data.extraConfig });
  if (vobizError) {
    res.status(400).json({ error: vobizError, code: "VOBIZ_KEY_INVALID" });
    return;
  }
  const [provider] = await db
    .insert(providersTable)
    .values({ ...parsed.data, apiKey: encryptKey(parsed.data.apiKey), userId: clerkId })
    .returning();
  await logActivity({ userId: clerkId, eventType: "provider.added", resourceType: "provider", resourceId: String(provider.id), description: `${provider.providerType.toUpperCase()} provider "${provider.providerName}" added` });
  // BYO telephony: surface the key's fromNumber on the Numbers page + wire inbound.
  await syncByoNumbers(clerkId, { configureAll: true });
  res.status(201).json(toProviderConfig(provider));
});

router.patch("/providers/:id", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params = UpdateProviderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Validation failed", issues: params.error.issues });
    return;
  }
  const parsed = UpdateProviderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }
  const [current] = await db
    .select()
    .from(providersTable)
    .where(and(eq(providersTable.id, params.data.id), eq(providersTable.userId, clerkId)));
  if (!current) {
    res.status(404).json({ error: "Provider not found" });
    return;
  }
  if (parsed.data.apiKey !== undefined || parsed.data.extraConfig !== undefined || parsed.data.isActive === true) {
    const vobizError = await vobizKeyError({
      providerType: current.providerType,
      providerName: current.providerName,
      apiKey: parsed.data.apiKey || decryptKey(current.apiKey),
      extraConfig: parsed.data.extraConfig ?? current.extraConfig,
      isActive: parsed.data.isActive ?? current.isActive,
    });
    if (vobizError) {
      res.status(400).json({ error: vobizError, code: "VOBIZ_KEY_INVALID" });
      return;
    }
  }
  const updateData = { ...parsed.data };
  if (updateData.apiKey) updateData.apiKey = encryptKey(updateData.apiKey);
  const [provider] = await db
    .update(providersTable)
    .set(updateData)
    .where(and(eq(providersTable.id, params.data.id), eq(providersTable.userId, clerkId)))
    .returning();
  if (!provider) {
    res.status(404).json({ error: "Provider not found" });
    return;
  }
  await syncByoNumbers(clerkId, { configureAll: true });
  res.json(UpdateProviderResponse.parse(toProviderConfig(provider)));
});

router.delete("/providers/:id", requireAuth, clientContext, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params = DeleteProviderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Validation failed", issues: params.error.issues });
    return;
  }
  const [deleted] = await db
    .delete(providersTable)
    .where(and(eq(providersTable.id, params.data.id), eq(providersTable.userId, clerkId)))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Provider not found" });
    return;
  }
  await logActivity({ userId: clerkId, eventType: "provider.deleted", resourceType: "provider", resourceId: String(deleted.id), description: `${deleted.providerType.toUpperCase()} provider "${deleted.providerName}" deleted` });
  await syncByoNumbers(clerkId, { configureAll: true });
  res.sendStatus(204);
});

export default router;
