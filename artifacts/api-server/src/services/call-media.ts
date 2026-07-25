import { eq, and, desc, isNull, lt, sql } from "drizzle-orm";
import { db, callMediaTable } from "@workspace/db";
import type { CallMedia } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { createHash } from "node:crypto";

export type { CallMedia };

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

export function isAllowedImageMime(mime: string): boolean {
  return ALLOWED_MIME_TYPES.has(mime.toLowerCase());
}

export interface StoreCallMediaParams {
  callId?: number | null;
  agentId?: number | null;
  userId?: string | null;
  phone?: string | null;
  source: string;
  mimeType: string;
  fileName?: string | null;
  buffer?: Buffer | null;
  urlRef?: string | null;
  retentionDays?: number | null;
}

export async function storeCallMedia(params: StoreCallMediaParams): Promise<CallMedia> {
  const {
    callId = null,
    agentId = null,
    userId = null,
    phone = null,
    source,
    mimeType,
    fileName = null,
    buffer = null,
    urlRef = null,
    retentionDays = null,
  } = params;

  const byteSize = buffer?.length ?? 0;

  const [row] = await db
    .insert(callMediaTable)
    .values({
      callId,
      agentId,
      userId,
      phone,
      source,
      mimeType,
      fileName,
      byteSize,
      imageData: buffer ?? null,
      urlRef,
      retentionDays,
      analysisCache: {},
    })
    .returning();

  if (!row) throw new Error("Failed to insert call_media row");
  return row;
}

export async function getCallMediaById(id: number): Promise<CallMedia | null> {
  const [row] = await db
    .select()
    .from(callMediaTable)
    .where(eq(callMediaTable.id, id))
    .limit(1);
  return row ?? null;
}

export async function listRecentCallMedia(
  agentId: number,
  phone: string | null,
  limit: number,
): Promise<CallMedia[]> {
  const conditions = [eq(callMediaTable.agentId, agentId)];
  if (phone) {
    conditions.push(eq(callMediaTable.phone, phone));
  }
  return db
    .select()
    .from(callMediaTable)
    .where(and(...conditions))
    .orderBy(desc(callMediaTable.createdAt))
    .limit(limit);
}

export async function attachPendingMediaToCall(
  callId: number,
  agentId: number,
  phone: string,
): Promise<CallMedia[]> {
  // Find staged (api_staged) media for this agent+phone that haven't been assigned to a call
  const rows = await db
    .select()
    .from(callMediaTable)
    .where(
      and(
        eq(callMediaTable.agentId, agentId),
        eq(callMediaTable.phone, phone),
        eq(callMediaTable.source, "api_staged"),
        isNull(callMediaTable.callId),
      ),
    )
    .orderBy(callMediaTable.createdAt);

  if (rows.length === 0) return [];

  // Attach them to the call
  const ids = rows.map((r) => r.id);
  await db
    .update(callMediaTable)
    .set({ callId })
    .where(
      and(
        eq(callMediaTable.agentId, agentId),
        sql`${callMediaTable.id} = ANY(${ids})`,
      ),
    );

  return rows;
}

export async function fetchImageFromUrl(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fetchImageFromUrl: HTTP ${response.status} fetching ${url}`);
  }
  const contentType = response.headers.get("content-type") ?? "image/jpeg";
  const mimeType = contentType.split(";")[0]?.trim() ?? "image/jpeg";
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, mimeType };
}

export async function getCachedAnalysis(
  mediaId: number,
  cacheKey: string,
): Promise<string | null> {
  const [row] = await db
    .select({ analysisCache: callMediaTable.analysisCache })
    .from(callMediaTable)
    .where(eq(callMediaTable.id, mediaId))
    .limit(1);
  if (!row) return null;
  const cache = (row.analysisCache ?? {}) as Record<string, string>;
  return cache[cacheKey] ?? null;
}

export async function setCachedAnalysis(
  mediaId: number,
  cacheKey: string,
  result: string,
): Promise<void> {
  // Merge into existing cache JSON
  await db
    .update(callMediaTable)
    .set({
      analysisCache: sql`COALESCE(${callMediaTable.analysisCache}, '{}') || ${JSON.stringify({ [cacheKey]: result })}::jsonb`,
    })
    .where(eq(callMediaTable.id, mediaId));
}

export function buildAnalysisCacheKey(provider: string, prompt: string): string {
  return createHash("sha256").update(`${provider}:${prompt}`).digest("hex");
}

export async function deleteExpiredMedia(): Promise<number> {
  const now = new Date();
  // Delete rows where created_at + retention_days days < now
  const result = await db
    .delete(callMediaTable)
    .where(
      and(
        sql`${callMediaTable.retentionDays} IS NOT NULL`,
        sql`${callMediaTable.createdAt} + (${callMediaTable.retentionDays} || ' days')::interval < ${now.toISOString()}`,
      ),
    );
  const deleted = (result as unknown as { rowCount?: number }).rowCount ?? 0;
  if (deleted > 0) {
    logger.info({ deleted }, "Deleted expired call_media rows");
  }
  return deleted;
}
