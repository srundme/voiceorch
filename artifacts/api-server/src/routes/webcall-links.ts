import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, webcallLinksTable, agentsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import {
  getWebcallLinkByToken,
  isWebcallLinkUsable,
  isWebsiteEmbedLink,
  mintWebcallLinkToken,
  WEBSITE_EMBED_LABEL,
  WEBSITE_EMBED_PURPOSE,
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

  res.json({
    token: link.token,
    agentId: agent.id,
    agentName: agent.name,
    label: link.label,
    purpose: link.purpose,
    requireCamera: link.requireCamera,
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

function publicOrigin(req: { protocol: string; headers: Record<string, unknown>; hostname: string }): string {
  const forwarded = req.headers["x-forwarded-host"];
  const host = (typeof forwarded === "string" && forwarded.split(",")[0]?.trim()) || req.hostname;
  const protoHeader = req.headers["x-forwarded-proto"];
  const proto =
    typeof protoHeader === "string" && protoHeader.split(",")[0]
      ? String(protoHeader).split(",")[0]!.trim()
      : req.protocol;
  return `${proto}://${host}`;
}

function embedPayload(link: typeof webcallLinksTable.$inferSelect, agentId: number, agentName: string, origin: string) {
  return {
    id: link.id,
    token: link.token,
    agentId,
    agentName,
    active: link.active,
    useCount: link.useCount,
    joinUrl: `${origin}/join/${link.token}`,
    widgetScriptSrc: `${origin}/api/widget.js`,
    iframeSrc: `${origin}/api/widget/call?share=${encodeURIComponent(link.token)}`,
  };
}

async function loadOwnedAgent(agentId: number, clerkId: string) {
  const [agent] = await db
    .select({ id: agentsTable.id, userId: agentsTable.userId, name: agentsTable.name })
    .from(agentsTable)
    .where(eq(agentsTable.id, agentId))
    .limit(1);
  if (!agent || agent.userId !== clerkId) return null;
  return agent;
}

async function listAgentWebcallLinks(agentId: number, clerkId: string) {
  return db
    .select()
    .from(webcallLinksTable)
    .where(and(eq(webcallLinksTable.agentId, agentId), eq(webcallLinksTable.userId, clerkId)))
    .orderBy(desc(webcallLinksTable.createdAt));
}

async function mintWebsiteEmbedLink(agentId: number, clerkId: string) {
  const [row] = await db
    .insert(webcallLinksTable)
    .values({
      agentId,
      userId: clerkId,
      token: mintWebcallLinkToken(),
      label: WEBSITE_EMBED_LABEL,
      purpose: WEBSITE_EMBED_PURPOSE,
      requireCamera: false,
    })
    .returning();
  return row!;
}

/** GET — website-embed link for this agent. Creates one if the agent has none yet. */
router.get("/agents/:agentId/webcall-links/embed", requireAuth, async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.params.agentId), 10);
  const clerkId = (req as any).clerkUserId as string;
  if (!Number.isFinite(agentId)) {
    res.status(400).json({ error: "Invalid agent id" });
    return;
  }
  const agent = await loadOwnedAgent(agentId, clerkId);
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  const rows = await listAgentWebcallLinks(agentId, clerkId);
  let link = rows.find((r) => isWebsiteEmbedLink(r) && r.active) ?? rows.find((r) => isWebsiteEmbedLink(r));
  if (!link) {
    try {
      link = await mintWebsiteEmbedLink(agentId, clerkId);
    } catch (err) {
      logger.error({ err, agentId }, "Failed to mint website embed link");
      res.status(500).json({ error: "Failed to create embed" });
      return;
    }
  } else if (!link.active) {
    const [reactivated] = await db
      .update(webcallLinksTable)
      .set({ active: true })
      .where(eq(webcallLinksTable.id, link.id))
      .returning();
    link = reactivated ?? link;
  }
  res.json(embedPayload(link, agent.id, agent.name ?? "Voice assistant", publicOrigin(req)));
});

/**
 * POST — create (or rotate) the per-agent website embed token.
 * Body: { regenerate?: boolean }
 */
router.post("/agents/:agentId/webcall-links/embed", requireAuth, async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.params.agentId), 10);
  const clerkId = (req as any).clerkUserId as string;
  if (!Number.isFinite(agentId)) {
    res.status(400).json({ error: "Invalid agent id" });
    return;
  }
  const agent = await loadOwnedAgent(agentId, clerkId);
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const regenerate = (req.body as { regenerate?: unknown } | undefined)?.regenerate === true;
  const rows = await listAgentWebcallLinks(agentId, clerkId);
  const existing = rows.find((r) => isWebsiteEmbedLink(r));

  try {
    if (existing && !regenerate) {
      if (!existing.active) {
        const [row] = await db
          .update(webcallLinksTable)
          .set({ active: true })
          .where(eq(webcallLinksTable.id, existing.id))
          .returning();
        res.json(embedPayload(row!, agent.id, agent.name ?? "Voice assistant", publicOrigin(req)));
        return;
      }
      res.json(embedPayload(existing, agent.id, agent.name ?? "Voice assistant", publicOrigin(req)));
      return;
    }

    if (existing && regenerate) {
      await db.delete(webcallLinksTable).where(eq(webcallLinksTable.id, existing.id));
    }

    const row = await mintWebsiteEmbedLink(agentId, clerkId);
    res.status(existing && regenerate ? 200 : 201).json(
      embedPayload(row, agent.id, agent.name ?? "Voice assistant", publicOrigin(req)),
    );
  } catch (err) {
    logger.error({ err, agentId }, "Failed to create website embed link");
    res.status(500).json({ error: "Failed to create embed" });
  }
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
