/**
 * Meeting bot screenshare presentations (Recall output_media.screenshare).
 * Voice stays on camera (meet-bot page); slides go out as screenshare.
 */
import { logger } from "../lib/logger.js";
import { getSelfBaseUrl } from "../lib/app-domain.js";
import { startRecallScreenshare, stopRecallScreenshare } from "./meet-bots.js";

export type PresentationKind = "pdf" | "slides" | "web";

export interface PresentationState {
  sourceUrl: string;
  kind: PresentationKind;
  slideIndex: number;
  presenting: boolean;
  updatedAt: number;
}

const byMid = new Map<string, PresentationState>();

export function detectPresentationKind(url: string): PresentationKind {
  const u = url.toLowerCase();
  if (u.includes("docs.google.com/presentation") || u.includes("slides.google.com")) {
    return "slides";
  }
  if (u.endsWith(".pdf") || u.includes(".pdf?") || u.includes("/pdf")) return "pdf";
  return "web";
}

export function isAllowedPresentationUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Normalize Google Slides links to an embeddable preview URL when possible. */
export function normalizePresentationUrl(url: string): string {
  const trimmed = url.trim();
  try {
    const u = new URL(trimmed);
    if (u.hostname.includes("docs.google.com") && u.pathname.includes("/presentation/")) {
      // /presentation/d/ID/edit → /presentation/d/ID/embed
      const m = u.pathname.match(/\/presentation\/d\/([^/]+)/);
      if (m?.[1]) {
        return `https://docs.google.com/presentation/d/${m[1]}/embed?start=false&loop=false&delayms=60000`;
      }
    }
  } catch {
    /* keep original */
  }
  return trimmed;
}

export function configureMeetPresentation(mid: string, sourceUrl: string): PresentationState {
  const normalized = normalizePresentationUrl(sourceUrl);
  const state: PresentationState = {
    sourceUrl: normalized,
    kind: detectPresentationKind(normalized),
    slideIndex: 1,
    presenting: false,
    updatedAt: Date.now(),
  };
  byMid.set(mid, state);
  return state;
}

export function getMeetPresentation(mid: string): PresentationState | null {
  return byMid.get(mid) ?? null;
}

export function setMeetPresentationSlide(mid: string, slideIndex: number): PresentationState | null {
  const s = byMid.get(mid);
  if (!s) return null;
  s.slideIndex = Math.max(1, Math.min(500, Math.round(slideIndex)));
  s.updatedAt = Date.now();
  return s;
}

export function bumpMeetPresentationSlide(mid: string, delta: number): PresentationState | null {
  const s = byMid.get(mid);
  if (!s) return null;
  return setMeetPresentationSlide(mid, s.slideIndex + delta);
}

export function markMeetPresentationActive(mid: string, presenting: boolean): void {
  const s = byMid.get(mid);
  if (!s) return;
  s.presenting = presenting;
  s.updatedAt = Date.now();
}

export function buildPresentPageUrl(base: string, token: string): string {
  return `${base.replace(/\/$/, "")}/api/meet-bots/present?mb=${encodeURIComponent(token)}`;
}

/**
 * Seed presentation state from agent Meeting settings at bot launch.
 * Returns the SnapServe present-page URL when auto-start screenshare is desired.
 */
export function prepareMeetPresentationAtLaunch(opts: {
  mid: string;
  token: string;
  baseUrl: string;
  presentationUrl: string;
  presentationAutoStart: boolean;
}): { screensharePageUrl?: string } {
  const url = opts.presentationUrl.trim();
  if (!url || !isAllowedPresentationUrl(url)) return {};
  configureMeetPresentation(opts.mid, url);
  if (!opts.presentationAutoStart) return {};
  markMeetPresentationActive(opts.mid, true);
  return { screensharePageUrl: buildPresentPageUrl(opts.baseUrl, opts.token) };
}

/**
 * Start screenshare of the SnapServe presentation page for this meeting.
 * Camera (voice agent page) is left alone.
 */
export async function startMeetPresentation(opts: {
  mid: string;
  botId: string;
  presentPageUrl: string;
  /** Optional HTTPS override / first-time URL for this meeting. */
  sourceUrl?: string;
}): Promise<string> {
  let s = byMid.get(opts.mid);
  const override = typeof opts.sourceUrl === "string" ? opts.sourceUrl.trim() : "";
  if (override) {
    if (!isAllowedPresentationUrl(override)) {
      return "error: presentation url must be https://";
    }
    s = configureMeetPresentation(opts.mid, override);
  }
  if (!s?.sourceUrl) {
    return "error: no presentation configured — set a presentation URL in Meeting settings, or pass url to start_presentation";
  }
  try {
    await startRecallScreenshare(opts.botId, opts.presentPageUrl);
    s.presenting = true;
    s.updatedAt = Date.now();
    logger.info({ mid: opts.mid, botId: opts.botId, slide: s.slideIndex }, "Meet presentation screenshare started");
    return `presentation_started: slide=${s.slideIndex}, url=${s.sourceUrl}. Tell participants you are sharing the deck. Use next_slide / previous_slide / goto_slide to advance.`;
  } catch (err) {
    logger.warn({ err, mid: opts.mid, botId: opts.botId }, "Meet presentation start failed");
    return `error: could not start presentation — ${err instanceof Error ? err.message : "unknown error"}`;
  }
}

export async function stopMeetPresentation(opts: {
  mid: string;
  botId: string;
}): Promise<string> {
  const s = byMid.get(opts.mid);
  try {
    await stopRecallScreenshare(opts.botId);
    if (s) {
      s.presenting = false;
      s.updatedAt = Date.now();
    }
    logger.info({ mid: opts.mid, botId: opts.botId }, "Meet presentation screenshare stopped");
    return "presentation_stopped: screenshare ended. You can start_presentation again later.";
  } catch (err) {
    logger.warn({ err, mid: opts.mid, botId: opts.botId }, "Meet presentation stop failed");
    return `error: could not stop presentation — ${err instanceof Error ? err.message : "unknown error"}`;
  }
}

/** Viewer page polls this JSON. */
export function presentationPublicState(mid: string): {
  ok: boolean;
  sourceUrl?: string;
  kind?: PresentationKind;
  slideIndex?: number;
  presenting?: boolean;
  updatedAt?: number;
} {
  const s = byMid.get(mid);
  if (!s) return { ok: false };
  return {
    ok: true,
    sourceUrl: s.sourceUrl,
    kind: s.kind,
    slideIndex: s.slideIndex,
    presenting: s.presenting,
    updatedAt: s.updatedAt,
  };
}

/** Built-in meeting tools: start / stop / next / previous slide. */
export async function executeMeetPresentationTool(opts: {
  toolName: string;
  /** LLM may omit args entirely (null) — treat as {}. */
  args: Record<string, unknown> | null | undefined;
  meetMid: string | null | undefined;
  meetBotToken: string | null | undefined;
  /** Fallback deck URL from agent Meeting settings. */
  presentationDefaultUrl?: string | null;
}): Promise<string> {
  const mid = opts.meetMid?.trim();
  const token = opts.meetBotToken?.trim();
  if (!mid || !token) {
    return "error: presentation tools require an active meeting bot session";
  }
  const args = opts.args && typeof opts.args === "object" ? opts.args : {};
  const { getMeetRosterBotId } = await import("./meet-roster.js");
  const botId = getMeetRosterBotId(mid);
  if (!botId) {
    return "error: meeting bot id unknown — presentation unavailable right now";
  }
  const presentPageUrl = buildPresentPageUrl(getSelfBaseUrl(), token);

  // Lazy-seed from Meeting settings when launch state was lost (restart).
  if (!byMid.get(mid)) {
    const def = opts.presentationDefaultUrl?.trim() ?? "";
    if (def && isAllowedPresentationUrl(def)) {
      configureMeetPresentation(mid, def);
    }
  }

  switch (opts.toolName) {
    case "start_presentation": {
      const url = typeof args["url"] === "string" ? args["url"].trim() : "";
      return startMeetPresentation({
        mid,
        botId,
        presentPageUrl,
        ...(url ? { sourceUrl: url } : {}),
      });
    }
    case "stop_presentation":
      return stopMeetPresentation({ mid, botId });
    case "next_slide": {
      const s = bumpMeetPresentationSlide(mid, 1);
      if (!s) return "error: no presentation configured — call start_presentation first";
      if (!s.presenting) {
        return `slide_ready: ${s.slideIndex} (not sharing yet — call start_presentation)`;
      }
      return `slide=${s.slideIndex}. Brief participants on this slide if helpful.`;
    }
    case "previous_slide": {
      const s = bumpMeetPresentationSlide(mid, -1);
      if (!s) return "error: no presentation configured — call start_presentation first";
      if (!s.presenting) {
        return `slide_ready: ${s.slideIndex} (not sharing yet — call start_presentation)`;
      }
      return `slide=${s.slideIndex}. Brief participants on this slide if helpful.`;
    }
    case "goto_slide": {
      const raw = args["slide"];
      const n =
        typeof raw === "number"
          ? raw
          : typeof raw === "string" && raw.trim() !== ""
            ? Number(raw)
            : NaN;
      if (!Number.isFinite(n) || n < 1) {
        return "error: goto_slide requires slide >= 1";
      }
      const s = setMeetPresentationSlide(mid, n);
      if (!s) return "error: no presentation configured — call start_presentation first";
      if (!s.presenting) {
        return `slide_ready: ${s.slideIndex} (not sharing yet — call start_presentation)`;
      }
      return `slide=${s.slideIndex}. Brief participants on this slide if helpful.`;
    }
    default:
      return `error: unknown presentation tool ${opts.toolName}`;
  }
}

export function buildMeetPresentationPageHtml(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Presentation</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  html,body{margin:0;height:100%;background:#111;color:#eee;font-family:system-ui,sans-serif;overflow:hidden}
  #frame{position:absolute;inset:0;border:0;width:100%;height:100%;background:#000}
  #badge{position:absolute;left:12px;bottom:12px;padding:6px 10px;border-radius:8px;
    background:rgba(0,0,0,.55);font-size:12px;letter-spacing:.02em;z-index:2}
  #err{display:none;padding:24px;max-width:40rem;margin:10vh auto;line-height:1.5}
</style></head><body>
<div id="badge">SnapServe · slide <span id="n">1</span></div>
<iframe id="frame" allow="autoplay; fullscreen" referrerpolicy="no-referrer"></iframe>
<div id="err"></div>
<script>
(function(){
  var params = new URLSearchParams(location.search);
  var token = params.get("mb") || "";
  var frame = document.getElementById("frame");
  var badgeN = document.getElementById("n");
  var err = document.getElementById("err");
  var lastUpdated = 0;
  var lastSlide = 0;
  var lastUrl = "";

  function showErr(msg){
    err.style.display = "block";
    err.textContent = msg;
    frame.style.display = "none";
  }

  function frameSrc(state){
    var url = state.sourceUrl || "";
    var slide = state.slideIndex || 1;
    if (state.kind === "pdf") {
      // Native PDF viewer page fragment (Chrome/Edge inside Recall bot).
      var base = url.split("#")[0];
      return base + "#page=" + slide;
    }
    if (state.kind === "slides") {
      // Google Slides embed: try slide navigation via start hash when possible.
      try {
        var u = new URL(url);
        u.searchParams.set("slide", String(slide));
        return u.toString();
      } catch(e) { return url; }
    }
    return url;
  }

  function apply(state){
    if (!state || !state.ok) {
      showErr("Presentation not configured for this meeting.");
      return;
    }
    err.style.display = "none";
    frame.style.display = "block";
    badgeN.textContent = String(state.slideIndex || 1);
    var next = frameSrc(state);
    if (next !== lastUrl || state.slideIndex !== lastSlide) {
      frame.src = next;
      lastUrl = next;
      lastSlide = state.slideIndex || 1;
    }
  }

  async function poll(){
    if (!token) { showErr("Missing meeting token."); return; }
    try {
      var res = await fetch("/api/meet-bots/present-state?mb=" + encodeURIComponent(token), { cache: "no-store" });
      var state = await res.json();
      if (state.updatedAt && state.updatedAt === lastUpdated) return;
      lastUpdated = state.updatedAt || 0;
      apply(state);
    } catch (e) {
      /* retry */
    }
  }
  poll();
  setInterval(poll, 800);
})();
</script></body></html>`;
}
