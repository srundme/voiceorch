import { Router, type IRouter } from "express";
import { getWebcallLinkByToken, isWebcallLinkUsable } from "../services/webcall-links.js";
import { db, agentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getSelfBaseUrl } from "../lib/app-domain.js";

const router: IRouter = Router();

function requestOrigin(req: { protocol: string; headers: Record<string, unknown>; hostname: string }): string {
  const forwarded = req.headers["x-forwarded-host"];
  const host = (typeof forwarded === "string" && forwarded.split(",")[0]?.trim()) || req.hostname;
  const protoHeader = req.headers["x-forwarded-proto"];
  const proto =
    typeof protoHeader === "string" && protoHeader.split(",")[0]
      ? String(protoHeader).split(",")[0]!.trim()
      : req.protocol;
  return `${proto}://${host}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * GET /api/widget.js
 *
 * Floating (or inline) webcall widget for a customer's own site.
 * Requires data-share (webcall link token) so visitors can connect without logging in.
 *
 *   <script src="https://app.snapserve.ai/api/widget.js"
 *           data-agent-id="12"
 *           data-share="wcl_…"
 *           data-name="Support"
 *           data-color="#0ea5e9"
 *           data-position="bottom-right">
 *   </script>
 */
router.get("/widget.js", (_req, res): void => {
  res
    .set("Content-Type", "application/javascript; charset=utf-8")
    .set("Access-Control-Allow-Origin", "*")
    .set("Cache-Control", "public, max-age=120")
    .send(WEBCALL_WIDGET_JS);
});

/**
 * GET /api/widget/call?share=<token>
 * Standalone page (iframe-friendly) that loads the same widget in inline mode.
 */
router.get("/widget/call", async (req, res): Promise<void> => {
  const share = String(req.query["share"] ?? "").trim();
  if (!share) {
    res.status(400).type("html").send(embedErrorPage("Missing share token."));
    return;
  }

  const link = await getWebcallLinkByToken(share);
  if (!link) {
    res.status(404).type("html").send(embedErrorPage("This voice widget is unavailable."));
    return;
  }
  const usable = isWebcallLinkUsable(link);
  if (!usable.ok) {
    res.status(403).type("html").send(embedErrorPage(usable.reason));
    return;
  }

  const [agent] = await db
    .select({ id: agentsTable.id, name: agentsTable.name })
    .from(agentsTable)
    .where(eq(agentsTable.id, link.agentId))
    .limit(1);
  if (!agent) {
    res.status(404).type("html").send(embedErrorPage("Agent not found."));
    return;
  }

  const origin = requestOrigin(req) || getSelfBaseUrl();
  const name = escapeHtml(agent.name || "Voice assistant");
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="robots" content="noindex"/>
  <title>${name}</title>
  <style>
    html, body { margin: 0; height: 100%; background: #09090b; }
  </style>
</head>
<body>
  <script src="${escapeHtml(origin)}/api/widget.js"
          data-agent-id="${agent.id}"
          data-share="${escapeHtml(share)}"
          data-name="${name}"
          data-mode="inline"></script>
</body>
</html>`;

  res.removeHeader("X-Frame-Options");
  res.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' wss: ws: https:",
      "media-src 'self' blob:",
      "img-src 'self' data:",
      "font-src 'self'",
      "frame-ancestors *",
    ].join("; "),
  );
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Cache-Control", "no-store");
  res.type("html").send(html);
});

function embedErrorPage(message: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Unavailable</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;background:#09090b;color:#e4e4e7;padding:24px;text-align:center}p{max-width:28rem;line-height:1.5;color:#a1a1aa}</style>
</head><body><p>${escapeHtml(message)}</p></body></html>`;
}

/**
 * GET /api/widget/lead-capture.js
 * Returns a tiny self-contained lead-capture helper (~1 KB).
 *
 * Usage on any website:
 *   <script src="https://your-domain/api/widget/lead-capture.js"
 *           data-token="YOUR_CAMPAIGN_WEBHOOK_TOKEN">
 *   </script>
 *
 * Then on form submit:
 *   SnapServe.submit({ phone: "…", name: "…" })
 *     .then(() => console.log("Lead captured"))
 *     .catch(err => console.error(err.message));
 */
router.get("/widget/lead-capture.js", (_req, res): void => {
  const leadCaptureJs = `(function () {
  "use strict";
  var s = document.currentScript;
  var token = s && s.getAttribute("data-token");

  // Derive the API origin from the script's own src URL so the widget works
  // correctly on any third-party site (window.location would be wrong there).
  // data-origin is an optional override for proxied/CDN setups.
  var apiOrigin = (s && s.getAttribute("data-origin")) ||
    (s && s.src ? new URL(s.src).origin : "");
  var url = token && apiOrigin ? apiOrigin + "/api/webhooks/lead/" + token : null;

  window.SnapServe = {
    submit: function (fields) {
      if (!token) {
        return Promise.reject(new Error("SnapServe: missing data-token on <script> tag"));
      }
      if (!url) {
        return Promise.reject(new Error("SnapServe: could not determine API origin"));
      }
      return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields || {}),
      }).then(function (r) {
        if (r.ok) return r.json();
        return r.json().catch(function () { return {}; }).then(function (e) {
          throw new Error(e.error || ("SnapServe: request failed (" + r.status + ")"));
        });
      });
    },
  };

  if (!token) {
    console.warn("SnapServe: missing data-token on <script> tag — SnapServe.submit() will reject");
  }
})();
`;

  res
    .set("Content-Type", "application/javascript; charset=utf-8")
    .set("Access-Control-Allow-Origin", "*")
    .set("Cache-Control", "public, max-age=300")
    .send(leadCaptureJs);
});

export default router;

/** Served as /api/widget.js — no server interpolation; origin comes from the script src. */
const WEBCALL_WIDGET_JS = `(function () {
  "use strict";
  var script = document.currentScript;
  if (!script) return;
  if (document.getElementById("snapserve-webcall-widget")) return;

  var agentId = (script.getAttribute("data-agent-id") || "").trim();
  var share   = (script.getAttribute("data-share") || script.getAttribute("data-token") || "").trim();
  var rawName = script.getAttribute("data-name") || "Voice assistant";
  var rawColor = script.getAttribute("data-color") || "#0ea5e9";
  var pos     = script.getAttribute("data-position") || "bottom-right";
  var mode    = script.getAttribute("data-mode") || "bubble";
  var baseUrl = script.getAttribute("data-base-url") || script.getAttribute("data-origin") || "";
  if (!baseUrl) {
    try { baseUrl = script.src ? new URL(script.src).origin : ""; } catch (_) { baseUrl = ""; }
  }

  var allowedPos = { "bottom-right": 1, "bottom-left": 1, "top-right": 1, "top-left": 1 };
  if (!allowedPos[pos]) pos = "bottom-right";
  var color = /^#[0-9a-fA-F]{6}$/.test(rawColor) ? rawColor : "#0ea5e9";
  var inline = mode === "inline";

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var css = ""
    + "#snapserve-webcall-widget{position:fixed;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;}"
    + "#snapserve-webcall-widget.pos-bottom-right{bottom:24px;right:24px;}"
    + "#snapserve-webcall-widget.pos-bottom-left{bottom:24px;left:24px;}"
    + "#snapserve-webcall-widget.pos-top-right{top:24px;right:24px;}"
    + "#snapserve-webcall-widget.pos-top-left{top:24px;left:24px;}"
    + "#snapserve-webcall-widget.mode-inline{position:relative;inset:auto;width:100%;height:100%;min-height:420px;z-index:1;}"
    + "#ss-vo-btn{width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;background:" + color + ";color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(0,0,0,.25);transition:transform .15s,box-shadow .15s;}"
    + "#ss-vo-btn:hover{transform:scale(1.08);box-shadow:0 6px 28px rgba(0,0,0,.32);}"
    + "#ss-vo-btn.active{background:#ef4444;}"
    + "#ss-vo-btn svg{width:26px;height:26px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}"
    + "#ss-vo-panel{position:absolute;bottom:72px;right:0;width:320px;max-width:calc(100vw - 32px);background:#18181b;border:1px solid #27272a;border-radius:16px;padding:20px;box-shadow:0 16px 48px rgba(0,0,0,.5);display:none;flex-direction:column;gap:12px;}"
    + "#ss-vo-panel.open{display:flex;}"
    + "#snapserve-webcall-widget.mode-inline #ss-vo-panel{position:relative;display:flex;bottom:auto;right:auto;width:100%;height:100%;max-width:none;border-radius:0;box-sizing:border-box;}"
    + "#snapserve-webcall-widget.mode-inline #ss-vo-btn{display:none;}"
    + ".ss-vo-header{display:flex;align-items:center;gap:10px;}"
    + ".ss-vo-avatar{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;background:" + color + "22;border:1px solid " + color + "44;}"
    + ".ss-vo-agent-name{font-weight:600;color:#f4f4f5;font-size:15px;}"
    + ".ss-vo-status{font-size:12px;color:#a1a1aa;margin-top:1px;}"
    + ".ss-vo-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#52525b;margin-right:5px;vertical-align:middle;}"
    + ".ss-vo-dot.listening{background:#22c55e;animation:ss-vo-pulse 1.2s infinite;}"
    + ".ss-vo-dot.thinking{background:#f59e0b;animation:ss-vo-pulse .8s infinite;}"
    + ".ss-vo-dot.speaking{background:#3b82f6;animation:ss-vo-pulse .6s infinite;}"
    + "@keyframes ss-vo-pulse{0%,100%{opacity:1}50%{opacity:.35}}"
    + ".ss-vo-transcript{max-height:200px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:4px 0;flex:1;}"
    + "#snapserve-webcall-widget.mode-inline .ss-vo-transcript{max-height:none;}"
    + ".ss-vo-msg{padding:8px 12px;border-radius:12px;font-size:13px;line-height:1.5;max-width:90%;}"
    + ".ss-vo-msg.user{background:#27272a;color:#e4e4e7;align-self:flex-end;border-bottom-right-radius:4px;}"
    + ".ss-vo-msg.agent{background:" + color + "22;color:#d4d4d8;align-self:flex-start;border-bottom-left-radius:4px;border:1px solid " + color + "44;}"
    + ".ss-vo-empty{text-align:center;color:#52525b;font-size:13px;padding:16px 0;}"
    + ".ss-vo-controls{display:flex;gap:8px;}"
    + ".ss-vo-call-btn{flex:1;padding:10px;border:none;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;}"
    + ".ss-vo-call-btn.start{background:" + color + ";color:#fff;}"
    + ".ss-vo-call-btn.end{background:#ef4444;color:#fff;}"
    + ".ss-vo-error{background:#451a1a;border:1px solid #7f1d1d;color:#fca5a5;font-size:12px;padding:8px 10px;border-radius:8px;}";

  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  var widget = document.createElement("div");
  widget.id = "snapserve-webcall-widget";
  widget.className = (inline ? "mode-inline" : "pos-" + pos);
  widget.innerHTML =
    '<div id="ss-vo-panel"' + (inline ? ' class="open"' : "") + ">"
    + '<div class="ss-vo-header"><div class="ss-vo-avatar">🎙️</div><div>'
    + '<div class="ss-vo-agent-name">' + esc(rawName) + "</div>"
    + '<div class="ss-vo-status"><span class="ss-vo-dot" id="ss-vo-dot"></span><span id="ss-vo-status-text">Ready</span></div>'
    + "</div></div>"
    + '<div class="ss-vo-transcript" id="ss-vo-transcript"><div class="ss-vo-empty">Tap Start Call, then speak.</div></div>'
    + '<div id="ss-vo-error" class="ss-vo-error" style="display:none"></div>'
    + '<div class="ss-vo-controls"><button type="button" class="ss-vo-call-btn start" id="ss-vo-action">Start Call</button></div>'
    + "</div>"
    + '<button type="button" id="ss-vo-btn" title="Talk to ' + esc(rawName) + '">'
    + '<svg viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 1 3 3v8a3 3 0 0 1-6 0V4a3 3 0 0 1 3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>'
    + "</button>";
  document.body.appendChild(widget);

  var panel      = document.getElementById("ss-vo-panel");
  var btn        = document.getElementById("ss-vo-btn");
  var dot        = document.getElementById("ss-vo-dot");
  var statusTxt  = document.getElementById("ss-vo-status-text");
  var transcript = document.getElementById("ss-vo-transcript");
  var actionBtn  = document.getElementById("ss-vo-action");
  var errorDiv   = document.getElementById("ss-vo-error");

  var panelOpen = inline;
  var calling = false;
  var ws = null;
  var audioCtx = null;
  var processor = null;
  var stream = null;
  var nextPlayAt = 0;
  var activeSrcs = [];
  var msgCount = 0;
  var audioRate = 16000;

  if (btn) {
    btn.addEventListener("click", function () {
      panelOpen = !panelOpen;
      if (panel) panel.classList.toggle("open", panelOpen);
    });
  }

  function setStatus(status, label) {
    if (dot) dot.className = "ss-vo-dot " + (status || "");
    if (statusTxt) statusTxt.textContent = label || "Ready";
  }

  function showError(msg) {
    if (!errorDiv) return;
    errorDiv.textContent = msg;
    errorDiv.style.display = "block";
    setTimeout(function () { errorDiv.style.display = "none"; }, 7000);
  }

  function addMessage(speaker, text) {
    if (!transcript || !text) return;
    if (msgCount === 0) transcript.innerHTML = "";
    msgCount++;
    var el = document.createElement("div");
    el.className = "ss-vo-msg " + (speaker === "user" ? "user" : "agent");
    el.textContent = text;
    transcript.appendChild(el);
    transcript.scrollTop = transcript.scrollHeight;
  }

  function floatToInt16(f32) {
    var int16 = new Int16Array(f32.length);
    for (var i = 0; i < f32.length; i++) {
      int16[i] = Math.max(-32768, Math.min(32767, f32[i] * 32768));
    }
    return int16;
  }

  function int16ToFloat(buf) {
    var int16 = new Int16Array(buf);
    var f32 = new Float32Array(int16.length);
    for (var i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768;
    return f32;
  }

  function stopAllAudio() {
    activeSrcs.forEach(function (s) { try { s.stop(); } catch (_) {} });
    activeSrcs = [];
    if (audioCtx) nextPlayAt = audioCtx.currentTime;
  }

  function playPCM(arrayBuf) {
    if (!audioCtx) return;
    var f32 = int16ToFloat(arrayBuf);
    var abuf = audioCtx.createBuffer(1, f32.length, audioRate);
    abuf.getChannelData(0).set(f32);
    var src = audioCtx.createBufferSource();
    src.buffer = abuf;
    src.connect(audioCtx.destination);
    var lead = nextPlayAt - audioCtx.currentTime;
    nextPlayAt = lead > 0.12 ? audioCtx.currentTime : Math.max(audioCtx.currentTime + 0.02, nextPlayAt);
    src.start(nextPlayAt);
    nextPlayAt += abuf.duration;
    activeSrcs.push(src);
    src.onended = function () { activeSrcs = activeSrcs.filter(function (s) { return s !== src; }); };
  }

  async function startCall() {
    if (!agentId || !share) {
      showError("This widget is missing its agent embed token. Copy a fresh snippet from SnapServe.");
      return;
    }
    if (!baseUrl) {
      showError("Could not determine SnapServe origin.");
      return;
    }
    try {
      setStatus("thinking", "Connecting…");
      if (actionBtn) actionBtn.disabled = true;

      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
      });

      var wsProto = baseUrl.indexOf("https") === 0 ? "wss" : "ws";
      var host = baseUrl.replace("https://", "").replace("http://", "");
      var wsUrl = wsProto + "://" + host + "/api/ws/webcall/" + encodeURIComponent(agentId)
        + "?share=" + encodeURIComponent(share) + "&rate=16000";
      ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";

      ws.addEventListener("open", function () {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        nextPlayAt = 0;
        var src = audioCtx.createMediaStreamSource(stream);
        processor = audioCtx.createScriptProcessor(2048, 1, 1);
        var sink = audioCtx.createGain();
        sink.gain.value = 0;
        src.connect(processor);
        processor.connect(sink);
        sink.connect(audioCtx.destination);
        processor.onaudioprocess = function (e) {
          if (!calling || !ws || ws.readyState !== WebSocket.OPEN) return;
          var int16 = floatToInt16(e.inputBuffer.getChannelData(0));
          ws.send(int16.buffer);
        };
      });

      ws.addEventListener("message", function (e) {
        if (e.data instanceof ArrayBuffer) {
          playPCM(e.data);
          return;
        }
        try {
          var msg = JSON.parse(e.data);
          if (msg.type === "ready") {
            calling = true;
            if (typeof msg.audioSampleRate === "number" && (msg.audioSampleRate === 8000 || msg.audioSampleRate === 16000)) {
              audioRate = msg.audioSampleRate;
            }
            if (btn) btn.classList.add("active");
            if (actionBtn) {
              actionBtn.disabled = false;
              actionBtn.textContent = "End Call";
              actionBtn.className = "ss-vo-call-btn end";
            }
            setStatus("listening", "Listening…");
          } else if (msg.type === "clear" || msg.type === "interrupted") {
            stopAllAudio();
            setStatus("listening", "Listening…");
          } else if (msg.type === "status") {
            var labels = { idle: "Ready", listening: "Listening…", thinking: "Thinking…", speaking: "Speaking…" };
            setStatus(msg.status, labels[msg.status] || msg.status);
          } else if (msg.type === "transcript") {
            addMessage(msg.speaker, msg.text);
          } else if (msg.type === "notice") {
            showError(msg.message || "Audio notice");
          } else if (msg.type === "call_end" || msg.type === "ended") {
            cleanup("Call ended");
          } else if (msg.type === "error") {
            showError(msg.message || "The call failed.");
            cleanup("Error");
          }
        } catch (_) {}
      });

      ws.addEventListener("close", function () {
        if (calling) cleanup("Disconnected");
        else {
          if (actionBtn) actionBtn.disabled = false;
          setStatus("", "Ready");
        }
      });

      ws.addEventListener("error", function () {
        showError("Could not connect. Check wallet balance and that this embed is still active.");
        cleanup("Error");
      });
    } catch (err) {
      showError("Microphone access denied or unavailable.");
      setStatus("", "Ready");
      if (actionBtn) actionBtn.disabled = false;
    }
  }

  function endCall() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: "end" })); } catch (_) {}
    } else {
      cleanup("Ended");
    }
  }

  function cleanup(statusLabel) {
    calling = false;
    stopAllAudio();
    if (processor) { try { processor.disconnect(); } catch (_) {} processor = null; }
    if (audioCtx) { try { audioCtx.close(); } catch (_) {} audioCtx = null; }
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    if (ws && ws.readyState < 2) { try { ws.close(); } catch (_) {} }
    ws = null;
    if (btn) btn.classList.remove("active");
    if (actionBtn) {
      actionBtn.disabled = false;
      actionBtn.textContent = "Start Call";
      actionBtn.className = "ss-vo-call-btn start";
    }
    setStatus("", statusLabel || "Ready");
  }

  if (actionBtn) {
    actionBtn.addEventListener("click", function () {
      if (!calling) startCall();
      else endCall();
    });
  }

  if (!share || !agentId) {
    showError("Copy the embed snippet from this agent in SnapServe (Settings → Website).");
  }
})();
`;
