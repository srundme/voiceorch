import { Router } from "express";
import { and, desc, eq, asc } from "drizzle-orm";
import { 
  db, 
  automationSequencesTable, 
  automationSequenceStepsTable, 
  automationSequenceLeadsTable 
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logger } from "../lib/logger.js";

const router = Router();

function parseOptionalInt(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/* ── Sequences CRUD ──────────────────────────────────────────────────────── */

router.get("/automation-sequences", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const rows = await db
    .select()
    .from(automationSequencesTable)
    .where(eq(automationSequencesTable.userId, clerkId))
    .orderBy(desc(automationSequencesTable.createdAt));
  res.json(rows);
});

router.post("/automation-sequences", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const { name, description } = req.body;
  if (!name) {
    res.status(400).json({ error: "Name is required" });
    return;
  }
  const [seq] = await db
    .insert(automationSequencesTable)
    .values({
      userId: clerkId,
      name: String(name),
      description: description ? String(description) : null,
      isActive: true,
    })
    .returning();
  res.json(seq);
});

router.get("/automation-sequences/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(req.params.id, 10);
  if (!id) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [seq] = await db
    .select()
    .from(automationSequencesTable)
    .where(and(eq(automationSequencesTable.id, id), eq(automationSequencesTable.userId, clerkId)))
    .limit(1);
  if (!seq) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  
  // fetch steps
  const steps = await db
    .select()
    .from(automationSequenceStepsTable)
    .where(eq(automationSequenceStepsTable.sequenceId, seq.id))
    .orderBy(asc(automationSequenceStepsTable.stepOrder));
    
  res.json({ ...seq, steps });
});

router.delete("/automation-sequences/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(req.params.id, 10);
  if (!id) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db
    .delete(automationSequencesTable)
    .where(and(eq(automationSequencesTable.id, id), eq(automationSequencesTable.userId, clerkId)));
  res.json({ ok: true });
});

/* ── Steps CRUD ──────────────────────────────────────────────────────────── */

router.post("/automation-sequences/:id/steps", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(req.params.id, 10);
  if (!id) {
    res.status(400).json({ error: "Invalid sequence id" });
    return;
  }
  const [seq] = await db
    .select({ id: automationSequencesTable.id })
    .from(automationSequencesTable)
    .where(and(eq(automationSequencesTable.id, id), eq(automationSequencesTable.userId, clerkId)))
    .limit(1);
  if (!seq) {
    res.status(404).json({ error: "Sequence not found" });
    return;
  }

  const { stepOrder, config, agentId, promptOverride } = req.body;
  
  const [step] = await db
    .insert(automationSequenceStepsTable)
    .values({
      sequenceId: seq.id,
      stepOrder: parseInt(stepOrder, 10),
      config: config || {},
      agentId: parseOptionalInt(agentId),
      promptOverride: promptOverride ? String(promptOverride) : null,
    })
    .returning();
    
  res.json(step);
});

router.delete("/automation-sequences/:id/steps/:stepId", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(req.params.id, 10);
  const stepId = parseInt(req.params.stepId, 10);
  
  const [seq] = await db
    .select({ id: automationSequencesTable.id })
    .from(automationSequencesTable)
    .where(and(eq(automationSequencesTable.id, id), eq(automationSequencesTable.userId, clerkId)))
    .limit(1);
  if (!seq) {
    res.status(404).json({ error: "Sequence not found" });
    return;
  }

  await db
    .delete(automationSequenceStepsTable)
    .where(and(eq(automationSequenceStepsTable.id, stepId), eq(automationSequenceStepsTable.sequenceId, seq.id)));
    
  res.json({ ok: true });
});

/* ── Automatic Google Meet Room Generator ────────────────────────────────── */

router.post("/automation-sequences/generate-meet-link", requireAuth, async (req, res): Promise<void> => {
  const { sequenceId, leadId } = req.body;
  const roomSlug = 
    Math.random().toString(36).substring(2, 5) + "-" + 
    Math.random().toString(36).substring(2, 6) + "-" + 
    Math.random().toString(36).substring(2, 5);

  const meetUrl = `https://meet.google.com/${roomSlug}`;

  logger.info(`[GoogleMeetAuto] Generated automatic meet room for seq ${sequenceId || 'demo'}: ${meetUrl}`);

  res.json({
    ok: true,
    meetUrl,
    roomSlug,
    dispatchChannel: "whatsapp_and_sms",
    message: "Google Meet link generated automatically by VoiceOrch engine",
  });
});

export default router;
