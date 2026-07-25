import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, agentsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logger } from "../lib/logger.js";
import {
  listSchemas,
  createSchema,
  updateSchema,
  deleteSchema,
  insertRecord,
  listRecords,
  updateRecord,
  deleteRecord,
} from "../services/vision-agent-db.js";

const router = Router();

// ── Helper: verify agent belongs to user ─────────────────────────────────────
async function getAgentForUser(agentId: number, clerkId: string) {
  const [agent] = await db
    .select({ id: agentsTable.id, userId: agentsTable.userId })
    .from(agentsTable)
    .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, clerkId)))
    .limit(1);
  return agent ?? null;
}

// ── Schemas ───────────────────────────────────────────────────────────────────

router.get("/vision-agents/:id/db/schemas", requireAuth, async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.params.id), 10);
  const clerkId = (req as any).clerkUserId as string;

  if (!Number.isFinite(agentId)) { res.status(400).json({ error: "Invalid agent id" }); return; }
  const agent = await getAgentForUser(agentId, clerkId);
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  try {
    const schemas = await listSchemas(agentId);
    res.json(schemas);
  } catch (err) {
    logger.error({ err, agentId }, "Failed to list DB schemas");
    res.status(500).json({ error: "Failed to list schemas" });
  }
});

router.post("/vision-agents/:id/db/schemas", requireAuth, async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.params.id), 10);
  const clerkId = (req as any).clerkUserId as string;

  if (!Number.isFinite(agentId)) { res.status(400).json({ error: "Invalid agent id" }); return; }
  const agent = await getAgentForUser(agentId, clerkId);
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!body["name"] || typeof body["name"] !== "string") {
    res.status(400).json({ error: "name is required" });
    return;
  }

  try {
    const schema = await createSchema(agentId, clerkId, {
      name: body["name"],
      description: typeof body["description"] === "string" ? body["description"] : null,
      fields: Array.isArray(body["fields"]) ? body["fields"] : [],
      writeable: body["writeable"] !== false,
    });
    res.status(201).json(schema);
  } catch (err) {
    logger.error({ err, agentId }, "Failed to create DB schema");
    res.status(500).json({ error: "Failed to create schema" });
  }
});

router.patch("/vision-agents/:id/db/schemas/:schemaId", requireAuth, async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.params.id), 10);
  const schemaId = parseInt(String(req.params.schemaId), 10);
  const clerkId = (req as any).clerkUserId as string;

  if (!Number.isFinite(agentId) || !Number.isFinite(schemaId)) {
    res.status(400).json({ error: "Invalid id" }); return;
  }
  const agent = await getAgentForUser(agentId, clerkId);
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: Parameters<typeof updateSchema>[1] = {};
  if (typeof body["name"] === "string") patch.name = body["name"];
  if (typeof body["description"] === "string") patch.description = body["description"];
  if (Array.isArray(body["fields"])) patch.fields = body["fields"];
  if (typeof body["writeable"] === "boolean") patch.writeable = body["writeable"];

  try {
    const schema = await updateSchema(schemaId, patch);
    res.json(schema);
  } catch (err) {
    logger.error({ err, schemaId }, "Failed to update DB schema");
    res.status(500).json({ error: "Failed to update schema" });
  }
});

router.delete("/vision-agents/:id/db/schemas/:schemaId", requireAuth, async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.params.id), 10);
  const schemaId = parseInt(String(req.params.schemaId), 10);
  const clerkId = (req as any).clerkUserId as string;

  if (!Number.isFinite(agentId) || !Number.isFinite(schemaId)) {
    res.status(400).json({ error: "Invalid id" }); return;
  }
  const agent = await getAgentForUser(agentId, clerkId);
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  try {
    await deleteSchema(schemaId);
    res.status(204).end();
  } catch (err) {
    logger.error({ err, schemaId }, "Failed to delete DB schema");
    res.status(500).json({ error: "Failed to delete schema" });
  }
});

// ── Records ───────────────────────────────────────────────────────────────────

router.get("/vision-agents/:id/db/schemas/:schemaId/records", requireAuth, async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.params.id), 10);
  const schemaId = parseInt(String(req.params.schemaId), 10);
  const clerkId = (req as any).clerkUserId as string;
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "50"), 10) || 50, 500);
  const offset = parseInt(String(req.query["offset"] ?? "0"), 10) || 0;
  const search = typeof req.query["search"] === "string" ? req.query["search"].trim() || null : null;

  if (!Number.isFinite(agentId) || !Number.isFinite(schemaId)) {
    res.status(400).json({ error: "Invalid id" }); return;
  }
  const agent = await getAgentForUser(agentId, clerkId);
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  try {
    const records = await listRecords(schemaId, limit, offset, search);
    res.json(records);
  } catch (err) {
    logger.error({ err, schemaId }, "Failed to list DB records");
    res.status(500).json({ error: "Failed to list records" });
  }
});

router.post("/vision-agents/:id/db/schemas/:schemaId/records", requireAuth, async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.params.id), 10);
  const schemaId = parseInt(String(req.params.schemaId), 10);
  const clerkId = (req as any).clerkUserId as string;

  if (!Number.isFinite(agentId) || !Number.isFinite(schemaId)) {
    res.status(400).json({ error: "Invalid id" }); return;
  }
  const agent = await getAgentForUser(agentId, clerkId);
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const data = (body["data"] as Record<string, unknown> | undefined) ?? body;

  try {
    const record = await insertRecord(schemaId, agentId, data, null, null);
    res.status(201).json(record);
  } catch (err) {
    logger.error({ err, schemaId }, "Failed to create DB record");
    res.status(500).json({ error: "Failed to create record" });
  }
});

router.patch("/vision-agents/:id/db/schemas/:schemaId/records/:recordId", requireAuth, async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.params.id), 10);
  const schemaId = parseInt(String(req.params.schemaId), 10);
  const recordId = parseInt(String(req.params.recordId), 10);
  const clerkId = (req as any).clerkUserId as string;

  if (!Number.isFinite(agentId) || !Number.isFinite(schemaId) || !Number.isFinite(recordId)) {
    res.status(400).json({ error: "Invalid id" }); return;
  }
  const agent = await getAgentForUser(agentId, clerkId);
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const data = (body["data"] as Record<string, unknown> | undefined) ?? body;

  try {
    const record = await updateRecord(recordId, data);
    res.json(record);
  } catch (err) {
    logger.error({ err, recordId }, "Failed to update DB record");
    res.status(500).json({ error: "Failed to update record" });
  }
});

router.delete("/vision-agents/:id/db/schemas/:schemaId/records/:recordId", requireAuth, async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.params.id), 10);
  const schemaId = parseInt(String(req.params.schemaId), 10);
  const recordId = parseInt(String(req.params.recordId), 10);
  const clerkId = (req as any).clerkUserId as string;

  if (!Number.isFinite(agentId) || !Number.isFinite(schemaId) || !Number.isFinite(recordId)) {
    res.status(400).json({ error: "Invalid id" }); return;
  }
  const agent = await getAgentForUser(agentId, clerkId);
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  try {
    await deleteRecord(recordId);
    res.status(204).end();
  } catch (err) {
    logger.error({ err, recordId }, "Failed to delete DB record");
    res.status(500).json({ error: "Failed to delete record" });
  }
});

// ── Export as CSV ─────────────────────────────────────────────────────────────

router.post("/vision-agents/:id/db/schemas/:schemaId/export", requireAuth, async (req, res): Promise<void> => {
  const agentId = parseInt(String(req.params.id), 10);
  const schemaId = parseInt(String(req.params.schemaId), 10);
  const clerkId = (req as any).clerkUserId as string;

  if (!Number.isFinite(agentId) || !Number.isFinite(schemaId)) {
    res.status(400).json({ error: "Invalid id" }); return;
  }
  const agent = await getAgentForUser(agentId, clerkId);
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  try {
    const records = await listRecords(schemaId, 10000, 0);
    if (records.length === 0) {
      res.status(200).send("id,created_at\n");
      return;
    }

    // Collect all field keys
    const allKeys = new Set<string>(["id", "created_at", "call_id", "phone"]);
    for (const rec of records) {
      for (const k of Object.keys(rec.data as Record<string, unknown>)) {
        allKeys.add(k);
      }
    }
    const headers = Array.from(allKeys);

    function escCsv(v: unknown): string {
      const s = v == null ? "" : String(v);
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    }

    const lines = [
      headers.join(","),
      ...records.map((rec) => {
        const d = (rec.data ?? {}) as Record<string, unknown>;
        return headers.map((h) => {
          if (h === "id") return escCsv(rec.id);
          if (h === "created_at") return escCsv(rec.createdAt?.toISOString?.() ?? rec.createdAt);
          if (h === "call_id") return escCsv(rec.callId);
          if (h === "phone") return escCsv(rec.phone);
          return escCsv(d[h]);
        }).join(",");
      }),
    ];

    const csv = lines.join("\n");
    res.set("Content-Type", "text/csv");
    res.set("Content-Disposition", `attachment; filename="schema-${schemaId}-records.csv"`);
    res.send(csv);
  } catch (err) {
    logger.error({ err, schemaId }, "Failed to export DB records");
    res.status(500).json({ error: "Failed to export records" });
  }
});

export default router;
