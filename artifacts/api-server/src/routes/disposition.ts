import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, agentDispositionsTable, callDispositionsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { clientContext } from "../middlewares/clientContext.js";
import { evictDispositionCache } from "../services/disposition.js";

const router = Router();

const TaxonomyMapSchema = z.record(z.string(), z.array(z.string()));

const MeaningMapSchema = z.object({
  interested: z.array(z.string()).default([]),
  callback:   z.array(z.string()).default([]),
  dnc:        z.array(z.string()).default([]),
}).nullable().optional();

const UpsertConfigBody = z.object({
  taxonomy:     TaxonomyMapSchema,
  domainFields: z.array(z.object({
    key:   z.string().min(1).max(64),
    type:  z.enum(["string", "number", "boolean"]),
    label: z.string().max(120).optional(),
    enum:  z.array(z.string()).optional(),
  })).optional().default([]),
  rules: z.array(z.object({
    when:       z.string(),
    value:      z.unknown().optional(),
    primary:    z.string(),
    sub:        z.string(),
    confidence: z.number().min(0).max(1),
  })).optional().default([]),
  meaningMap: MeaningMapSchema,
});

/* ── GET /api/disposition/config/:agentId ────────────────────────────────── */
router.get("/disposition/config/:agentId", requireAuth, clientContext, async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.params["agentId"] ?? ""), 10);
  if (!agentId || isNaN(agentId)) {
    res.status(400).json({ error: "Invalid agentId" });
    return;
  }

  const [row] = await db
    .select()
    .from(agentDispositionsTable)
    .where(eq(agentDispositionsTable.agentId, agentId));

  if (!row) {
    res.json({
      agentId,
      taxonomy: {},
      domainFields: [],
      rules: [],
      meaningMap: { interested: [], callback: [], dnc: [] },
    });
    return;
  }

  res.json({
    ...row,
    meaningMap: row.meaningMap ?? { interested: [], callback: [], dnc: [] },
  });
});

/* ── PUT /api/disposition/config/:agentId ────────────────────────────────── */
router.put("/disposition/config/:agentId", requireAuth, clientContext, async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.params["agentId"] ?? ""), 10);
  if (!agentId || isNaN(agentId)) {
    res.status(400).json({ error: "Invalid agentId" });
    return;
  }

  const parsed = UpsertConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  const { taxonomy, domainFields, rules, meaningMap } = parsed.data;

  const meaning =
    meaningMap === undefined
      ? undefined
      : meaningMap === null
        ? null
        : {
            interested: meaningMap.interested ?? [],
            callback: meaningMap.callback ?? [],
            dnc: meaningMap.dnc ?? [],
          };

  await db
    .insert(agentDispositionsTable)
    .values({
      agentId,
      taxonomy:     taxonomy as Record<string, string[]>,
      domainFields: domainFields as any,
      rules:        rules as any,
      ...(meaning !== undefined ? { meaningMap: meaning } : {}),
    })
    .onConflictDoUpdate({
      target: agentDispositionsTable.agentId,
      set: {
        taxonomy:     taxonomy as Record<string, string[]>,
        domainFields: domainFields as any,
        rules:        rules as any,
        ...(meaning !== undefined ? { meaningMap: meaning } : {}),
        updatedAt:    new Date(),
      },
    });

  evictDispositionCache(agentId);
  res.json({ ok: true });
});

/* ── GET /api/disposition/result/:callId ─────────────────────────────────── */
router.get("/disposition/result/:callId", requireAuth, clientContext, async (req, res): Promise<void> => {
  const callId = parseInt(String(req.params["callId"] ?? ""), 10);
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
