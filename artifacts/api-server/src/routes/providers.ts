import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, providersTable } from "@workspace/db";
import {
  CreateProviderBody,
  UpdateProviderBody,
  UpdateProviderParams,
  DeleteProviderParams,
  ListProvidersResponse,
  UpdateProviderResponse,
} from "@workspace/api-zod";

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

router.get("/providers", async (req, res): Promise<void> => {
  const providers = await db.select().from(providersTable).orderBy(providersTable.createdAt);
  res.json(ListProvidersResponse.parse(providers.map(toProviderConfig)));
});

router.post("/providers", async (req, res): Promise<void> => {
  const parsed = CreateProviderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [provider] = await db.insert(providersTable).values(parsed.data).returning();
  res.status(201).json(toProviderConfig(provider));
});

router.patch("/providers/:id", async (req, res): Promise<void> => {
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
    .where(eq(providersTable.id, params.data.id))
    .returning();
  if (!provider) {
    res.status(404).json({ error: "Provider not found" });
    return;
  }
  res.json(UpdateProviderResponse.parse(toProviderConfig(provider)));
});

router.delete("/providers/:id", async (req, res): Promise<void> => {
  const params = DeleteProviderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db.delete(providersTable).where(eq(providersTable.id, params.data.id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Provider not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
