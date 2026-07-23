import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq, and, desc, ilike, or, sql } from "drizzle-orm";
import { db, customDatabasesTable, customDatabaseRowsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const ColumnDefSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(128),
  type: z.enum(["text", "number", "image", "badge", "date"]),
  primaryKey: z.boolean().optional(),
  required: z.boolean().optional(),
});

const CreateDatabaseSchema = z.object({
  name: z.string().trim().min(1).max(128),
  description: z.string().max(500).optional(),
  agentId: z.number().int().optional().nullable(),
  columns: z.array(ColumnDefSchema).min(1),
});

const CreateRowSchema = z.object({
  data: z.record(z.any()),
  referenceImageUrls: z.array(z.string()).optional().default([]),
});

// List all custom databases
router.get("/custom-databases", async (req, res): Promise<void> => {
  try {
    const list = await db.select().from(customDatabasesTable).orderBy(desc(customDatabasesTable.createdAt));
    res.json(list);
  } catch (err) {
    logger.error({ err }, "Failed to list custom databases");
    res.status(500).json({ error: "Failed to list custom databases" });
  }
});

// Create custom database table
router.post("/custom-databases", async (req, res): Promise<void> => {
  const parsed = CreateDatabaseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid database payload", details: parsed.error.format() });
    return;
  }
  try {
    const [inserted] = await db
      .insert(customDatabasesTable)
      .values({
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        agentId: parsed.data.agentId ?? null,
        columns: parsed.data.columns,
      } as any)
      .returning();
    res.json(inserted);
  } catch (err) {
    logger.error({ err }, "Failed to create custom database");
    res.status(500).json({ error: "Failed to create custom database" });
  }
});

// Get single custom database details
router.get("/custom-databases/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  try {
    const [found] = await db.select().from(customDatabasesTable).where(eq(customDatabasesTable.id, id));
    if (!found) { res.status(404).json({ error: "Custom database not found" }); return; }
    res.json(found);
  } catch (err) {
    logger.error({ err }, "Failed to get custom database");
    res.status(500).json({ error: "Failed to fetch custom database" });
  }
});

// Delete custom database
router.delete("/custom-databases/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  try {
    await db.delete(customDatabasesTable).where(eq(customDatabasesTable.id, id));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Failed to delete custom database");
    res.status(500).json({ error: "Failed to delete custom database" });
  }
});

// List rows for custom database
router.get("/custom-databases/:id/rows", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  try {
    const rows = await db
      .select()
      .from(customDatabaseRowsTable)
      .where(eq(customDatabaseRowsTable.databaseId, id))
      .orderBy(desc(customDatabaseRowsTable.createdAt));
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "Failed to list custom database rows");
    res.status(500).json({ error: "Failed to list rows" });
  }
});

// Create/add row to custom database
router.post("/custom-databases/:id/rows", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const parsed = CreateRowSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid row payload" });
    return;
  }
  try {
    const [inserted] = await db
      .insert(customDatabaseRowsTable)
      .values({
        databaseId: id,
        data: parsed.data.data,
        referenceImageUrls: parsed.data.referenceImageUrls,
      })
      .returning();
    res.json(inserted);
  } catch (err) {
    logger.error({ err }, "Failed to add row");
    res.status(500).json({ error: "Failed to add row" });
  }
});

// Delete row from custom database
router.delete("/custom-databases/:id/rows/:rowId", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  const rowId = parseInt(req.params["rowId"] as string, 10);
  if (isNaN(id) || isNaN(rowId)) { res.status(400).json({ error: "Invalid ID" }); return; }
  try {
    await db
      .delete(customDatabaseRowsTable)
      .where(and(eq(customDatabaseRowsTable.databaseId, id), eq(customDatabaseRowsTable.id, rowId)));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Failed to delete row");
    res.status(500).json({ error: "Failed to delete row" });
  }
});

// Bulk import rows into custom database
router.post("/custom-databases/:id/bulk-import", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const rowsPayload = req.body?.rows;
  if (!Array.isArray(rowsPayload) || rowsPayload.length === 0) {
    res.status(400).json({ error: "Invalid or empty rows array" });
    return;
  }
  try {
    const toInsert = rowsPayload.map((r: any) => ({
      databaseId: id,
      data: r.data || r,
      referenceImageUrls: Array.isArray(r.referenceImageUrls) ? r.referenceImageUrls : [],
    }));
    await db.insert(customDatabaseRowsTable).values(toInsert);
    res.json({ success: true, count: toInsert.length });
  } catch (err) {
    logger.error({ err, databaseId: id }, "Failed bulk import");
    res.status(500).json({ error: "Bulk import failed" });
  }
});

// Query custom database (Used by Vision AI Agent tool executor!)
router.post("/custom-databases/:id/query", async (req, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  const searchKey = String(req.body?.searchKey ?? req.body?.query ?? "").trim();
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  try {
    const rows = await db
      .select()
      .from(customDatabaseRowsTable)
      .where(eq(customDatabaseRowsTable.databaseId, id));

    if (!searchKey) {
      res.json({ count: rows.length, results: rows.slice(0, 10) });
      return;
    }

    const matches = rows.filter((r) => {
      const dataStr = JSON.stringify(r.data).toLowerCase();
      return dataStr.includes(searchKey.toLowerCase());
    });

    res.json({
      query: searchKey,
      matchCount: matches.length,
      results: matches.map((m) => ({
        id: m.id,
        record: m.data,
        referencePhotos: m.referenceImageUrls,
      })),
    });
  } catch (err) {
    logger.error({ err }, "Failed to query custom database");
    res.status(500).json({ error: "Query failed" });
  }
});

export default router;
