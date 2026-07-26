/**
 * WhatsApp expansion routes:
 *  - BYON: WhatsApp-enable an existing voice DID. Verification OTPs (from
 *    Meta Business Manager or the VoBiz BYON verify API) arrive as calls to
 *    the DID — which routes to OUR answer webhook — so the platform answers
 *    armed calls with <Record> + transcription, extracts the spoken code, and
 *    surfaces it in the dashboard (the owner can't answer their own virtual
 *    number). VoBiz-side verifications are auto-confirmed when possible.
 *  - Template manager: per-channel Meta template list/create/sync via VoBiz
 *    (own tier; shared tier sees the read-only platform catalog).
 *  - Brochure assets: upload → Postgres bytea → unguessable public URL that
 *    Meta fetches at send time (Railway prod has no object storage).
 */

import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import {
  db,
  phoneNumbersTable,
  whatsappAssetsTable,
  whatsappByonVerificationsTable,
  whatsappChannelsTable,
  type WhatsappByonVerification,
  type WhatsappChannel,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { logger } from "../lib/logger.js";
import {
  getTemplateCatalog,
  getOwnCredsForUser,
  getStrictSubAccountCredsForUser,
  sanitizeVobizError,
  toPlusE164,
  vobizApiCall,
} from "../services/whatsapp/vobiz.js";

const router: IRouter = Router();

const ARM_WINDOW_MS = 15 * 60_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ── shared helpers ───────────────────────────────────────────────────────── */

function verificationPublic(row: WhatsappByonVerification) {
  const armed = row.armedUntil.getTime() > Date.now()
    && (row.status === "armed" || row.status === "code_captured");
  return {
    id: row.id,
    phoneNumberId: row.phoneNumberId,
    phoneE164: row.phoneE164,
    status: row.status,
    method: row.method,
    otpCode: row.otpCode,
    hasRecording: !!row.recordingUrl,
    transcript: row.transcript ? row.transcript.slice(0, 300) : null,
    vobizRequested: !!row.vobizVerificationId,
    armed,
    armedUntil: row.armedUntil.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadOwnedVoiceNumber(userId: string, phoneNumberId: number) {
  if (!Number.isFinite(phoneNumberId)) return null;
  const [pn] = await db.select({
    id: phoneNumbersTable.id,
    number: phoneNumbersTable.number,
  })
    .from(phoneNumbersTable)
    .where(and(
      eq(phoneNumbersTable.id, phoneNumberId),
      eq(phoneNumbersTable.userId, userId),
      ne(phoneNumbersTable.service, "whatsapp"),
      eq(phoneNumbersTable.status, "active"),
    ))
    .limit(1);
  return pn ?? null;
}

async function latestVerification(userId: string, phoneE164?: string): Promise<WhatsappByonVerification | null> {
  const where = phoneE164
    ? and(eq(whatsappByonVerificationsTable.userId, userId), eq(whatsappByonVerificationsTable.phoneE164, phoneE164))
    : eq(whatsappByonVerificationsTable.userId, userId);
  const [row] = await db.select().from(whatsappByonVerificationsTable)
    .where(where)
    .orderBy(desc(whatsappByonVerificationsTable.createdAt))
    .limit(1);
  return row ?? null;
}

async function getUserChannel(userId: string): Promise<WhatsappChannel | null> {
  const [row] = await db.select().from(whatsappChannelsTable)
    .where(and(eq(whatsappChannelsTable.userId, userId), eq(whatsappChannelsTable.active, true)))
    .limit(1);
  return row ?? null;
}

/** Arm (or re-arm) the OTP capture window for a number, clearing stale capture state. */
async function armCapture(
  userId: string,
  phoneNumberId: number,
  phoneE164: string,
  extra?: Partial<{ method: string; vobizVerificationId: string | null }>,
): Promise<WhatsappByonVerification> {
  const existing = await latestVerification(userId, phoneE164);
  const armedUntil = new Date(Date.now() + ARM_WINDOW_MS);
  if (existing && existing.status !== "confirmed") {
    const [row] = await db.update(whatsappByonVerificationsTable)
      .set({
        status: "armed",
        armedUntil,
        phoneNumberId,
        otpCode: null,
        transcript: null,
        recordingUrl: null,
        ...(extra?.method ? { method: extra.method } : {}),
        ...(extra && "vobizVerificationId" in extra ? { vobizVerificationId: extra.vobizVerificationId ?? null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(whatsappByonVerificationsTable.id, existing.id))
      .returning();
    return row!;
  }
  const [row] = await db.insert(whatsappByonVerificationsTable).values({
    userId,
    phoneNumberId,
    phoneE164,
    status: "armed",
    method: extra?.method ?? "voice",
    vobizVerificationId: extra?.vobizVerificationId ?? null,
    armedUntil,
  }).returning();
  return row!;
}

/* ── BYON: voice-number → WhatsApp enablement ─────────────────────────────── */

/** Voice DIDs eligible for WhatsApp enablement. */
router.get("/whatsapp/byon/numbers", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const rows = await db.select({
    id: phoneNumbersTable.id,
    number: phoneNumbersTable.number,
  })
    .from(phoneNumbersTable)
    .where(and(
      eq(phoneNumbersTable.userId, userId),
      ne(phoneNumbersTable.service, "whatsapp"),
      eq(phoneNumbersTable.status, "active"),
    ));
  res.json({ numbers: rows.map((r) => ({ id: r.id, number: toPlusE164(r.number) })) });
});

/** Arm OTP capture (used while adding the number to a WABA in Meta Business Manager). */
router.post("/whatsapp/byon/arm", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const pn = await loadOwnedVoiceNumber(userId, Number((req.body as any)?.phoneNumberId));
  if (!pn) {
    res.status(404).json({ error: "Voice number not found" });
    return;
  }
  const row = await armCapture(userId, pn.id, toPlusE164(pn.number));
  logger.info({ userId, phone: row.phoneE164 }, "whatsapp-byon: capture armed");
  res.json({ verification: verificationPublic(row) });
});

/** Request a VoBiz BYON verification OTP (we auto-capture + auto-confirm it). */
router.post("/whatsapp/byon/vobiz-verify", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const body = (req.body ?? {}) as { phoneNumberId?: number; method?: string };
  const pn = await loadOwnedVoiceNumber(userId, Number(body.phoneNumberId));
  if (!pn) {
    res.status(404).json({ error: "Voice number not found" });
    return;
  }
  const method = body.method === "sms" ? "sms" : "voice";
  const creds = await getStrictSubAccountCredsForUser(userId);
  if (!creds) {
    res.status(503).json({ error: "Could not prepare your VoBiz sub-account — please try again shortly" });
    return;
  }
  const phoneE164 = toPlusE164(pn.number);
  // Arm BEFORE the carrier call so the OTP call can't race past an un-armed webhook.
  let row = await armCapture(userId, pn.id, phoneE164, { method });
  const r = await vobizApiCall(creds, "POST", "/messaging/numbers/whatsapp/bring-your-own/verify", {
    phone_number: phoneE164,
    verification_method: method,
  });
  if (!r.ok) {
    const error = sanitizeVobizError(r.rawText || `HTTP ${r.status}`);
    logger.warn({ userId, phone: phoneE164, status: r.status }, "whatsapp-byon: vobiz verify failed");
    res.status(502).json({ error: `VoBiz verification request failed: ${error}`, verification: verificationPublic(row) });
    return;
  }
  const verificationId = r.json?.["id"] != null ? String(r.json["id"]) : null;
  if (verificationId) {
    const [updated] = await db.update(whatsappByonVerificationsTable)
      .set({ vobizVerificationId: verificationId, updatedAt: new Date() })
      .where(eq(whatsappByonVerificationsTable.id, row.id))
      .returning();
    row = updated ?? row;
  }
  logger.info({ userId, phone: phoneE164, method }, "whatsapp-byon: vobiz verify requested");
  res.json({ verification: verificationPublic(row) });
});

/** Confirm the VoBiz BYON verification (auto-captured code by default). */
router.post("/whatsapp/byon/vobiz-confirm", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const body = (req.body ?? {}) as { phoneNumberId?: number; otpCode?: string };
  const pn = await loadOwnedVoiceNumber(userId, Number(body.phoneNumberId));
  if (!pn) {
    res.status(404).json({ error: "Voice number not found" });
    return;
  }
  const phoneE164 = toPlusE164(pn.number);
  const row = await latestVerification(userId, phoneE164);
  const code = (body.otpCode ?? "").trim() || row?.otpCode || "";
  if (!/^\d{4,8}$/.test(code)) {
    res.status(400).json({ error: "No verification code yet — wait for the capture, or type the code manually" });
    return;
  }
  const creds = await getStrictSubAccountCredsForUser(userId);
  if (!creds) {
    res.status(503).json({ error: "Could not prepare your VoBiz sub-account — please try again shortly" });
    return;
  }
  const r = await vobizApiCall(creds, "POST", "/messaging/numbers/whatsapp/bring-your-own/confirm", {
    phone_number: phoneE164,
    otp_code: code,
  });
  if (!r.ok) {
    res.status(502).json({ error: `VoBiz could not confirm the code: ${sanitizeVobizError(r.rawText || `HTTP ${r.status}`)}` });
    return;
  }
  let updated = row;
  if (row) {
    const [u] = await db.update(whatsappByonVerificationsTable)
      .set({ status: "confirmed", otpCode: code, updatedAt: new Date() })
      .where(eq(whatsappByonVerificationsTable.id, row.id))
      .returning();
    updated = u ?? row;
  }
  logger.info({ userId, phone: phoneE164 }, "whatsapp-byon: vobiz verification confirmed");
  res.json({ ok: true, verification: updated ? verificationPublic(updated) : null });
});

/** Poll the capture/verification state. */
router.get("/whatsapp/byon/state", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const pnIdRaw = req.query["phoneNumberId"];
  let phoneE164: string | undefined;
  if (pnIdRaw != null && String(pnIdRaw) !== "") {
    const pn = await loadOwnedVoiceNumber(userId, Number(pnIdRaw));
    if (!pn) {
      res.status(404).json({ error: "Voice number not found" });
      return;
    }
    phoneE164 = toPlusE164(pn.number);
  }
  const row = await latestVerification(userId, phoneE164);
  res.json({ verification: row ? verificationPublic(row) : null });
});

/** Play back the captured verification call (fallback when transcription misses). */
/* ── SSRF guard for carrier recording URLs ─────────────────────────────────
 * The recording callback is public (capability = unguessable vid) and the
 * recording proxy fetches the stored URL server-side, so a tampered URL would
 * be an SSRF primitive (internal metadata/services). Only accept https URLs
 * on known carrier media hosts, and re-validate every redirect hop.
 */
const MEDIA_HOST_SUFFIXES = (process.env["VOBIZ_MEDIA_HOSTS"] ?? ".vobiz.com,.vobiz.in,.plivo.com,.amazonaws.com")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

function isAllowedMediaUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  // No IP literals (v4 or bracketed v6), no localhost.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host === "localhost") return false;
  return MEDIA_HOST_SUFFIXES.some((suf) =>
    suf.startsWith(".") ? host.endsWith(suf) || host === suf.slice(1) : host === suf);
}

/** Fetch a carrier media URL, re-validating every redirect hop (SSRF guard). */
async function fetchMediaValidated(rawUrl: string): Promise<Response | null> {
  let url = rawUrl;
  for (let hop = 0; hop < 4; hop++) {
    if (!isAllowedMediaUrl(url)) return null;
    const resp = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get("location");
      if (!loc) return resp;
      url = new URL(loc, url).toString();
      continue;
    }
    return resp;
  }
  return null;
}

router.get("/whatsapp/byon/recording", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const pnIdRaw = req.query["phoneNumberId"];
  let phoneE164: string | undefined;
  if (pnIdRaw != null && String(pnIdRaw) !== "") {
    const pn = await loadOwnedVoiceNumber(userId, Number(pnIdRaw));
    if (!pn) {
      res.status(404).json({ error: "Voice number not found" });
      return;
    }
    phoneE164 = toPlusE164(pn.number);
  }
  const row = await latestVerification(userId, phoneE164);
  const url = row?.recordingUrl ?? "";
  if (!/^https?:\/\//i.test(url)) {
    res.status(404).json({ error: "No verification recording yet" });
    return;
  }
  try {
    const resp = await fetchMediaValidated(url);
    if (!resp) {
      res.status(502).json({ error: "Recording URL is not on a trusted carrier host" });
      return;
    }
    if (!resp.ok) {
      res.status(502).json({ error: `Recording fetch failed (HTTP ${resp.status})` });
      return;
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > 15 * 1024 * 1024) {
      res.status(502).json({ error: "Recording too large" });
      return;
    }
    res.set("Content-Type", resp.headers.get("content-type") ?? "audio/mpeg");
    res.set("Cache-Control", "private, max-age=300");
    res.send(buf);
  } catch (err) {
    logger.warn({ err }, "whatsapp-byon: recording proxy failed");
    res.status(502).json({ error: "Could not fetch the recording" });
  }
});

/* ── OTP capture webhook callbacks (from the <Record> verb) ───────────────── */

/** Extract a 6-digit verification code from a robocall transcript. */
export function extractOtpCode(raw: string): string | null {
  if (!raw) return null;
  // Pass 1: numeric digits, possibly separated ("1 2 3 - 4 5 6").
  const groups = raw.replace(/[^0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  for (const g of groups) if (g.length === 6) return g;
  for (let i = 0; i < groups.length; i++) {
    let acc = "";
    for (let j = i; j < groups.length && acc.length < 6; j++) acc += groups[j];
    if (acc.length >= 6) return acc.slice(0, 6);
  }
  // Pass 2: spelled-out digits ("one two three four five six").
  const words: Record<string, string> = {
    zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4",
    five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  };
  const mapped = raw.toLowerCase().split(/[^a-z0-9]+/)
    .map((w) => words[w] ?? (/^\d+$/.test(w) ? w : " "))
    .join("");
  const m = mapped.match(/\d{6}/);
  return m ? m[0] : null;
}

router.post("/webhooks/vobiz/wa-otp-recording", async (req, res): Promise<void> => {
  res.status(200).json({ ok: true }); // ack fast; VoBiz retries otherwise
  const vid = String(req.query["vid"] ?? "");
  if (!UUID_RE.test(vid)) return;
  const b = (req.body ?? {}) as Record<string, any>;
  const url = String(b["RecordUrl"] ?? b["RecordingUrl"] ?? b["recording_url"] ?? b["record_url"] ?? "").trim();
  try {
    const safeUrl = url && isAllowedMediaUrl(url) ? url : "";
    if (url && !safeUrl) {
      logger.warn({ vid }, "whatsapp-byon: recording callback URL rejected (host not allowlisted)");
    }
    // Status guard: only rows with a capture in flight — never touch confirmed rows.
    await db.update(whatsappByonVerificationsTable)
      .set({ ...(safeUrl ? { recordingUrl: safeUrl } : {}), updatedAt: new Date() })
      .where(and(
        eq(whatsappByonVerificationsTable.id, vid),
        inArray(whatsappByonVerificationsTable.status, ["armed", "code_captured"]),
      ));
    logger.info({ vid, hasUrl: !!safeUrl }, "whatsapp-byon: recording callback stored");
  } catch (err) {
    logger.warn({ err, vid }, "whatsapp-byon: recording callback failed");
  }
});

router.post("/webhooks/vobiz/wa-otp-transcription", async (req, res): Promise<void> => {
  res.status(200).json({ ok: true }); // ack fast
  const vid = String(req.query["vid"] ?? "");
  if (!UUID_RE.test(vid)) return;
  const b = (req.body ?? {}) as Record<string, any>;
  const transcript = String(b["transcription"] ?? b["transcription_text"] ?? b["transcript"] ?? b["text"] ?? "").trim();
  if (!transcript) return;
  const code = extractOtpCode(transcript);
  try {
    const [row] = await db.update(whatsappByonVerificationsTable)
      .set({
        transcript: transcript.slice(0, 2000),
        ...(code ? { otpCode: code, status: "code_captured" } : {}),
        updatedAt: new Date(),
      })
      // Status guard: a confirmed verification must never be downgraded by a late
      // or forged callback.
      .where(and(
        eq(whatsappByonVerificationsTable.id, vid),
        inArray(whatsappByonVerificationsTable.status, ["armed", "code_captured"]),
      ))
      .returning();
    logger.info({ vid, gotCode: !!code }, "whatsapp-byon: transcription callback stored");
    // If WE requested the VoBiz verification, close the loop automatically.
    if (row && code && row.vobizVerificationId && row.status !== "confirmed") {
      setImmediate(() => {
        void autoConfirmVobiz(row).catch((err) =>
          logger.warn({ err, vid }, "whatsapp-byon: auto-confirm crashed"));
      });
    }
  } catch (err) {
    logger.warn({ err, vid }, "whatsapp-byon: transcription callback failed");
  }
});

async function autoConfirmVobiz(row: WhatsappByonVerification): Promise<void> {
  if (!row.otpCode) return;
  const creds = await getStrictSubAccountCredsForUser(row.userId);
  if (!creds) return;
  const r = await vobizApiCall(creds, "POST", "/messaging/numbers/whatsapp/bring-your-own/confirm", {
    phone_number: row.phoneE164,
    otp_code: row.otpCode,
  });
  if (r.ok) {
    await db.update(whatsappByonVerificationsTable)
      .set({ status: "confirmed", updatedAt: new Date() })
      .where(eq(whatsappByonVerificationsTable.id, row.id));
    logger.info({ vid: row.id }, "whatsapp-byon: auto-confirmed with VoBiz");
  } else {
    // Probably a Meta Business Manager code (user types it there) — leave captured.
    logger.info({ vid: row.id, status: r.status }, "whatsapp-byon: auto-confirm rejected — code left for manual use");
  }
}

/* ── Template manager (own channels; shared = platform catalog) ───────────── */

const TEMPLATE_CATEGORIES = new Set(["UTILITY", "MARKETING", "AUTHENTICATION"]);

function parseTemplateList(json: Record<string, any> | null): Array<Record<string, any>> {
  if (!json) return [];
  const list = json["templates"] ?? json["data"] ?? json["items"] ?? json["results"] ?? json;
  if (!Array.isArray(list)) return [];
  return list.map((t: Record<string, any>) => ({
    id: t["id"] != null ? String(t["id"]) : null,
    name: t["name"] != null ? String(t["name"]) : null,
    category: t["category"] != null ? String(t["category"]) : null,
    language: typeof t["language"] === "object" && t["language"]
      ? String(t["language"]["code"] ?? "") : (t["language"] != null ? String(t["language"]) : null),
    status: t["status"] != null ? String(t["status"]) : "unknown",
    components: Array.isArray(t["components"]) ? t["components"] : undefined,
  }));
}

router.get("/whatsapp/templates", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const channel = await getUserChannel(userId);
  if (!channel) {
    res.status(404).json({ error: "No WhatsApp channel enrolled" });
    return;
  }
  if (channel.mode !== "own") {
    const catalog = await getTemplateCatalog();
    res.json({
      mode: "shared",
      templates: Object.entries(catalog).map(([hint, t]) => ({
        id: null, name: t.name, category: "UTILITY", language: t.lang,
        status: "platform_managed", hint,
      })),
    });
    return;
  }
  if (!channel.vobizChannelId) {
    res.status(400).json({ error: "Channel is not fully connected yet (missing VoBiz channel id)" });
    return;
  }
  const creds = await getOwnCredsForUser(userId);
  if (!creds) {
    res.status(503).json({ error: "VoBiz credentials unavailable" });
    return;
  }
  const r = await vobizApiCall(creds, "GET", `/messaging/channels/${encodeURIComponent(channel.vobizChannelId)}/templates`);
  if (!r.ok) {
    res.status(502).json({ error: `Could not list templates: ${sanitizeVobizError(r.rawText || `HTTP ${r.status}`)}` });
    return;
  }
  res.json({ mode: "own", templates: parseTemplateList(r.json) });
});

router.post("/whatsapp/templates", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const body = (req.body ?? {}) as {
    name?: string; category?: string; language?: string;
    headerText?: string; bodyText?: string; footerText?: string;
  };
  const channel = await getUserChannel(userId);
  if (!channel) {
    res.status(404).json({ error: "No WhatsApp channel enrolled" });
    return;
  }
  if (channel.mode !== "own" || !channel.vobizChannelId) {
    res.status(400).json({ error: "Templates on the shared SnapServe number are managed by the platform. Connect your own number to create templates." });
    return;
  }

  const name = (body.name ?? "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120);
  if (!name) {
    res.status(400).json({ error: "Template name is required (lowercase letters, numbers, underscores)" });
    return;
  }
  const category = (body.category ?? "UTILITY").toUpperCase();
  if (!TEMPLATE_CATEGORIES.has(category)) {
    res.status(400).json({ error: "category must be UTILITY, MARKETING or AUTHENTICATION" });
    return;
  }
  const language = (body.language ?? "en").trim();
  if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(language)) {
    res.status(400).json({ error: "language must look like en or en_US" });
    return;
  }
  const bodyText = (body.bodyText ?? "").trim();
  if (!bodyText || bodyText.length > 1024) {
    res.status(400).json({ error: "bodyText is required (max 1024 characters)" });
    return;
  }
  const headerText = (body.headerText ?? "").trim();
  const footerText = (body.footerText ?? "").trim();
  if (headerText.length > 60 || footerText.length > 60) {
    res.status(400).json({ error: "Header and footer are limited to 60 characters" });
    return;
  }

  const components: Array<Record<string, unknown>> = [];
  if (headerText) components.push({ type: "HEADER", format: "TEXT", text: headerText });
  components.push({ type: "BODY", text: bodyText });
  if (footerText) components.push({ type: "FOOTER", text: footerText });

  const creds = await getOwnCredsForUser(userId);
  if (!creds) {
    res.status(503).json({ error: "VoBiz credentials unavailable" });
    return;
  }
  const r = await vobizApiCall(creds, "POST",
    `/messaging/channels/${encodeURIComponent(channel.vobizChannelId)}/templates`,
    { name, category, language, components });
  if (!r.ok) {
    res.status(502).json({ error: `Template submission failed: ${sanitizeVobizError(r.rawText || `HTTP ${r.status}`)}` });
    return;
  }
  logger.info({ userId, name, category }, "whatsapp: template submitted for approval");
  res.status(201).json({ ok: true, template: { name, category, language, status: String(r.json?.["status"] ?? "PENDING") } });
});

router.post("/whatsapp/templates/sync", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const channel = await getUserChannel(userId);
  if (!channel || channel.mode !== "own" || !channel.vobizChannelId) {
    res.status(400).json({ error: "Template sync needs a connected own-number channel" });
    return;
  }
  const creds = await getOwnCredsForUser(userId);
  if (!creds) {
    res.status(503).json({ error: "VoBiz credentials unavailable" });
    return;
  }
  const r = await vobizApiCall(creds, "POST",
    `/messaging/channels/${encodeURIComponent(channel.vobizChannelId)}/templates/sync`);
  if (!r.ok) {
    res.status(502).json({ error: `Sync failed: ${sanitizeVobizError(r.rawText || `HTTP ${r.status}`)}` });
    return;
  }
  res.json({ ok: true });
});

/* ── Brochure assets ──────────────────────────────────────────────────────── */

const ASSET_MIMES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const ASSET_MAX_BYTES = 8 * 1024 * 1024;
const ASSET_MAX_COUNT = 5;

function assetPublic(a: { id: string; filename: string; mime: string; sizeBytes: number; publicToken: string; createdAt: Date }) {
  return {
    id: a.id,
    filename: a.filename,
    mime: a.mime,
    sizeBytes: a.sizeBytes,
    url: `/api/public/wa-assets/${a.publicToken}/${encodeURIComponent(a.filename)}`,
    createdAt: a.createdAt.toISOString(),
  };
}

router.get("/whatsapp/assets", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const rows = await db.select({
    id: whatsappAssetsTable.id,
    filename: whatsappAssetsTable.filename,
    mime: whatsappAssetsTable.mime,
    sizeBytes: whatsappAssetsTable.sizeBytes,
    publicToken: whatsappAssetsTable.publicToken,
    createdAt: whatsappAssetsTable.createdAt,
  })
    .from(whatsappAssetsTable)
    .where(eq(whatsappAssetsTable.userId, userId))
    .orderBy(desc(whatsappAssetsTable.createdAt));
  res.json({ assets: rows.map(assetPublic) });
});

router.post("/whatsapp/assets", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const body = (req.body ?? {}) as { filename?: string; mime?: string; dataBase64?: string };
  const mime = (body.mime ?? "").trim().toLowerCase();
  if (!ASSET_MIMES.has(mime)) {
    res.status(400).json({ error: "Only PDF, JPEG and PNG files are supported" });
    return;
  }
  const rawB64 = (body.dataBase64 ?? "").replace(/^data:[^;]+;base64,/, "");
  let data: Buffer;
  try {
    data = Buffer.from(rawB64, "base64");
  } catch {
    res.status(400).json({ error: "Invalid file data" });
    return;
  }
  if (data.length < 100 || data.length > ASSET_MAX_BYTES) {
    res.status(400).json({ error: `File must be between 100 bytes and ${ASSET_MAX_BYTES / (1024 * 1024)}MB` });
    return;
  }
  const existing = await db.select({ id: whatsappAssetsTable.id })
    .from(whatsappAssetsTable)
    .where(eq(whatsappAssetsTable.userId, userId));
  if (existing.length >= ASSET_MAX_COUNT) {
    res.status(400).json({ error: `Limit of ${ASSET_MAX_COUNT} files reached — delete one first` });
    return;
  }
  const cleaned = (body.filename ?? "").replace(/^.*[\\/]/, "").replace(/[^\w .()-]+/g, "").trim().slice(0, 80);
  const fallbackExt = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg";
  const filename = cleaned || `brochure.${fallbackExt}`;
  const publicToken = randomBytes(18).toString("hex");
  const [row] = await db.insert(whatsappAssetsTable).values({
    userId,
    kind: "brochure",
    filename,
    mime,
    sizeBytes: data.length,
    data,
    publicToken,
  }).returning({
    id: whatsappAssetsTable.id,
    filename: whatsappAssetsTable.filename,
    mime: whatsappAssetsTable.mime,
    sizeBytes: whatsappAssetsTable.sizeBytes,
    publicToken: whatsappAssetsTable.publicToken,
    createdAt: whatsappAssetsTable.createdAt,
  });
  logger.info({ userId, filename, sizeBytes: data.length }, "whatsapp: asset uploaded");
  res.status(201).json({ asset: assetPublic(row!) });
});

router.delete("/whatsapp/assets/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = (req as any).clerkUserId as string;
  const id = String((req.params as any).id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid asset id" });
    return;
  }
  const deleted = await db.delete(whatsappAssetsTable)
    .where(and(eq(whatsappAssetsTable.id, id), eq(whatsappAssetsTable.userId, userId)))
    .returning({ id: whatsappAssetsTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "Asset not found" });
    return;
  }
  // Unhook any channel pointing at the deleted brochure.
  await db.update(whatsappChannelsTable)
    .set({ brochureAssetId: null, updatedAt: new Date() })
    .where(and(eq(whatsappChannelsTable.userId, userId), eq(whatsappChannelsTable.brochureAssetId, id)))
    .catch(() => {});
  res.sendStatus(204);
});

/** Public: Meta fetches media from this URL at send time. Unguessable token = capability. */
router.get("/public/wa-assets/:token{/:filename}", async (req, res): Promise<void> => {
  const token = String((req.params as any).token ?? "");
  if (!/^[0-9a-f]{24,64}$/i.test(token)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [row] = await db.select().from(whatsappAssetsTable)
    .where(eq(whatsappAssetsTable.publicToken, token))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.set("Content-Type", row.mime);
  res.set("Content-Disposition", `inline; filename="${row.filename.replace(/[^\w .()-]+/g, "")}"`);
  res.set("Cache-Control", "public, max-age=3600");
  res.send(row.data);
});

export default router;
