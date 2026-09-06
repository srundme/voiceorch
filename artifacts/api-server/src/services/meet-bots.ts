// ─────────────────────────────────────────────────────────────────────────────
// Google Meet / Zoom / Teams meeting bots via Recall.ai.
//
// Flow:
//   1. Dashboard POSTs { agentId, meetingUrl } → we create a Recall bot whose
//      output_media camera is a webpage WE host (buildMeetBotPageHtml).
//   2. Recall's bot joins the meeting and loads that page in a headless Chromium.
//      Inside the bot, getUserMedia() returns the LIVE MEETING AUDIO (Recall
//      grants mic permission automatically), and whatever the page plays is
//      heard by all participants.
//   3. The page is a headless webcall client: it connects to our existing
//      /api/ws/webcall/<agentId> transport with a signed one-time token
//      (?meetbot=...), streams meeting audio up as 16k PCM16LE and plays the
//      agent's 8k PCM16LE reply — the ENTIRE voice pipeline is reused untouched.
//
// Region: Recall accounts are region-scoped. RECALL_REGION env (e.g.
// "ap-northeast-1") selects the API host.
// ─────────────────────────────────────────────────────────────────────────────
import { createHmac, timingSafeEqual } from "node:crypto";

const RECALL_REGIONS = ["ap-northeast-1", "us-west-2", "us-east-1", "eu-central-1"];
const RECALL_REGION = () => process.env["RECALL_REGION"] || "us-west-2";
const RECALL_FETCH_TIMEOUT_MS = 15_000;
const RECALL_REGION_PROBE_TIMEOUT_MS = 4_000;

function looksLikeHtmlBody(s: string): boolean {
  const t = s.trimStart();
  return /^<!DOCTYPE/i.test(t) || /^<html[\s>]/i.test(t) || /<\/(?:html|body|head)>/i.test(s);
}

/** Strip tracking junk from Google Meet links (`?authuser=0`) so Recall gets a clean room URL. Keep Zoom `pwd`. */
export function normalizeMeetingUrl(raw: string): string {
  const trimmed = raw.trim();
  try {
    const u = new URL(trimmed);
    const host = u.hostname.toLowerCase();
    if (host === "meet.google.com" || host.endsWith(".meet.google.com")) {
      u.search = "";
      u.hash = "";
      return u.toString().replace(/\/$/, "");
    }
    return trimmed;
  } catch {
    return trimmed;
  }
}

export function sanitizeRecallError(raw: string): string {
  if (!raw.trim() || looksLikeHtmlBody(raw)) {
    return "Meeting bot service is temporarily unavailable. Try again in a moment.";
  }
  return raw.replace(/\s+/g, " ").trim().slice(0, 280);
}

/** Prefer Recall JSON `detail`/`error`; never leak Cloudflare HTML to the client. */
export function messageFromRecallBody(status: number, text: string): string {
  if (looksLikeHtmlBody(text)) {
    return "Meeting bot service is temporarily unavailable. Try again in a moment.";
  }
  try {
    const parsed = JSON.parse(text) as { detail?: unknown; message?: unknown; error?: unknown };
    const detail =
      typeof parsed.detail === "string"
        ? parsed.detail
        : typeof parsed.message === "string"
          ? parsed.message
          : typeof parsed.error === "string"
            ? parsed.error
            : null;
    if (detail) return sanitizeRecallError(detail);
  } catch {
    /* not JSON */
  }
  if (status === 401 || status === 403) {
    return "Meeting bot service rejected the API key. Check RECALL_API_KEY and RECALL_REGION.";
  }
  return sanitizeRecallError(`Recall request failed (${status}): ${text}`);
}

function fetchSignal(init: RequestInit | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (init?.signal && typeof AbortSignal.any === "function") {
    return AbortSignal.any([init.signal, timeout]);
  }
  return timeout;
}

export const RECALL_PRIMARY_SETTING_KEY = "recall_api_key";
export const RECALL_FALLBACK_SETTING_KEY = "recall_api_key_fallback";

export function pickRecallKeys(src: {
  envPrimary?: string | null;
  envFallback?: string | null;
  dbPrimary?: string | null;
  dbFallback?: string | null;
}): { primary: string | null; fallback: string | null } {
  const trim = (v?: string | null) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const primary = trim(src.dbPrimary) || trim(src.envPrimary);
  let fallback = trim(src.dbFallback) || trim(src.envFallback);
  if (fallback && fallback === primary) fallback = null;
  return { primary: primary ?? null, fallback };
}

export function shouldFailoverRecall(status: number): boolean {
  return status === 401 || status === 403 || status === 402 || status === 429;
}

let cachedPrimary = "";
let cachedFallback = "";
let usingFallback = false;
let keysCachedUntil = 0;

function envRecallPrimary(): string {
  return (process.env["RECALL_API_KEY"] ?? "").trim();
}
function envRecallFallback(): string {
  return (process.env["RECALL_API_KEY_FALLBACK"] ?? "").trim();
}

async function readPlatformSetting(key: string): Promise<string> {
  const { eq } = await import("drizzle-orm");
  const { db, platformSettingsTable } = await import("@workspace/db");
  const [row] = await db
    .select({ value: platformSettingsTable.value })
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, key))
    .limit(1);
  return (row?.value ?? "").trim();
}

export async function ensureRecallKeysLoaded(): Promise<void> {
  if (Date.now() < keysCachedUntil && (cachedPrimary || cachedFallback)) return;
  const [dbPrimary, dbFallback] = await Promise.all([
    readPlatformSetting(RECALL_PRIMARY_SETTING_KEY).catch(() => ""),
    readPlatformSetting(RECALL_FALLBACK_SETTING_KEY).catch(() => ""),
  ]);
  const picked = pickRecallKeys({
    envPrimary: envRecallPrimary(),
    envFallback: envRecallFallback(),
    dbPrimary,
    dbFallback,
  });
  cachedPrimary = picked.primary ?? "";
  cachedFallback = picked.fallback ?? "";
  keysCachedUntil = Date.now() + 30_000;
  if (usingFallback && !cachedFallback) usingFallback = false;
}

function activateRecallFallback(): boolean {
  if (usingFallback || !cachedFallback) return false;
  usingFallback = true;
  resolvedRegion = null;
  return true;
}

function recallKey(): string {
  const k = usingFallback ? cachedFallback || cachedPrimary : cachedPrimary || cachedFallback;
  if (!k) throw new Error("RECALL_API_KEY is not configured");
  return k;
}

export async function isRecallConfigured(): Promise<boolean> {
  await ensureRecallKeysLoaded();
  return Boolean(cachedPrimary || cachedFallback);
}

/**
 * Realtime + async diarized transcripts (Recall streaming STT + perfect
 * diarization). Default ON when a Recall key is set; set
 * RECALL_DIARIZED_TRANSCRIPT=0 to disable (transcript minutes are billed).
 */
export function isRecallDiarizedTranscriptEnabled(): boolean {
  if (!envRecallPrimary() && !envRecallFallback() && !cachedPrimary && !cachedFallback) return false;
  const v = (process.env["RECALL_DIARIZED_TRANSCRIPT"] ?? "1").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "off" && v !== "no";
}

// Recall API keys are region-scoped and a wrong RECALL_REGION yields a
// confusing 401. Resolve the working region ONCE by probing (configured
// region first), then cache for the process lifetime.
let resolvedRegion: string | null = null;

async function probeRecallRegion(region: string): Promise<string | null> {
  const res = await fetch(`https://${region}.recall.ai/api/v1/bot/?limit=1`, {
    headers: { accept: "application/json", authorization: recallKey() },
    signal: AbortSignal.timeout(RECALL_REGION_PROBE_TIMEOUT_MS),
  });
  return res.ok ? region : null;
}

async function probeAllRecallRegions(): Promise<string | null> {
  const preferred = RECALL_REGION();
  try {
    const hit = await probeRecallRegion(preferred);
    if (hit) return hit;
  } catch {
    /* preferred region unreachable — try the rest in parallel */
  }
  const others = RECALL_REGIONS.filter((r) => r !== preferred);
  return (await Promise.all(others.map((r) => probeRecallRegion(r).catch(() => null)))).find(
    (r): r is string => Boolean(r),
  ) ?? null;
}

/** Resolve working Recall region once (API keys are region-scoped). */
export async function resolveRecallRegion(): Promise<string> {
  await ensureRecallKeysLoaded();
  if (resolvedRegion) return resolvedRegion;
  const found = await probeAllRecallRegions();
  if (found) {
    resolvedRegion = found;
    return found;
  }
  if (activateRecallFallback()) {
    const fallbackFound = await probeAllRecallRegions();
    if (fallbackFound) {
      resolvedRegion = fallbackFound;
      return fallbackFound;
    }
  }
  throw new Error(
    "Recall API key was rejected by every Recall region — verify RECALL_API_KEY (or the fallback key) is the API key from the Recall.ai dashboard (not a webhook secret)",
  );
}

async function resolveRecallBase(): Promise<string> {
  const region = await resolveRecallRegion();
  return `https://${region}.recall.ai/api/v1`;
}

/** Calendar V2 lives under /api/v2 on the same region host. */
export async function resolveRecallV2Base(): Promise<string> {
  const region = await resolveRecallRegion();
  return `https://${region}.recall.ai/api/v2`;
}

async function recallHttp(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: fetchSignal(init, RECALL_FETCH_TIMEOUT_MS),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: recallKey(),
      ...(init?.headers ?? {}),
    },
  });
}

async function recallHttpWithFallback(
  buildUrl: () => Promise<string>,
  init?: RequestInit,
): Promise<Response> {
  await ensureRecallKeysLoaded();
  try {
    let res = await recallHttp(await buildUrl(), init);
    if (!res.ok && shouldFailoverRecall(res.status) && activateRecallFallback()) {
      res = await recallHttp(await buildUrl(), init);
    }
    return res;
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      if (activateRecallFallback()) {
        try {
          return await recallHttp(await buildUrl(), init);
        } catch (retryErr) {
          if (retryErr instanceof Error && (retryErr.name === "AbortError" || retryErr.name === "TimeoutError")) {
            throw new Error("Meeting bot service timed out. Try again.");
          }
          throw retryErr;
        }
      }
      throw new Error("Meeting bot service timed out. Try again.");
    }
    throw err;
  }
}

export async function recallFetchV2(path: string, init?: RequestInit): Promise<Response> {
  const p = path.startsWith("/") ? path : `/${path}`;
  return recallHttpWithFallback(async () => `${await resolveRecallV2Base()}${p}`, init);
}

// ── Signed page/WS token ─────────────────────────────────────────────────────
// The bot page URL (containing this token) is sent to Recall, so the token must
// be self-contained, expiring, and grant access ONLY to one agent on behalf of
// the user who launched the bot. HMAC-SHA256 over SESSION_SECRET.

export interface MeetBotTokenPayload {
  agentId: number;
  userId: string;
  exp: number; // epoch ms
  /**
   * Unique meeting id minted per bot launch. Keys the in-memory speaker roster
   * (services/meet-roster.ts): Recall participant webhooks and the bot page's
   * webcall WS both carry this token, so both sides meet at the same roster.
   * Optional for backward compat with tokens minted before this field existed.
   */
  mid?: string;
  /** Meet/Zoom/Teams URL this bot is joining — used for rejoin tool + prompt context. */
  meetUrl?: string;
  /** Prior phone call to inject summary into the meeting prompt. */
  sourceCallId?: number;
  /** E.164 / dialed party for caller memory during the meeting when passMemory is on. */
  memoryPhone?: string;
  /** Snapshot of meetings.passMemory at launch (default true). */
  passMemory?: boolean;
  /** Snapshot of meetings.passCallContext at launch (default true). */
  passCallContext?: boolean;
  /** Booking attendee email for memory matching when passMemory is on. */
  memoryEmail?: string;
}

function tokenSecret(): string {
  const s = process.env["SESSION_SECRET"];
  if (!s) throw new Error("SESSION_SECRET is not configured");
  return s;
}

const b64u = (buf: Buffer) => buf.toString("base64url");

export function signMeetBotToken(payload: MeetBotTokenPayload): string {
  const body = b64u(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64u(createHmac("sha256", tokenSecret()).update(`mbv1.${body}`).digest());
  return `mbv1.${body}.${sig}`;
}

/**
 * How long a meeting token stays valid, measured from when the bot is due to
 * JOIN — not from when we minted it. Calendar bots are scheduled days ahead, so
 * anchoring to mint time handed the bot a token that was already dead on
 * arrival. The window has to cover a long meeting plus an overrun.
 */
export const MEET_BOT_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

/** Token expiry for a bot joining at `joinAt` (now, when omitted or in the past). */
export function meetBotTokenExp(joinAt?: Date | string | null): number {
  const start = joinAt ? new Date(joinAt).getTime() : Number.NaN;
  const anchor = Number.isFinite(start) ? Math.max(Date.now(), start) : Date.now();
  return anchor + MEET_BOT_TOKEN_TTL_MS;
}

export type MeetBotTokenCheck =
  | { ok: true; payload: MeetBotTokenPayload }
  | { ok: false; reason: "invalid" | "expired" };

/**
 * Verify a meeting token, separating "expired" from "forged/corrupt" so callers
 * can tell the operator which one happened. An expired token during a live
 * meeting is a SnapServe problem; an invalid one is not.
 */
export function checkMeetBotToken(token: string): MeetBotTokenCheck {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "mbv1") return { ok: false, reason: "invalid" };
    const expected = createHmac("sha256", tokenSecret()).update(`mbv1.${parts[1]}`).digest();
    const given = Buffer.from(parts[2]!, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return { ok: false, reason: "invalid" };
    }
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as MeetBotTokenPayload;
    if (typeof payload.agentId !== "number" || typeof payload.userId !== "string") {
      return { ok: false, reason: "invalid" };
    }
    if (typeof payload.exp !== "number") return { ok: false, reason: "invalid" };
    if (Date.now() > payload.exp) return { ok: false, reason: "expired" };
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

export function verifyMeetBotToken(token: string): MeetBotTokenPayload | null {
  const checked = checkMeetBotToken(token);
  return checked.ok ? checked.payload : null;
}

// ── Recall REST client (minimal) ─────────────────────────────────────────────

export interface RecallBotSummary {
  id: string;
  meetingUrl?: string | null;
  statusCode: string | null;   // latest status_changes code, e.g. "in_call_recording"
  /** Ownership metadata we attach at creation — authorization source of truth. */
  ownerUserId: string | null;
  agentId: number | null;
  raw?: unknown;
}

async function recallFetch(path: string, init?: RequestInit): Promise<Response> {
  return recallHttpWithFallback(async () => `${await resolveRecallBase()}${path}`, init);
}

function summarizeBot(bot: any): RecallBotSummary {
  const changes = Array.isArray(bot?.status_changes) ? bot.status_changes : [];
  const last = changes.length ? changes[changes.length - 1] : null;
  const meta = bot?.metadata ?? {};
  return {
    id: String(bot?.id ?? ""),
    meetingUrl: bot?.meeting_url?.meeting_id ? null : (typeof bot?.meeting_url === "string" ? bot.meeting_url : null),
    statusCode: last?.code ?? null,
    ownerUserId: typeof meta.ownerUserId === "string" ? meta.ownerUserId : null,
    agentId: Number.isFinite(Number(meta.agentId)) ? Number(meta.agentId) : null,
  };
}

/** Cost cut: leave soon after the room empties (tolerate brief drop/rejoin). */
export const RECALL_EVERYONE_LEFT_TIMEOUT_SEC = 30;
/** Cost cut: leave if bot joined but nobody else ever arrives. */
export const RECALL_NOONE_JOINED_TIMEOUT_SEC = 10 * 60;
/** Cost cut: leave if never admitted from waiting room. */
export const RECALL_WAITING_ROOM_TIMEOUT_SEC = 10 * 60;
/** Keep mixed MP4 within Recall's free storage window for call-log playback. */
export const RECALL_RECORDING_RETENTION_HOURS = 168;

/** Pure payload fragment — unit-tested; used by createRecallBot. */
export function buildRecallAutomaticLeave(): {
  everyone_left_timeout: { timeout: number; activate_after: number };
  noone_joined_timeout: number;
  waiting_room_timeout: number;
  recording_permission_denied_timeout: number;
  in_call_not_recording_timeout: number;
} {
  return {
    everyone_left_timeout: {
      timeout: RECALL_EVERYONE_LEFT_TIMEOUT_SEC,
      // Recall requires activate_after >= 1 (seconds after recording starts).
      activate_after: 1,
    },
    noone_joined_timeout: RECALL_NOONE_JOINED_TIMEOUT_SEC,
    waiting_room_timeout: RECALL_WAITING_ROOM_TIMEOUT_SEC,
    // Zoom/Teams: leave soon if host denies recording consent.
    recording_permission_denied_timeout: 60,
    // Don't sit forever waiting for consent UI.
    in_call_not_recording_timeout: 15 * 60,
  };
}

export function detectMeetingPlatform(
  meetingUrl: string,
): "google_meet" | "zoom" | "microsoft_teams" | "unknown" {
  const u = meetingUrl.toLowerCase();
  if (u.includes("meet.google.com")) return "google_meet";
  if (u.includes("zoom.us") || u.includes("zoom.com")) return "zoom";
  if (u.includes("teams.microsoft.com") || u.includes("teams.live.com")) return "microsoft_teams";
  return "unknown";
}

function buildRecordingConsentChat(platform: ReturnType<typeof detectMeetingPlatform>): {
  on_bot_join: { send_to: string; message: string; pin: boolean };
  on_participant_join?: { exclude_host: boolean; message: string };
} {
  const botEmail = (process.env["RECALL_BOT_EMAIL"] ?? "").trim();
  const admitHint = botEmail
    ? ` If prompted, please admit ${botEmail}.`
    : " If prompted, please admit the SnapServe meeting agent.";
  const base =
    platform === "zoom" || platform === "microsoft_teams"
      ? `SnapServe AI joined. This meeting may be recorded. Please accept the recording consent prompt if shown.${admitHint}`
      : `SnapServe AI joined. This meeting may be recorded for quality and follow-up.${admitHint}`;
  return {
    on_bot_join: { send_to: "everyone", message: base.slice(0, 500), pin: true },
    on_participant_join: {
      exclude_host: false,
      message: "SnapServe AI is in this meeting (may be recorded).".slice(0, 500),
    },
  };
}

export function buildRecallRecordingRetention(): { type: "timed"; hours: number } {
  return { type: "timed", hours: RECALL_RECORDING_RETENTION_HOURS };
}

export type RecallBotCreateOpts = {
  meetingUrl: string;
  botName: string;
  pageUrl: string;
  ownerUserId: string;
  agentId: number;
  /** Webhook URL for real-time participant / transcript events. */
  eventsUrl?: string;
  eventsList?: string[];
  /**
   * Optional presentation webpage streamed as bot screenshare (camera stays
   * the voice agent page). Mid-call start uses startRecallScreenshare instead.
   */
  screensharePageUrl?: string;
  /**
   * Schedule join (ISO / Date). When ≥10 minutes ahead, Recall guarantees
   * on-time join. Omit for immediate (ad-hoc) join.
   */
  joinAt?: Date | string;
  /**
   * When true, omit meeting_url / join_at (Calendar V2 fills these from the event).
   */
  forCalendarEvent?: boolean;
};

/** Shared bot JSON for Create Bot and Calendar V2 Schedule Bot For Event. */
export function buildRecallBotConfig(opts: RecallBotCreateOpts): Record<string, unknown> {
  const loginGroupId = (process.env["RECALL_GOOGLE_LOGIN_GROUP_ID"] ?? "").trim();
  const diarized = isRecallDiarizedTranscriptEnabled();
  // Low-latency streaming requires language_code=en per Recall docs.
  const transcriptLang = ((process.env["RECALL_TRANSCRIPT_LANGUAGE"] ?? "en").trim() || "en").toLowerCase();
  const platform = detectMeetingPlatform(opts.meetingUrl);
  const recordingConfig: Record<string, unknown> = {
    retention: buildRecallRecordingRetention(),
    // Mixed meeting video for SnapServe call-log playback.
    video_mixed_mp4: {},
    // Multi-person gallery for Zoom/Teams/Meet recordings.
    video_mixed_layout: "gallery_view_v2",
    // Per-speaker MP3 parts for analytics / cleaner diarization archives.
    audio_separate_mp3: {},
    // Required with output_media: without this, Recall omits bot TTS from the
    // mixed recording and the dashboard flags "not configured to include bot audio".
    include_bot_in_recording: { audio: true },
  };
  if (diarized) {
    recordingConfig["transcript"] = {
      provider: {
        recallai_streaming: {
          mode: "prioritize_low_latency",
          language_code: transcriptLang === "auto" ? "en" : transcriptLang,
        },
      },
      diarization: {
        use_separate_streams_when_available: true,
      },
    };
  }
  if (opts.eventsUrl && opts.eventsList?.length) {
    recordingConfig["realtime_endpoints"] = [
      { type: "webhook", url: opts.eventsUrl, events: opts.eventsList },
    ];
  }
  const screenshareUrl = typeof opts.screensharePageUrl === "string" ? opts.screensharePageUrl.trim() : "";
  let joinAtIso: string | undefined;
  if (opts.joinAt) {
    const d = opts.joinAt instanceof Date ? opts.joinAt : new Date(opts.joinAt);
    if (Number.isFinite(d.getTime()) && d.getTime() > Date.now() + 15_000) {
      joinAtIso = d.toISOString();
    }
  }
  const body: Record<string, unknown> = {
    bot_name: opts.botName,
    // Ownership is enforced on every status/leave call by reading this back
    // from Recall (no local DB row to drift or lose on restart).
    metadata: { ownerUserId: opts.ownerUserId, agentId: String(opts.agentId) },
    output_media: {
      camera: { kind: "webpage", config: { url: opts.pageUrl } },
      ...(screenshareUrl
        ? { screenshare: { kind: "webpage", config: { url: screenshareUrl } } }
        : {}),
    },
    // The default `web` variant gives the bot's browser only 250 millicores,
    // which starves real-time audio (choppy/"sticky" voice). Recall's own FAQ
    // prescribes web_4_core for output-media agents (+ separate audio).
    variant: {
      google_meet: "web_4_core",
      zoom: "web_4_core",
      microsoft_teams: "web_4_core",
    },
    // Leave empty / idle rooms quickly — stops Recall + SnapServe minute burn.
    automatic_leave: buildRecallAutomaticLeave(),
    chat: buildRecordingConsentChat(platform),
    // Zoom: follow breakout invites so the agent stays with participants.
    ...(platform === "zoom"
      ? { breakout_room: { mode: "auto_accept_all_invites" } }
      : {}),
    // Signed-in Google Meet bot so the admit screen shows a real email address
    // (also invited as calendar attendee when RECALL_BOT_EMAIL is set).
    ...(loginGroupId
      ? {
          google_meet: {
            google_login_group_id: loginGroupId,
            login_required: true,
          },
        }
      : {}),
    recording_config: recordingConfig,
  };
  if (!opts.forCalendarEvent) {
    body["meeting_url"] = opts.meetingUrl;
    if (joinAtIso) body["join_at"] = joinAtIso;
  }
  return body;
}

export async function createRecallBot(opts: RecallBotCreateOpts): Promise<RecallBotSummary> {
  const res = await recallFetch("/bot/", {
    method: "POST",
    body: JSON.stringify(buildRecallBotConfig(opts)),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(messageFromRecallBody(res.status, text));
  }
  return summarizeBot(await res.json());
}

/** Delete a scheduled/active bot (e.g. booking cancelled before join). */
export async function deleteRecallBot(botId: string): Promise<void> {
  const res = await recallFetch(`/bot/${encodeURIComponent(botId)}/`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    throw new Error(`Recall delete bot failed (${res.status}): ${text.slice(0, 200)}`);
  }
}

/**
 * After the meeting ends, pull Recall's async diarized transcript artifact
 * (recordings[].media_shortcuts.transcript.data.download_url) and format as
 * plain "[Speaker]: utterance" lines. Returns null while the artifact is not
 * ready yet (caller should retry).
 */
type RecallBotRecordings = {
  recordings?: Array<{
    id?: string;
    media_shortcuts?: {
      transcript?: { data?: { download_url?: string | null } | null } | null;
      video_mixed?: {
        status?: { code?: string | null } | null;
        data?: { download_url?: string | null } | null;
        format?: string | null;
      } | null;
    } | null;
  }>;
};

export type RecallSeparateAudioTrack = {
  participantId: string | null;
  name: string;
  downloadUrl: string;
  isHost: boolean;
};

async function fetchRecallBotJson(botId: string): Promise<RecallBotRecordings> {
  const res = await recallFetch(`/bot/${encodeURIComponent(botId)}/`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Recall get bot failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return (await res.json()) as RecallBotRecordings;
}

export async function fetchRecallBotDiarizedTranscript(botId: string): Promise<string | null> {
  const bot = await fetchRecallBotJson(botId);
  const downloadUrl =
    bot.recordings?.find((r) => r?.media_shortcuts?.transcript?.data?.download_url)
      ?.media_shortcuts?.transcript?.data?.download_url ?? null;
  if (!downloadUrl) return null;

  const txRes = await fetch(downloadUrl, { headers: { accept: "application/json" } });
  if (!txRes.ok) {
    const text = await txRes.text().catch(() => "");
    throw new Error(`Recall transcript download failed (${txRes.status}): ${text.slice(0, 200)}`);
  }
  const payload = (await txRes.json()) as unknown;
  return formatRecallTranscriptDownload(payload);
}

/**
 * Fresh pre-signed MP4 URL for mixed meeting video (short-lived — do not cache).
 * Returns null while Recall is still processing.
 */
export async function fetchRecallBotMixedVideoUrl(botId: string): Promise<string | null> {
  const bot = await fetchRecallBotJson(botId);
  for (const rec of bot.recordings ?? []) {
    const vm = rec?.media_shortcuts?.video_mixed;
    const url = vm?.data?.download_url;
    if (typeof url === "string" && url.startsWith("http")) {
      // Prefer done; still accept URL if present (some regions omit status briefly).
      const code = vm?.status?.code;
      if (!code || code === "done") return url;
    }
  }
  return null;
}

/**
 * Per-participant MP3 parts (async). Pre-signed URLs — do not cache long-term.
 * Returns null while Recall is still processing separate audio.
 */
export async function fetchRecallBotSeparateAudioTracks(
  botId: string,
): Promise<{ recordingId: string; tracks: RecallSeparateAudioTrack[] } | null> {
  const bot = await fetchRecallBotJson(botId);
  const recordingId =
    bot.recordings?.find((r) => typeof r?.id === "string" && r.id.trim())?.id?.trim() ?? "";
  if (!recordingId) return null;

  const listRes = await recallFetch(
    `/audio_separate?recording_id=${encodeURIComponent(recordingId)}`,
  );
  if (!listRes.ok) {
    const text = await listRes.text().catch(() => "");
    throw new Error(`Recall audio_separate list failed (${listRes.status}): ${text.slice(0, 200)}`);
  }
  const listJson = (await listRes.json()) as {
    results?: Array<{
      status?: { code?: string | null } | null;
      data?: { download_url?: string | null } | null;
    }>;
  };
  const manifests = (listJson.results ?? []).filter(
    (r) => (!r.status?.code || r.status.code === "done") && typeof r.data?.download_url === "string",
  );
  if (!manifests.length) return null;

  const tracks: RecallSeparateAudioTrack[] = [];
  for (const m of manifests) {
    const manifestUrl = m.data!.download_url!;
    const partRes = await fetch(manifestUrl, { headers: { accept: "application/json" } });
    if (!partRes.ok) continue;
    const parts = (await partRes.json()) as unknown;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const p = part as {
        download_url?: unknown;
        participant?: { id?: unknown; name?: unknown; is_host?: unknown };
      };
      const downloadUrl = typeof p.download_url === "string" ? p.download_url : "";
      if (!downloadUrl.startsWith("http")) continue;
      const name =
        typeof p.participant?.name === "string" && p.participant.name.trim()
          ? p.participant.name.trim().slice(0, 80)
          : "Participant";
      const participantId =
        p.participant?.id != null && String(p.participant.id).trim()
          ? String(p.participant.id).trim()
          : null;
      tracks.push({
        participantId,
        name,
        downloadUrl,
        isHost: p.participant?.is_host === true,
      });
      if (tracks.length >= 64) break;
    }
    if (tracks.length >= 64) break;
  }
  if (!tracks.length) return null;
  return { recordingId, tracks };
}

/** Post a message to the meeting chat (Meet: everyone; Zoom may DM by id). */
export async function sendRecallChatMessage(
  botId: string,
  message: string,
  opts?: { to?: string; pin?: boolean },
): Promise<void> {
  const text = message.trim().slice(0, 500); // Meet hard limit
  if (!text) throw new Error("chat message is empty");
  const res = await recallFetch(`/bot/${encodeURIComponent(botId)}/send_chat_message/`, {
    method: "POST",
    body: JSON.stringify({
      message: text,
      to: opts?.to?.trim() || "everyone",
      pin: opts?.pin === true,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Recall send chat failed (${res.status}): ${errText.slice(0, 300)}`);
  }
}

/** Normalize Recall JSON transcript download into speaker-labeled lines. */
export function formatRecallTranscriptDownload(payload: unknown): string | null {
  if (!Array.isArray(payload)) return null;
  const lines: string[] = [];
  for (const entry of payload) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as {
      participant?: { name?: unknown };
      words?: Array<{ text?: unknown }>;
    };
    const name =
      typeof e.participant?.name === "string" && e.participant.name.trim()
        ? e.participant.name.trim().slice(0, 60)
        : "Unknown";
    const words = Array.isArray(e.words) ? e.words : [];
    const text = words
      .map((w) => (typeof w?.text === "string" ? w.text : ""))
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    lines.push(`[${name}]: ${text}`);
    if (lines.length >= 500) break;
  }
  return lines.length ? lines.join("\n") : null;
}

/** Workspace Meet bot identity for UI + calendar invites. */
export function getMeetBotIdentity(): {
  botEmail: string | null;
  signedInGoogleMeet: boolean;
} {
  const botEmail = (process.env["RECALL_BOT_EMAIL"] ?? "").trim() || null;
  const signedInGoogleMeet = !!(process.env["RECALL_GOOGLE_LOGIN_GROUP_ID"] ?? "").trim();
  return { botEmail, signedInGoogleMeet };
}

export async function getRecallBot(botId: string): Promise<RecallBotSummary> {
  const res = await recallFetch(`/bot/${encodeURIComponent(botId)}/`);
  if (!res.ok) throw new Error(`Recall get bot failed (${res.status})`);
  return summarizeBot(await res.json());
}

/** Ask the bot to leave the meeting. Idempotent-ish: 4xx after it already left is fine. */
export async function leaveRecallBot(botId: string): Promise<void> {
  const res = await recallFetch(`/bot/${encodeURIComponent(botId)}/leave_call/`, { method: "POST" });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    throw new Error(`Recall leave call failed (${res.status}): ${text.slice(0, 200)}`);
  }
}

/** Start / replace screenshare output_media (does not touch camera / voice page). */
export async function startRecallScreenshare(botId: string, pageUrl: string): Promise<void> {
  const res = await recallFetch(`/bot/${encodeURIComponent(botId)}/output_media/`, {
    method: "POST",
    body: JSON.stringify({
      screenshare: { kind: "webpage", config: { url: pageUrl } },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Recall start screenshare failed (${res.status}): ${text.slice(0, 300)}`);
  }
}

/** Stop screenshare only — voice camera page keeps running. */
export async function stopRecallScreenshare(botId: string): Promise<void> {
  const res = await recallFetch(`/bot/${encodeURIComponent(botId)}/output_media/`, {
    method: "DELETE",
    body: JSON.stringify({ screenshare: true }),
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    throw new Error(`Recall stop screenshare failed (${res.status}): ${text.slice(0, 300)}`);
  }
}

// ── Bot webpage ──────────────────────────────────────────────────────────────
// Headless webcall client that runs INSIDE the Recall bot. No UI beyond a
// status line (participants see the bot's camera tile render this page).
// Mirrors dashboard webcall-panel.tsx capture/playback:
//   up:   mic (= meeting mix) → lowpass chain (if ctx rate > 16k) → linear
//         resample to 16k → Int16LE binary frames
//   down: 8k PCM16LE binary frames → sequential AudioBuffer queue
//   json: ready / clear (barge-in flush) / call_end / notice / error

export function buildMeetBotPageHtml(opts: { agentId: number; token: string; agentName: string }): string {
  const cfg = JSON.stringify({ agentId: opts.agentId, token: opts.token, agentName: opts.agentName });
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Voice Agent</title>
<style>
  /* Mimic Google Meet's native camera-off tile: flat dark background with a
     solid-color initial circle. Meet itself overlays the bot's name at the
     bottom-left, so the page renders nothing else (status is kept in the DOM
     for debugging but visually hidden). */
  html,body{margin:0;height:100%;background:#202124;font-family:'Google Sans',Roboto,system-ui,sans-serif;
  display:flex;align-items:center;justify-content:center}
  .avatar{width:120px;height:120px;border-radius:50%;background:#5f6368;
  display:flex;align-items:center;justify-content:center;
  color:#fff;font-size:56px;font-weight:400;user-select:none}
  #st{position:absolute;left:-9999px}
</style></head><body>
<div class="avatar" id="av"></div><div id="st">connecting…</div>
<script>
(function(){
  var CFG = ${cfg};
  // Meet-style avatar: initial letter on a deterministic color from the name.
  var AV_COLORS = ["#1a73e8","#d93025","#188038","#e37400","#9334e6","#007b83","#b31412","#7627bb"];
  var nm = (CFG.agentName || "?").trim();
  var hash = 0; for (var i = 0; i < nm.length; i++) hash = (hash * 31 + nm.charCodeAt(i)) >>> 0;
  var av = document.getElementById("av");
  av.textContent = nm.charAt(0).toUpperCase();
  av.style.background = AV_COLORS[hash % AV_COLORS.length];
  var st = document.getElementById("st");
  function setSt(t){ st.textContent = t; }

  // Playback context runs at the browser's NATIVE rate — forcing 8000Hz can
  // silently detach the context from tab-audio capture in the headless bot
  // (agent audio then never reaches the meeting). Buffers are created at 8000Hz
  // and Chrome resamples them to the context rate on playback.
  // Gapless scheduled playback: each incoming frame is scheduled on a running
  // time cursor (not chained via onended, which leaves audible micro-gaps
  // between the small server frames). A ~150ms lead absorbs network jitter.
  var playCtx = null, nextPlayTime = 0, activeSources = [];
  var underruns = 0, framesIn = 0, started = false;
  function ensurePlayCtx(){
    if (!playCtx) playCtx = new (window.AudioContext||window.webkitAudioContext)();
    if (playCtx.state !== "running") playCtx.resume();
    return playCtx;
  }
  setInterval(function(){ if (playCtx && playCtx.state !== "running") playCtx.resume(); }, 1000);
  // Continuous 8k -> context-rate upsampler with state carried across frames.
  // Letting Chrome resample each tiny AudioBuffer independently puts an
  // audible seam at every frame boundary (~25/sec) = gritty "sticky" voice.
  var upLast = 0, upFrac = 0;
  var inRate = 8000; // actual server rate arrives in the "ready" message
  function upsampleTo(ctxRate, pcm){
    var ratio = inRate / ctxRate;         // input samples per output sample
    var outLen = Math.floor((pcm.length - upFrac) / ratio);
    if (outLen <= 0) return new Float32Array(0);
    var out = new Float32Array(outLen);
    var pos = upFrac;
    for (var i=0;i<outLen;i++){
      var i0 = Math.floor(pos);
      var t = pos - i0;
      var s0 = i0 === 0 ? upLast : pcm[i0-1]/32768;
      var s1 = pcm[Math.min(i0, pcm.length-1)]/32768;
      out[i] = s0 + (s1 - s0) * t;
      pos += ratio;
    }
    upLast = pcm[pcm.length-1]/32768;
    upFrac = pos - Math.floor(pos);
    return out;
  }
  function enqueuePcm(pcm){
    var ctx = ensurePlayCtx();
    var f32 = upsampleTo(ctx.sampleRate, pcm);
    if (!f32.length) return;
    var buf = ctx.createBuffer(1, f32.length, ctx.sampleRate);
    buf.getChannelData(0).set(f32);
    var src = ctx.createBufferSource();
    src.buffer = buf; src.connect(ctx.destination);
    if (Date.now() < ignoreAudioUntil) return;
    var now = ctx.currentTime;
    framesIn++;
    if (nextPlayTime < now + 0.02) {
      if (started) underruns++;
      started = true;
      nextPlayTime = now + 0.6;
    }
    src.start(nextPlayTime);
    nextPlayTime += buf.duration;
    activeSources.push(src);
    src.onended = function(){
      var ix = activeSources.indexOf(src); if (ix>=0) activeSources.splice(ix,1);
    };
  }
  var ignoreAudioUntil = 0;
  function clearPlayback(){
    ignoreAudioUntil = Date.now() + 1000;
    activeSources.slice().forEach(function(s){ try{s.stop();}catch(e){} });
    activeSources = []; nextPlayTime = 0; upLast = 0; upFrac = 0;
  }

  var proto = location.protocol === "https:" ? "wss" : "ws";
  var ws = new WebSocket(proto + "://" + location.host + "/api/ws/webcall/" + CFG.agentId + "?meetbot=" + encodeURIComponent(CFG.token) + "&rate=16000");
  ws.binaryType = "arraybuffer";

  ws.onmessage = function(ev){
    if (typeof ev.data === "string") {
      try {
        var msg = JSON.parse(ev.data);
        if (msg.type === "ready") { if (msg.audioSampleRate) inRate = msg.audioSampleRate; setSt("in the meeting"); }
        else if (msg.type === "clear") clearPlayback();
        else if (msg.type === "call_end") setSt("call ended");
        else if (msg.type === "error") setSt("error: " + (msg.message||""));
      } catch(e){}
      return;
    }
    enqueuePcm(new Int16Array(ev.data));
  };
  // Playback health telemetry: lets the server log how often the bot's
  // browser starved (each underrun = an audible gap in the meeting).
  setInterval(function(){
    if (ws.readyState === 1) {
      try { ws.send(JSON.stringify({ type: "stats", underruns: underruns, framesIn: framesIn, ctxRate: playCtx ? playCtx.sampleRate : 0, ctxState: playCtx ? playCtx.state : "none", inRate: inRate })); } catch(e){}
    }
  }, 10000);
  ws.onclose = function(){ setSt("disconnected"); };
  ws.onerror = function(){ setSt("connection error"); };

  ws.onopen = function(){
    setSt("joining…");
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream){
      var ctx = new (window.AudioContext||window.webkitAudioContext)();
      var srcNode = ctx.createMediaStreamSource(stream);
      var node = srcNode;
      // Band-limit before decimating to 16k (aliasing buzz otherwise).
      if (ctx.sampleRate > 16000) {
        for (var i=0;i<3;i++){
          var f = ctx.createBiquadFilter();
          f.type = "lowpass"; f.frequency.value = 7000; f.Q.value = 0.707;
          node.connect(f); node = f;
        }
      }
      var proc = ctx.createScriptProcessor(4096, 1, 1);
      node.connect(proc);
      var sink = ctx.createGain(); sink.gain.value = 0; // keep proc pulled, silent
      proc.connect(sink); sink.connect(ctx.destination);
      var ratio = ctx.sampleRate / 16000;
      proc.onaudioprocess = function(e){
        if (ws.readyState !== 1) return;
        var input = e.inputBuffer.getChannelData(0);
        var outLen = Math.floor(input.length / ratio);
        var out = new Int16Array(outLen);
        for (var j=0;j<outLen;j++){
          var pos = j*ratio, i0 = Math.floor(pos), i1 = Math.min(i0+1, input.length-1);
          var frac = pos - i0;
          var s = input[i0]*(1-frac) + input[i1]*frac;
          s = Math.max(-1, Math.min(1, s));
          out[j] = s < 0 ? s*32768 : s*32767;
        }
        ws.send(out.buffer);
      };
    }).catch(function(err){ setSt("mic error: " + err); });
  };
})();
</script></body></html>`;
}
