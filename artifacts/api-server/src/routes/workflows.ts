/**
 * Workflow maker — authenticated CRUD, run history, and the chat builder.
 *
 * The chat builder (POST /workflows/chat) mirrors the Vibe agent builder: an
 * SSE stream driven by Gemini in JSON mode. The model turns a plain-language
 * description into a structured { trigger, steps } workflow that non-coders
 * never have to edit by hand.
 */

import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import { eq, and, desc } from "drizzle-orm";
import { geminiThinkingConfig } from "../orchestration/adapters/llm/google.js";
import {
  db, workflowsTable, workflowRunsTable, agentsTable, platformSettingsTable,
  type WorkflowTrigger, type WorkflowStep, type Workflow,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logger } from "../lib/logger.js";
import { startWorkflowRun } from "../services/workflow-engine.js";

const router: IRouter = Router();

// ── Serialization ─────────────────────────────────────────────────────────────

function serializeWorkflow(w: Workflow) {
  return {
    id: w.id,
    name: w.name,
    description: w.description,
    status: w.status,
    trigger: w.trigger,
    steps: w.steps,
    publicToken: w.publicToken,
    hookUrl: w.publicToken ? `/api/workflows/hook/${w.publicToken}` : null,
    totalRuns: w.totalRuns,
    lastRunAt: w.lastRunAt,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  };
}

function needsPublicToken(trigger: WorkflowTrigger | undefined): boolean {
  return trigger?.type === "form_lead" || trigger?.type === "instagram_lead";
}

// ── CRUD ───────────────────────────────────────────────────────────────────────

router.get("/workflows", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const rows = await db.select().from(workflowsTable)
    .where(eq(workflowsTable.userId, clerkId))
    .orderBy(desc(workflowsTable.updatedAt));
  res.json(rows.map(serializeWorkflow));
});

router.get("/workflows/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const [w] = await db.select().from(workflowsTable)
    .where(and(eq(workflowsTable.id, id), eq(workflowsTable.userId, clerkId))).limit(1);
  if (!w) { res.status(404).json({ error: "Workflow not found" }); return; }
  res.json(serializeWorkflow(w));
});

router.post("/workflows", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const { name, description, trigger, steps } = req.body as {
    name?: string; description?: string; trigger?: WorkflowTrigger; steps?: WorkflowStep[];
  };
  if (!name || !trigger?.type) { res.status(400).json({ error: "name and trigger.type required" }); return; }
  const [w] = await db.insert(workflowsTable).values({
    userId: clerkId,
    name,
    description: description ?? null,
    status: "draft",
    trigger,
    steps: steps ?? [],
    publicToken: needsPublicToken(trigger) ? `wfh_${randomBytes(18).toString("hex")}` : null,
  }).returning();
  res.status(201).json(serializeWorkflow(w!));
});

router.patch("/workflows/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const [existing] = await db.select().from(workflowsTable)
    .where(and(eq(workflowsTable.id, id), eq(workflowsTable.userId, clerkId))).limit(1);
  if (!existing) { res.status(404).json({ error: "Workflow not found" }); return; }

  const body = req.body as Partial<{ name: string; description: string; trigger: WorkflowTrigger; steps: WorkflowStep[]; status: string }>;
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates["name"] = body.name;
  if (body.description !== undefined) updates["description"] = body.description;
  if (body.trigger !== undefined) {
    updates["trigger"] = body.trigger;
    // Ensure a public token exists when switching to a form/instagram trigger.
    if (needsPublicToken(body.trigger) && !existing.publicToken) {
      updates["publicToken"] = `wfh_${randomBytes(18).toString("hex")}`;
    }
  }
  if (body.steps !== undefined) updates["steps"] = body.steps;
  if (body.status !== undefined && ["draft", "active", "paused"].includes(body.status)) updates["status"] = body.status;

  const [w] = await db.update(workflowsTable).set(updates)
    .where(and(eq(workflowsTable.id, id), eq(workflowsTable.userId, clerkId))).returning();
  res.json(serializeWorkflow(w!));
});

router.delete("/workflows/:id", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const [w] = await db.delete(workflowsTable)
    .where(and(eq(workflowsTable.id, id), eq(workflowsTable.userId, clerkId))).returning();
  if (!w) { res.status(404).json({ error: "Workflow not found" }); return; }
  res.sendStatus(204);
});

// ── Activate / pause ─────────────────────────────────────────────────────────

async function setStatus(clerkId: string, id: number, status: "active" | "paused" | "draft"): Promise<Workflow | null> {
  const [existing] = await db.select().from(workflowsTable)
    .where(and(eq(workflowsTable.id, id), eq(workflowsTable.userId, clerkId))).limit(1);
  if (!existing) return null;

  const [w] = await db.update(workflowsTable).set({ status })
    .where(and(eq(workflowsTable.id, id), eq(workflowsTable.userId, clerkId))).returning();
  return w ?? null;
}

router.post("/workflows/:id/activate", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const w = await setStatus(clerkId, parseInt(String(req.params["id"]), 10), "active");
  if (!w) { res.status(404).json({ error: "Workflow not found" }); return; }
  res.json(serializeWorkflow(w));
});

router.post("/workflows/:id/pause", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const w = await setStatus(clerkId, parseInt(String(req.params["id"]), 10), "paused");
  if (!w) { res.status(404).json({ error: "Workflow not found" }); return; }
  res.json(serializeWorkflow(w));
});

// ── Manual test run ──────────────────────────────────────────────────────────

router.post("/workflows/:id/test", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const [w] = await db.select().from(workflowsTable)
    .where(and(eq(workflowsTable.id, id), eq(workflowsTable.userId, clerkId))).limit(1);
  if (!w) { res.status(404).json({ error: "Workflow not found" }); return; }
  const context = (req.body?.context ?? {}) as Record<string, unknown>;
  const runId = await startWorkflowRun({ workflow: w as Workflow, context, triggeredBy: "test" });
  res.status(201).json({ runId });
});

// ── Run history ────────────────────────────────────────────────────────────────

router.get("/workflows/:id/runs", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const id = parseInt(String(req.params["id"]), 10);
  const [w] = await db.select().from(workflowsTable)
    .where(and(eq(workflowsTable.id, id), eq(workflowsTable.userId, clerkId))).limit(1);
  if (!w) { res.status(404).json({ error: "Workflow not found" }); return; }
  const runs = await db.select().from(workflowRunsTable)
    .where(eq(workflowRunsTable.workflowId, id))
    .orderBy(desc(workflowRunsTable.createdAt))
    .limit(100);
  res.json(runs.map(r => ({
    id: r.id,
    status: r.status,
    triggeredBy: r.triggeredBy,
    currentStepIndex: r.currentStepIndex,
    callId: r.callId,
    context: r.context,
    error: r.error,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  })));
});

/* ═══════════════════════════ Chat builder (SSE + Gemini) ═══════════════════ */

interface ChatMessage { role: "user" | "assistant"; content: string; }

const WORKFLOW_GEMINI_MODEL = "gemini-3.5-flash-lite";

async function getGeminiKey(): Promise<string | null> {
  try {
    const [row] = await db.select().from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, "managed_gemini_key"));
    return row?.value ?? process.env["GEMINI_API_KEY"] ?? null;
  } catch {
    return process.env["GEMINI_API_KEY"] ?? null;
  }
}

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

function buildSystemPrompt(ctx: {
  agents: Array<{ id: number; name: string }>;
}): string {
  const agentList = ctx.agents.length
    ? ctx.agents.map(a => `- "${a.name}" (agentId: ${a.id})`).join("\n")
    : "(none yet — tell the user to create an agent first)";

  return `You are SnapServe's Workflow Builder. You help NON-TECHNICAL users create phone-call automations by chatting in plain language. Be warm, concise, and never show JSON or technical jargon in your "reply" text.

A workflow = ONE trigger + an ordered list of steps.

TRIGGERS (pick one):
- "form_lead": a lead arrives from a website form / landing page / Instagram form. (Gives the user a webhook URL to paste into their form tool.)
- "instagram_lead": Instagram / Meta lead ads (same intake as form_lead).
- "manual": the user triggers it themselves.

STEP TYPES:
- "make_call": the AI agent phones the lead. REQUIRES agentId (choose from the user's agents below by matching the name they mention; if unclear, ask which agent). Optional phoneField (context key holding the phone, default "phone").
- "condition": continue only if a value matches. Fields: field (context path), op ("eq"|"neq"|"contains"|"exists"|"gt"|"lt"), value.
- "delay": wait. Field: delaySeconds.
- "send_webhook": POST all data to a URL. Field: url.

CONTEXT TOKENS available in templates ({{token}}):
- Trigger fields: {{phone}}, {{name}}, {{email}}, and any form field by its name.
- After a make_call step: {{call.connected}}, {{call.status}}, {{call.duration}}, {{call.summary}}, {{call.transcript}}, {{call.success}}, {{call.recordingUrl}}, and disposition fields like {{call.disposition.<key>}}.

USER'S AGENTS:
${agentList}

CONVERSATION RULES:
1. Ask clarifying questions until you know: the trigger, which agent makes the call, and what to do with the results.
2. Keep replies to 1-3 short sentences. One question at a time.
3. When you have enough to build it, set "ready": true and include the full "workflow".

RESPOND WITH ONLY THIS JSON (no markdown fences, no prose outside it):
{
  "reply": "your short message to the user",
  "ready": false,
  "workflow": null
}
When ready, "workflow" MUST look like:
{
  "name": "short name",
  "description": "one line",
  "trigger": { "type": "form_lead" | "instagram_lead" | "manual", "fieldMap"?: { "SourceField": "contextKey" } },
  "steps": [ { "id": "s1", "type": "make_call", "agentId": 123 }, { "id": "s2", "type": "send_webhook", "url": "https://example.com/hook" } ]
}`;
}

interface WorkflowChatResult { reply: string; ready: boolean; workflow: unknown | null; }

function parseWorkflowJson(raw: string): WorkflowChatResult | null {
  let t = raw.trim();
  if (t.startsWith("```")) t = t.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
  if (!t.startsWith("{")) {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) t = m[0];
  }
  try {
    const p = JSON.parse(t) as Partial<WorkflowChatResult>;
    if (typeof p.reply !== "string" || !p.reply.trim()) return null;
    return { reply: p.reply.trim(), ready: !!p.ready, workflow: p.workflow ?? null };
  } catch {
    return null;
  }
}

async function callGemini(key: string, messages: ChatMessage[], systemPrompt: string): Promise<WorkflowChatResult> {
  const contents = messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: { responseMimeType: "application/json", temperature: 0.4, maxOutputTokens: 8192, thinkingConfig: geminiThinkingConfig(WORKFLOW_GEMINI_MODEL) },
  });

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await Promise.race([
        fetch(`https://generativelanguage.googleapis.com/v1beta/models/${WORKFLOW_GEMINI_MODEL}:generateContent?key=${key}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("gemini_timeout")), 60000)),
      ]);
      if (!resp.ok) {
        if ((resp.status === 429 || resp.status >= 500) && attempt < 3) { await sleep(attempt * 1500); continue; }
        throw new Error(`Gemini ${resp.status}`);
      }
      const data = await resp.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> };
      const parts = data.candidates?.[0]?.content?.parts ?? [];
      const text = parts.filter(p => typeof p.text === "string" && !p.thought).map(p => p.text!).join("")
        || parts.map(p => p.text ?? "").join("");
      const parsed = parseWorkflowJson(text);
      if (parsed) return parsed;
      if (attempt < 3) { await sleep(attempt * 1000); continue; }
      throw new Error("Gemini JSON parse failed");
    } catch (err) {
      if (attempt >= 3) throw err;
      await sleep(attempt * 1500);
    }
  }
  throw new Error("Gemini call failed");
}

function sanitizeWorkflow(raw: unknown): { name: string; description: string; trigger: WorkflowTrigger; steps: WorkflowStep[] } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const trigger = o["trigger"] as WorkflowTrigger | undefined;
  if (!trigger?.type) return null;
  const stepsRaw = Array.isArray(o["steps"]) ? (o["steps"] as WorkflowStep[]) : [];
  const steps = stepsRaw.map((s, i) => ({ ...s, id: s.id || `s${i + 1}` }));
  return {
    name: String(o["name"] ?? "Untitled workflow").slice(0, 120),
    description: String(o["description"] ?? ""),
    trigger,
    steps,
  };
}

router.post("/workflows/chat", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const { messages, workflowId } = req.body as { messages: ChatMessage[]; workflowId?: number };
  if (!Array.isArray(messages) || messages.length === 0) { res.status(400).json({ error: "messages required" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const emit = (data: object): void => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); (res as any).flush?.(); } catch { /* client gone */ }
  };

  try {
    const key = await getGeminiKey();
    if (!key) { emit({ type: "error", message: "No AI key configured — contact the platform admin." }); res.end(); return; }

    const agents = await db.select({ id: agentsTable.id, name: agentsTable.name })
      .from(agentsTable).where(eq(agentsTable.userId, clerkId));

    const systemPrompt = buildSystemPrompt({ agents });

    const result = await callGemini(key, messages, systemPrompt);

    // Stream the assistant reply as a typing effect.
    for (const ch of result.reply) { emit({ type: "text", delta: ch }); await sleep(6); }

    if (result.ready && result.workflow) {
      const clean = sanitizeWorkflow(result.workflow);
      if (clean) {
        emit({ type: "workflow_preview", workflow: clean });
        // Persist (create or update the draft).
        let saved: Workflow;
        if (workflowId) {
          const [w] = await db.update(workflowsTable)
            .set({
              name: clean.name, description: clean.description, trigger: clean.trigger, steps: clean.steps,
              ...(needsPublicToken(clean.trigger) ? {} : {}),
            })
            .where(and(eq(workflowsTable.id, workflowId), eq(workflowsTable.userId, clerkId)))
            .returning();
          saved = w!;
          if (needsPublicToken(clean.trigger) && !saved.publicToken) {
            const [w2] = await db.update(workflowsTable).set({ publicToken: `wfh_${randomBytes(18).toString("hex")}` })
              .where(eq(workflowsTable.id, saved.id)).returning();
            saved = w2!;
          }
        } else {
          const [w] = await db.insert(workflowsTable).values({
            userId: clerkId,
            name: clean.name,
            description: clean.description,
            status: "draft",
            trigger: clean.trigger,
            steps: clean.steps,
            publicToken: needsPublicToken(clean.trigger) ? `wfh_${randomBytes(18).toString("hex")}` : null,
          }).returning();
          saved = w!;
        }
        emit({ type: "created", workflow: serializeWorkflow(saved) });
      }
    } else {
      emit({ type: "workflow_preview", workflow: result.workflow ?? null });
    }

    emit({ type: "done" });
    res.end();
  } catch (err) {
    logger.error({ err, clerkId }, "workflow chat failed");
    emit({ type: "error", message: "The AI builder had trouble. Please try again." });
    res.end();
  }
});

export default router;
