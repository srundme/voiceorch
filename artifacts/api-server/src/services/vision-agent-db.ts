import { eq, desc, sql, and } from "drizzle-orm";
import {
  db,
  visionAgentDbSchemasTable,
  visionAgentDbRecordsTable,
} from "@workspace/db";
import type { VisionAgentDbSchema, VisionAgentDbRecord } from "@workspace/db";
import { logger } from "../lib/logger.js";

export type { VisionAgentDbSchema, VisionAgentDbRecord };

export async function listSchemas(agentId: number): Promise<VisionAgentDbSchema[]> {
  return db
    .select()
    .from(visionAgentDbSchemasTable)
    .where(eq(visionAgentDbSchemasTable.agentId, agentId))
    .orderBy(visionAgentDbSchemasTable.createdAt);
}

export interface CreateSchemaParams {
  name: string;
  description?: string | null;
  fields?: unknown;
  writeable?: boolean;
}

export async function createSchema(
  agentId: number,
  userId: string,
  params: CreateSchemaParams,
): Promise<VisionAgentDbSchema> {
  const [row] = await db
    .insert(visionAgentDbSchemasTable)
    .values({
      agentId,
      userId,
      name: params.name,
      description: params.description ?? null,
      fields: (params.fields ?? []) as unknown[],
      writeable: params.writeable ?? true,
    })
    .returning();
  if (!row) throw new Error("Failed to create schema");
  return row;
}

export async function updateSchema(
  id: number,
  data: Partial<Pick<VisionAgentDbSchema, "name" | "description" | "fields" | "writeable">>,
): Promise<VisionAgentDbSchema> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) patch["name"] = data.name;
  if (data.description !== undefined) patch["description"] = data.description;
  if (data.fields !== undefined) patch["fields"] = data.fields;
  if (data.writeable !== undefined) patch["writeable"] = data.writeable;

  const [row] = await db
    .update(visionAgentDbSchemasTable)
    .set(patch as typeof visionAgentDbSchemasTable.$inferInsert)
    .where(eq(visionAgentDbSchemasTable.id, id))
    .returning();
  if (!row) throw new Error("Schema not found");
  return row;
}

export async function deleteSchema(id: number): Promise<void> {
  await db
    .delete(visionAgentDbSchemasTable)
    .where(eq(visionAgentDbSchemasTable.id, id));
}

export async function insertRecord(
  schemaId: number,
  agentId: number,
  data: Record<string, unknown>,
  callId?: number | null,
  phone?: string | null,
): Promise<VisionAgentDbRecord> {
  const [row] = await db
    .insert(visionAgentDbRecordsTable)
    .values({
      schemaId,
      agentId,
      data,
      callId: callId ?? null,
      phone: phone ?? null,
    })
    .returning();
  if (!row) throw new Error("Failed to insert record");
  logger.info({ schemaId, agentId, recordId: row.id }, "vision-agent-db: record inserted");
  return row;
}

export async function listRecords(
  schemaId: number,
  limit: number,
  offset: number,
  search?: string | null,
): Promise<VisionAgentDbRecord[]> {
  const conditions = [eq(visionAgentDbRecordsTable.schemaId, schemaId)];
  if (search) {
    conditions.push(sql`${visionAgentDbRecordsTable.data}::text ILIKE ${"%" + search + "%"}`);
  }
  return db
    .select()
    .from(visionAgentDbRecordsTable)
    .where(and(...conditions))
    .orderBy(desc(visionAgentDbRecordsTable.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function updateRecord(
  id: number,
  data: Record<string, unknown>,
): Promise<VisionAgentDbRecord> {
  const [row] = await db
    .update(visionAgentDbRecordsTable)
    .set({ data, updatedAt: new Date() })
    .where(eq(visionAgentDbRecordsTable.id, id))
    .returning();
  if (!row) throw new Error("Record not found");
  return row;
}

export async function deleteRecord(id: number): Promise<void> {
  await db
    .delete(visionAgentDbRecordsTable)
    .where(eq(visionAgentDbRecordsTable.id, id));
}
