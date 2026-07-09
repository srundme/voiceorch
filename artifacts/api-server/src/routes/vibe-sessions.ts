import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth.js";
import { db, vibeChatSessionsTable, vibeChatMessagesTable } from "@workspace/db";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import { z } from "zod/v4";

const router = Router();

router.post("/vibe/sessions", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const parsed = z.object({
    agentId: z.number().int().positive().nullable().optional(),
    title: z.string().min(1).max(200),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const { agentId, title } = parsed.data;

  const [session] = await db.insert(vibeChatSessionsTable).values({
    userId: clerkId,
    agentId: agentId ?? null,
    title,
  }).returning();

  res.json({ id: session!.id, title: session!.title, agentId: session!.agentId, createdAt: session!.createdAt });
});

router.get("/vibe/sessions", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const agentIdRaw = req.query.agentId;
  const agentId = agentIdRaw ? parseInt(String(agentIdRaw), 10) : null;

  const conditions: ReturnType<typeof eq>[] = [eq(vibeChatSessionsTable.userId, clerkId)];
  if (agentId && !isNaN(agentId)) {
    conditions.push(eq(vibeChatSessionsTable.agentId, agentId) as any);
  }

  const sessions = await db.select({
    id: vibeChatSessionsTable.id,
    title: vibeChatSessionsTable.title,
    agentId: vibeChatSessionsTable.agentId,
    createdAt: vibeChatSessionsTable.createdAt,
    updatedAt: vibeChatSessionsTable.updatedAt,
    messageCount: sql<number>`(SELECT COUNT(*) FROM vibe_chat_messages WHERE session_id = ${vibeChatSessionsTable.id})::int`,
  })
  .from(vibeChatSessionsTable)
  .where(and(...(conditions as [ReturnType<typeof eq>])))
  .orderBy(desc(vibeChatSessionsTable.updatedAt));

  res.json(sessions);
});

router.get("/vibe/sessions/:id/messages", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const sessionId = parseInt(String(req.params.id), 10);
  if (isNaN(sessionId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [session] = await db.select().from(vibeChatSessionsTable)
    .where(and(eq(vibeChatSessionsTable.id, sessionId), eq(vibeChatSessionsTable.userId, clerkId)));
  if (!session) { res.status(404).json({ error: "Not found" }); return; }

  const messages = await db.select().from(vibeChatMessagesTable)
    .where(eq(vibeChatMessagesTable.sessionId, sessionId))
    .orderBy(asc(vibeChatMessagesTable.createdAt));

  res.json(messages.map(m => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt })));
});

router.patch("/vibe/sessions/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const sessionId = parseInt(String(req.params.id), 10);
  if (isNaN(sessionId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = z.object({
    agentId: z.number().int().positive().nullable().optional(),
    title: z.string().min(1).max(200).optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }

  const [session] = await db.select().from(vibeChatSessionsTable)
    .where(and(eq(vibeChatSessionsTable.id, sessionId), eq(vibeChatSessionsTable.userId, clerkId)));
  if (!session) { res.status(404).json({ error: "Not found" }); return; }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.agentId !== undefined) updates.agentId = parsed.data.agentId;
  if (parsed.data.title !== undefined) updates.title = parsed.data.title;

  const [updated] = await (db.update(vibeChatSessionsTable) as any)
    .set(updates)
    .where(eq(vibeChatSessionsTable.id, sessionId))
    .returning();

  res.json({ id: updated.id, title: updated.title, agentId: updated.agentId, updatedAt: updated.updatedAt });
});

router.post("/vibe/sessions/:id/messages", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const sessionId = parseInt(String(req.params.id), 10);
  if (isNaN(sessionId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = z.object({
    messages: z.array(z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string(),
    })).min(1),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }

  const [session] = await db.select().from(vibeChatSessionsTable)
    .where(and(eq(vibeChatSessionsTable.id, sessionId), eq(vibeChatSessionsTable.userId, clerkId)));
  if (!session) { res.status(404).json({ error: "Not found" }); return; }

  await db.insert(vibeChatMessagesTable).values(
    parsed.data.messages.map(m => ({ sessionId, role: m.role, content: m.content })),
  );
  await (db.update(vibeChatSessionsTable) as any)
    .set({ updatedAt: new Date() })
    .where(eq(vibeChatSessionsTable.id, sessionId));

  res.json({ ok: true });
});

export default router;
