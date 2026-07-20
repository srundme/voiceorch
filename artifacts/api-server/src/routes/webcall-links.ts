import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, webcallLinksTable, agentsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import {
  getWebcallLinkByToken,
  isWebcallLinkUsable,
  mintWebcallLinkToken,
} from "../services/webcall-links.js";
import { logger } from "../lib/logger.js";

const router = Router();

function parseOptionalInt(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function parseOptionalDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? d : null;
}

/* ── Public: join page metadata ──────────────────────────────────────────── */

router.get("/webcall-links/join/:token", async (req, res): Promise<void> => {
  const token = String(req.params.token ?? "");
  const link = await getWebcallLinkByToken(token);
  if (!link) {
    res.status(404).json({ error: "Link not found" });
    return;
  }
  const usable = isWebcallLinkUsable(link);
  if (!usable.ok) {
    res.status(403).json({ error: usable.reason, active: false });
    return;
  }

  const [agent] = await db
    .select({
      id: agentsTable.id,
      name: agentsTable.name,
      agentConfig: agentsTable.agentConfig,
    })
    .from(agentsTable)
    .where(eq(agentsTable.id, link.agentId))
    .limit(1);

  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const cfg = (agent.agentConfig ?? {}) as Record<string, unknown>;
  res.json({
    token: link.token,
    agentId: agent.id,
    agentName: agent.name,
    label: link.label,
    purpose: link.purpose,
    requireCamera: link.requireCamera,
    visionEnabled: cfg["visionEnabled"] === true,
    visionLiveEnabled: cfg["visionLiveEnabled"] === true,
  });
});

/* ── Authenticated CRUD ──────────────────────────────────────────────────── */

router.get("/agents/:agentId/webcall-links", requireAuth, async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.params.agentId), 10);
  const clerkId = (req as any).clerkUserId as string;
  if (!Number.isFinite(agentId)) {
    res.status(400).json({ error: "Invalid agent id" });
    return;
  }
  const [agent] = await db.select({ userId: agentsTable.userId }).from(agentsTable).where(eq(agentsTable.id, agentId)).limit(1);
  if (!agent || agent.userId !== clerkId) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  const rows = await db
    .select()
    .from(webcallLinksTable)
    .where(and(eq(webcallLinksTable.agentId, agentId), eq(webcallLinksTable.userId, clerkId)))
    .orderBy(desc(webcallLinksTable.createdAt));
  res.json(rows);
});

router.post("/agents/:agentId/webcall-links", requireAuth, async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.params.agentId), 10);
  const clerkId = (req as any).clerkUserId as string;
  if (!Number.isFinite(agentId)) {
    res.status(400).json({ error: "Invalid agent id" });
    return;
  }
  const [agent] = await db.select({ userId: agentsTable.userId }).from(agentsTable).where(eq(agentsTable.id, agentId)).limit(1);
  if (!agent || agent.userId !== clerkId) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const label = typeof body["label"] === "string" ? body["label"].trim().slice(0, 120) || null : null;
  const purpose = typeof body["purpose"] === "string" ? body["purpose"].trim().slice(0, 200) || null : null;
  const requireCamera = body["requireCamera"] === true;
  const maxUses = parseOptionalInt(body["maxUses"]);
  const expiresAt = parseOptionalDate(body["expiresAt"]);

  try {
    const [row] = await db
      .insert(webcallLinksTable)
      .values({
        agentId,
        userId: clerkId,
        token: mintWebcallLinkToken(),
        label,
        purpose,
        requireCamera,
        maxUses,
        expiresAt,
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    logger.error({ err, agentId }, "Failed to create webcall link");
    res.status(500).json({ error: "Failed to create link" });
  }
});

router.patch("/webcall-links/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const clerkId = (req as any).clerkUserId as string;
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [existing] = await db.select().from(webcallLinksTable).where(eq(webcallLinksTable.id, id)).limit(1);
  if (!existing || existing.userId !== clerkId) {
    res.status(404).json({ error: "Link not found" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: Partial<typeof webcallLinksTable.$inferInsert> = {};
  if (typeof body["active"] === "boolean") patch.active = body["active"];
  if (typeof body["label"] === "string") patch.label = body["label"].trim().slice(0, 120) || null;
  if (typeof body["purpose"] === "string") patch.purpose = body["purpose"].trim().slice(0, 200) || null;
  if (typeof body["requireCamera"] === "boolean") patch.requireCamera = body["requireCamera"];
  if ("maxUses" in body) patch.maxUses = parseOptionalInt(body["maxUses"]);
  if ("expiresAt" in body) patch.expiresAt = parseOptionalDate(body["expiresAt"]);

  const [row] = await db
    .update(webcallLinksTable)
    .set(patch)
    .where(eq(webcallLinksTable.id, id))
    .returning();
  res.json(row);
});

router.delete("/webcall-links/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const clerkId = (req as any).clerkUserId as string;
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [existing] = await db.select().from(webcallLinksTable).where(eq(webcallLinksTable.id, id)).limit(1);
  if (!existing || existing.userId !== clerkId) {
    res.status(404).json({ error: "Link not found" });
    return;
  }
  await db.delete(webcallLinksTable).where(eq(webcallLinksTable.id, id));
  res.status(204).end();
});

export default router;
