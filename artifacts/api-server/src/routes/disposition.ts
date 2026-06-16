import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, agentDispositionsTable, callDispositionsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { evictDispositionCache } from "../services/disposition.js";

const router = Router();

function parseIntParam(val: string | string[] | undefined): number {
  return parseInt(String(val ?? ""), 10);
}

function isValidTaxonomy(v: unknown): v is Record<string, string[]> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.values(v as object).every(
    (arr) => Array.isArray(arr) && (arr as unknown[]).every((s) => typeof s === "string"),
  );
}

/* ── GET /api/disposition/config/:agentId ────────────────────────────────── */
router.get("/disposition/config/:agentId", requireAuth, async (req, res): Promise<void> => {
  const agentId = parseIntParam(req.params["agentId"]);
  if (!agentId || isNaN(agentId)) {
    res.status(400).json({ error: "Invalid agentId" });
    return;
  }

  const [row] = await db
    .select()
    .from(agentDispositionsTable)
    .where(eq(agentDispositionsTable.agentId, agentId));

  if (!row) {
    res.status(404).json({ error: "No disposition config for this agent" });
    return;
  }

  res.json(row);
});

/* ── PUT /api/disposition/config/:agentId ────────────────────────────────── */
router.put("/disposition/config/:agentId", requireAuth, async (req, res): Promise<void> => {
  const agentId = parseIntParam(req.params["agentId"]);
  if (!agentId || isNaN(agentId)) {
    res.status(400).json({ error: "Invalid agentId" });
    return;
  }

  const body = req.body as Record<string, unknown>;
  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "Request body must be an object" });
    return;
  }

  const { taxonomy, domainFields, rules } = body;

  if (!isValidTaxonomy(taxonomy)) {
    res.status(400).json({ error: "taxonomy must be Record<string, string[]>" });
    return;
  }

  await db
    .insert(agentDispositionsTable)
    .values({
      agentId,
      taxonomy:     taxonomy as Record<string, string[]>,
      domainFields: (domainFields ?? []) as any,
      rules:        (rules ?? []) as any,
    })
    .onConflictDoUpdate({
      target: agentDispositionsTable.agentId,
      set: {
        taxonomy:     taxonomy as Record<string, string[]>,
        domainFields: (domainFields ?? []) as any,
        rules:        (rules ?? []) as any,
        updatedAt:    new Date(),
      },
    });

  evictDispositionCache(agentId);
  res.json({ ok: true });
});

/* ── GET /api/disposition/result/:callId ─────────────────────────────────── */
router.get("/disposition/result/:callId", requireAuth, async (req, res): Promise<void> => {
  const callId = parseIntParam(req.params["callId"]);
  if (!callId || isNaN(callId)) {
    res.status(400).json({ error: "Invalid callId" });
    return;
  }

  const [row] = await db
    .select()
    .from(callDispositionsTable)
    .where(eq(callDispositionsTable.callId, callId));

  if (!row) {
    res.status(404).json({ error: "No disposition result for this call" });
    return;
  }

  res.json(row);
});

export default router;
