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
import { logActivity } from "../lib/activity.js";

const router: IRouter = Router();

function maskKey(key: string): string {
  if (key.length <= 4) return "****";
  return "..." + key.slice(-4);
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

router.get("/providers", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const providers = await db
    .select()
    .from(providersTable)
    .where(eq(providersTable.userId, clerkId))
    .orderBy(providersTable.createdAt);
  res.json(ListProvidersResponse.parse(providers.map(toProviderConfig)));
});

router.post("/providers", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const parsed = CreateProviderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [provider] = await db
    .insert(providersTable)
    .values({ ...parsed.data, userId: clerkId })
    .returning();
  await logActivity({ userId: clerkId, eventType: "provider.added", resourceType: "provider", resourceId: String(provider.id), description: `${provider.providerType.toUpperCase()} provider "${provider.providerName}" added` });
  res.status(201).json(toProviderConfig(provider));
});

router.patch("/providers/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params = UpdateProviderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateProviderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [provider] = await db
    .update(providersTable)
    .set(parsed.data)
    .where(and(eq(providersTable.id, params.data.id), eq(providersTable.userId, clerkId)))
    .returning();
  if (!provider) {
    res.status(404).json({ error: "Provider not found" });
    return;
  }
  res.json(UpdateProviderResponse.parse(toProviderConfig(provider)));
});

router.delete("/providers/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const params = DeleteProviderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
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
  res.sendStatus(204);
});

export default router;
