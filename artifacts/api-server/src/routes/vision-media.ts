import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, agentsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logger } from "../lib/logger.js";
import {
  storeCallMedia,
  getCallMediaById,
  listRecentCallMedia,
  isAllowedImageMime,
} from "../services/call-media.js";

const router = Router();

// ── Helper: verify agent belongs to user ─────────────────────────────────────
async function getAgentForUser(agentId: number, clerkId: string) {
  const [agent] = await db
    .select({ id: agentsTable.id, userId: agentsTable.userId, agentConfig: agentsTable.agentConfig })
    .from(agentsTable)
    .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, clerkId)))
    .limit(1);
  return agent ?? null;
}

// ── List recent call media for an agent ──────────────────────────────────────
router.get("/vision-agents/:id/media", requireAuth, async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.params.id), 10);
  const clerkId = (req as any).clerkUserId as string;
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "50"), 10) || 50, 200);

  if (!Number.isFinite(agentId)) {
    res.status(400).json({ error: "Invalid agent id" });
    return;
  }

  const agent = await getAgentForUser(agentId, clerkId);
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  try {
    const rows = await listRecentCallMedia(agentId, null, limit);
    // Strip binary imageData from list response for bandwidth
    const safe = rows.map(({ imageData: _img, ...r }) => r);
    res.json(safe);
  } catch (err) {
    logger.error({ err, agentId }, "Failed to list vision media");
    res.status(500).json({ error: "Failed to list media" });
  }
});

// ── Pre-stage an image before a call ─────────────────────────────────────────
router.post("/vision-agents/:id/media/stage", requireAuth, async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.params.id), 10);
  const clerkId = (req as any).clerkUserId as string;

  if (!Number.isFinite(agentId)) {
    res.status(400).json({ error: "Invalid agent id" });
    return;
  }

  const agent = await getAgentForUser(agentId, clerkId);
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const mimeType = typeof body["mimeType"] === "string" ? body["mimeType"].trim() : "";
  const dataB64 = typeof body["data"] === "string" ? body["data"] : null;
  const fileName = typeof body["fileName"] === "string" ? body["fileName"].trim() : null;
  const phone = typeof body["phone"] === "string" ? body["phone"].trim() : null;

  if (!mimeType) {
    res.status(400).json({ error: "mimeType is required" });
    return;
  }

  if (!isAllowedImageMime(mimeType)) {
    res.status(400).json({ error: `mimeType '${mimeType}' is not allowed. Accepted: jpeg, png, gif, webp, pdf` });
    return;
  }

  if (!dataB64) {
    res.status(400).json({ error: "data (base64) is required" });
    return;
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(dataB64, "base64");
  } catch {
    res.status(400).json({ error: "Invalid base64 data" });
    return;
  }

  const agentCfg = (agent.agentConfig ?? {}) as Record<string, unknown>;
  const visionConfig = (agentCfg["visionConfig"] as Record<string, unknown> | undefined) ?? {};
  const retentionDays = typeof visionConfig["retentionDays"] === "number" ? visionConfig["retentionDays"] : 30;

  try {
    const media = await storeCallMedia({
      agentId,
      userId: clerkId,
      phone,
      source: "api_staged",
      mimeType,
      fileName,
      buffer,
      retentionDays,
    });

    const baseUrl = process.env["API_BASE_URL"] ?? `${req.protocol}://${req.get("host")}`;
    res.status(201).json({
      mediaId: media.id,
      url: `${baseUrl}/vision-media/${media.id}`,
    });
  } catch (err) {
    logger.error({ err, agentId }, "Failed to stage vision media");
    res.status(500).json({ error: "Failed to stage media" });
  }
});

// ── Get media bytes (image stream) ────────────────────────────────────────────
router.get("/vision-media/:mediaId", requireAuth, async (req, res): Promise<void> => {
  const mediaId = parseInt(String(req.params.mediaId), 10);
  const clerkId = (req as any).clerkUserId as string;

  if (!Number.isFinite(mediaId)) {
    res.status(400).json({ error: "Invalid media id" });
    return;
  }

  const media = await getCallMediaById(mediaId);
  if (!media) {
    res.status(404).json({ error: "Media not found" });
    return;
  }

  // Verify ownership via agentId
  if (media.agentId) {
    const [agent] = await db
      .select({ userId: agentsTable.userId })
      .from(agentsTable)
      .where(eq(agentsTable.id, media.agentId))
      .limit(1);
    if (!agent || agent.userId !== clerkId) {
      res.status(404).json({ error: "Media not found" });
      return;
    }
  } else if (media.userId !== clerkId) {
    res.status(404).json({ error: "Media not found" });
    return;
  }

  try {
    if (media.imageData) {
      const buf = Buffer.from(media.imageData);
      res.set("Content-Type", media.mimeType);
      res.set("Content-Length", String(buf.length));
      res.set("Cache-Control", "private, max-age=3600");
      res.send(buf);
      return;
    }

    if (media.urlRef) {
      // Redirect to the original URL
      res.redirect(302, media.urlRef);
      return;
    }

    res.status(404).json({ error: "No image data available" });
  } catch (err) {
    logger.error({ err, mediaId }, "Failed to serve media");
    res.status(500).json({ error: "Failed to serve media" });
  }
});

// ── Delete media ──────────────────────────────────────────────────────────────
router.delete("/vision-media/:mediaId", requireAuth, async (req, res): Promise<void> => {
  const mediaId = parseInt(String(req.params.mediaId), 10);
  const clerkId = (req as any).clerkUserId as string;

  if (!Number.isFinite(mediaId)) {
    res.status(400).json({ error: "Invalid media id" });
    return;
  }

  const media = await getCallMediaById(mediaId);
  if (!media) {
    res.status(404).json({ error: "Media not found" });
    return;
  }

  // Verify ownership
  if (media.agentId) {
    const [agent] = await db
      .select({ userId: agentsTable.userId })
      .from(agentsTable)
      .where(eq(agentsTable.id, media.agentId))
      .limit(1);
    if (!agent || agent.userId !== clerkId) {
      res.status(404).json({ error: "Media not found" });
      return;
    }
  } else if (media.userId !== clerkId) {
    res.status(404).json({ error: "Media not found" });
    return;
  }

  try {
    const { db: dbClient, callMediaTable } = await import("@workspace/db");
    await dbClient.delete(callMediaTable).where(
      (await import("drizzle-orm")).eq(callMediaTable.id, mediaId),
    );
    res.status(204).end();
  } catch (err) {
    logger.error({ err, mediaId }, "Failed to delete vision media");
    res.status(500).json({ error: "Failed to delete media" });
  }
});

export default router;
