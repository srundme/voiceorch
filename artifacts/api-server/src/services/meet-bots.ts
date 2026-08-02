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

function recallKey(): string {
  const k = (process.env["RECALL_API_KEY"] ?? "").trim();
  if (!k) throw new Error("RECALL_API_KEY is not configured");
  return k;
}

// Recall API keys are region-scoped and a wrong RECALL_REGION yields a
// confusing 401. Resolve the working region ONCE by probing (configured
// region first), then cache for the process lifetime.
let resolvedRegion: string | null = null;
async function resolveRecallBase(): Promise<string> {
  if (resolvedRegion) return `https://${resolvedRegion}.recall.ai/api/v1`;
  const candidates = [RECALL_REGION(), ...RECALL_REGIONS.filter((r) => r !== RECALL_REGION())];
  for (const region of candidates) {
    try {
      const res = await fetch(`https://${region}.recall.ai/api/v1/bot/?limit=1`, {
        headers: { accept: "application/json", authorization: recallKey() },
      });
      if (res.ok) {
        resolvedRegion = region;
        return `https://${region}.recall.ai/api/v1`;
      }
    } catch {
      /* network error — try next region */
    }
  }
  throw new Error(
    "Recall API key was rejected by every Recall region — verify RECALL_API_KEY is the API key from the Recall.ai dashboard (not a webhook secret)",
  );
}

// ── Signed page/WS token ─────────────────────────────────────────────────────
// The bot page URL (containing this token) is sent to Recall, so the token must
// be self-contained, expiring, and grant access ONLY to one agent on behalf of
// the user who launched the bot. HMAC-SHA256 over SESSION_SECRET.

export interface MeetBotTokenPayload {
  agentId: number;
  userId: string;
  exp: number; // epoch ms
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

export function verifyMeetBotToken(token: string): MeetBotTokenPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "mbv1") return null;
    const expected = createHmac("sha256", tokenSecret()).update(`mbv1.${parts[1]}`).digest();
    const given = Buffer.from(parts[2]!, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as MeetBotTokenPayload;
    if (typeof payload.agentId !== "number" || typeof payload.userId !== "string") return null;
    if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
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
  const base = await resolveRecallBase();
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: recallKey(),
      ...(init?.headers ?? {}),
    },
  });
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

export async function createRecallBot(opts: {
  meetingUrl: string;
  botName: string;
  pageUrl: string;
  ownerUserId: string;
  agentId: number;
}): Promise<RecallBotSummary> {
  const res = await recallFetch("/bot/", {
    method: "POST",
    body: JSON.stringify({
      meeting_url: opts.meetingUrl,
      bot_name: opts.botName,
      // Ownership is enforced on every status/leave call by reading this back
      // from Recall (no local DB row to drift or lose on restart).
      metadata: { ownerUserId: opts.ownerUserId, agentId: String(opts.agentId) },
      output_media: {
        camera: { kind: "webpage", config: { url: opts.pageUrl } },
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Recall create bot failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return summarizeBot(await res.json());
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
  html,body{margin:0;height:100%;background:#0b1020;color:#e7ecf5;font-family:system-ui,sans-serif;
  display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px}
  .pulse{width:64px;height:64px;border-radius:50%;background:#3b82f6;animation:p 1.6s ease-in-out infinite}
  @keyframes p{0%,100%{transform:scale(1);opacity:.85}50%{transform:scale(1.25);opacity:1}}
  #st{font-size:14px;opacity:.8}
  #nm{font-size:20px;font-weight:600}
</style></head><body>
<div class="pulse"></div><div id="nm"></div><div id="st">connecting…</div>
<script>
(function(){
  var CFG = ${cfg};
  document.getElementById("nm").textContent = CFG.agentName;
  var st = document.getElementById("st");
  function setSt(t){ st.textContent = t; }

  // Playback context runs at the browser's NATIVE rate — forcing 8000Hz can
  // silently detach the context from tab-audio capture in the headless bot
  // (agent audio then never reaches the meeting). Buffers are created at 8000Hz
  // and Chrome resamples them to the context rate on playback.
  var playCtx = null, playQueue = [], playing = false, activeSources = [];
  function ensurePlayCtx(){
    if (!playCtx) playCtx = new (window.AudioContext||window.webkitAudioContext)();
    if (playCtx.state !== "running") playCtx.resume();
    return playCtx;
  }
  setInterval(function(){ if (playCtx && playCtx.state !== "running") playCtx.resume(); }, 1000);
  function playNext(){
    if (playing || !playQueue.length) return;
    playing = true;
    var ctx = ensurePlayCtx();
    var pcm = playQueue.shift();
    var f32 = new Float32Array(pcm.length);
    for (var i=0;i<pcm.length;i++) f32[i] = pcm[i]/32768;
    var buf = ctx.createBuffer(1, f32.length, 8000);
    buf.getChannelData(0).set(f32);
    var src = ctx.createBufferSource();
    src.buffer = buf; src.connect(ctx.destination);
    activeSources.push(src);
    src.onended = function(){
      var ix = activeSources.indexOf(src); if (ix>=0) activeSources.splice(ix,1);
      playing = false; playNext();
    };
    src.start();
  }
  function clearPlayback(){
    playQueue = [];
    activeSources.slice().forEach(function(s){ try{s.stop();}catch(e){} });
    activeSources = []; playing = false;
  }

  var proto = location.protocol === "https:" ? "wss" : "ws";
  var ws = new WebSocket(proto + "://" + location.host + "/api/ws/webcall/" + CFG.agentId + "?meetbot=" + encodeURIComponent(CFG.token));
  ws.binaryType = "arraybuffer";

  ws.onmessage = function(ev){
    if (typeof ev.data === "string") {
      try {
        var msg = JSON.parse(ev.data);
        if (msg.type === "ready") setSt("in the meeting");
        else if (msg.type === "clear") clearPlayback();
        else if (msg.type === "call_end") setSt("call ended");
        else if (msg.type === "error") setSt("error: " + (msg.message||""));
      } catch(e){}
      return;
    }
    playQueue.push(new Int16Array(ev.data));
    playNext();
  };
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
