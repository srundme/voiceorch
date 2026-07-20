/**
 * Call media store — still images for agent vision (WhatsApp / upload / URL).
 */
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { callMediaTable, type CallMedia } from "@workspace/db/schema";
import { logger } from "../lib/logger.js";
import { normalizePhoneDigits } from "./google-sheets-helpers.js";

export type CallMediaSource = "whatsapp" | "upload" | "webcall" | "url";

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

export function isAllowedImageMime(mime: string): boolean {
  const m = mime.toLowerCase().split(";")[0]!.trim();
  return ALLOWED_MIME.has(m) || m === "image/jpg";
}

export function normalizeImageMime(mime: string): string {
  const m = mime.toLowerCase().split(";")[0]!.trim();
  if (m === "image/jpg") return "image/jpeg";
  return m;
}

export async function storeCallMedia(opts: {
  callId?: number | null;
  agentId?: number | null;
  userId?: string | null;
  phone?: string | null;
  source: CallMediaSource;
  mimeType: string;
  fileName?: string | null;
  buffer: Buffer;
}): Promise<CallMedia> {
  if (!isAllowedImageMime(opts.mimeType)) {
    throw new Error(`Unsupported image type: ${opts.mimeType}`);
  }
  if (opts.buffer.length === 0) throw new Error("Empty image");
  if (opts.buffer.length > MAX_BYTES) {
    throw new Error(`Image too large (max ${MAX_BYTES} bytes)`);
  }

  const mimeType = normalizeImageMime(opts.mimeType);
  const phone = opts.phone ? normalizePhoneDigits(opts.phone.replace(/\D/g, "")) || opts.phone : null;

  const [row] = await db.insert(callMediaTable).values({
    callId: opts.callId ?? null,
    agentId: opts.agentId ?? null,
    userId: opts.userId ?? null,
    phone,
    source: opts.source,
    mimeType,
    fileName: opts.fileName ?? null,
    byteSize: opts.buffer.length,
    imageData: opts.buffer,
  }).returning();

  if (!row) throw new Error("Failed to store call media");
  logger.info(
    { mediaId: row.id, callId: row.callId, agentId: row.agentId, source: row.source, bytes: row.byteSize },
    "call_media stored",
  );
  return row;
}

export async function getCallMediaById(id: number): Promise<CallMedia | null> {
  const [row] = await db.select().from(callMediaTable).where(eq(callMediaTable.id, id)).limit(1);
  return row ?? null;
}

export async function listCallMediaForCall(callId: number, limit = 20): Promise<CallMedia[]> {
  return db
    .select()
    .from(callMediaTable)
    .where(eq(callMediaTable.callId, callId))
    .orderBy(desc(callMediaTable.createdAt))
    .limit(limit);
}

/** Pending images for this agent+phone not yet attached to a call. */
export async function listPendingMediaForPhone(
  agentId: number,
  phone: string,
  limit = 10,
): Promise<CallMedia[]> {
  const digits = normalizePhoneDigits(phone.replace(/\D/g, ""));
  if (!digits) return [];
  return db
    .select()
    .from(callMediaTable)
    .where(and(
      eq(callMediaTable.agentId, agentId),
      isNull(callMediaTable.callId),
      or(
        eq(callMediaTable.phone, digits),
        eq(callMediaTable.phone, phone),
        sql`regexp_replace(coalesce(${callMediaTable.phone}, ''), '[^0-9]', '', 'g') = ${digits}`,
      ),
    ))
    .orderBy(desc(callMediaTable.createdAt))
    .limit(limit);
}

export async function attachPendingMediaToCall(
  callId: number,
  agentId: number,
  phone: string,
): Promise<CallMedia[]> {
  const pending = await listPendingMediaForPhone(agentId, phone);
  if (!pending.length) return [];
  const ids = pending.map((p) => p.id);
  await db
    .update(callMediaTable)
    .set({ callId })
    .where(inArray(callMediaTable.id, ids));
  return listCallMediaForCall(callId);
}

export async function cacheMediaAnalysis(mediaId: number, analysisText: string): Promise<void> {
  await db
    .update(callMediaTable)
    .set({ analysisText: analysisText.slice(0, 20_000) })
    .where(eq(callMediaTable.id, mediaId));
}

export async function fetchImageFromUrl(url: string): Promise<{ buffer: Buffer; mimeType: string; fileName?: string }> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!resp.ok) throw new Error(`Failed to download image (${resp.status})`);
  const mimeType = resp.headers.get("content-type") ?? "image/jpeg";
  if (!isAllowedImageMime(mimeType) && !mimeType.startsWith("image/")) {
    throw new Error(`URL is not an image (${mimeType})`);
  }
  const buffer = Buffer.from(await resp.arrayBuffer());
  const fileName = url.split("/").pop()?.split("?")[0];
  return { buffer, mimeType: normalizeImageMime(mimeType), fileName };
}

export function mediaPublicPath(mediaId: number): string {
  return `/api/storage/call-media/${mediaId}`;
}
