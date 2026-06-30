import { Router, type IRouter } from "express";

const router: IRouter = Router();

/**
 * GET /api/widget.js
 * Returns a self-contained embeddable JavaScript widget.
 *
 * Usage:
 *   <script src="https://your-domain/api/widget.js"
 *           data-agent-id="1"
 *           data-name="Support Bot"
 *           data-color="#0ea5e9"
 *           data-position="bottom-right">
 *   </script>
 */
router.get("/widget.js", (req, res): void => {
  const origin = `${req.protocol}://${req.headers["x-forwarded-host"] ?? req.hostname}`;

  const widgetJs = `
(function () {
  "use strict";
  var _script = document.currentScript;
  var _agentId = _script.getAttribute("data-agent-id") || "1";
  var _name    = _script.getAttribute("data-name")     || "AI Assistant";
  var _color   = _script.getAttribute("data-color")    || "#0ea5e9";
  var _pos     = _script.getAttribute("data-position") || "bottom-right";
  var _baseUrl = _script.getAttribute("data-base-url") || ${JSON.stringify(origin)};

  /* ── Styles ──────────────────────────────────────────────────────────── */
  var css = \`
    #voiceorch-widget { position:fixed; z-index:2147483647; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
    #voiceorch-widget.pos-bottom-right { bottom:24px; right:24px; }
    #voiceorch-widget.pos-bottom-left  { bottom:24px; left:24px; }
    #voiceorch-widget.pos-top-right    { top:24px; right:24px; }
    #voiceorch-widget.pos-top-left     { top:24px; left:24px; }

    #vo-btn {
      width:60px; height:60px; border-radius:50%; border:none; cursor:pointer;
      background:\${_color}; color:#fff; display:flex; align-items:center; justify-content:center;
      box-shadow:0 4px 20px rgba(0,0,0,.25); transition:transform .15s,box-shadow .15s;
    }
    #vo-btn:hover { transform:scale(1.08); box-shadow:0 6px 28px rgba(0,0,0,.32); }
    #vo-btn.active { background:#ef4444; }
    #vo-btn svg { width:26px; height:26px; fill:none; stroke:#fff; stroke-width:2; stroke-linecap:round; }

    #vo-panel {
      position:absolute; bottom:72px; right:0; width:320px;
      background:#18181b; border:1px solid #27272a; border-radius:16px;
      padding:20px; box-shadow:0 16px 48px rgba(0,0,0,.5);
      display:none; flex-direction:column; gap:12px;
    }
    #vo-panel.open { display:flex; }
    .vo-header { display:flex; align-items:center; gap:10px; }
    .vo-avatar {
      width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center;
      font-size:16px; flex-shrink:0;
    }
    .vo-agent-name { font-weight:600; color:#f4f4f5; font-size:15px; }
    .vo-status { font-size:12px; color:#a1a1aa; margin-top:1px; }
    .vo-dot { display:inline-block; width:7px; height:7px; border-radius:50%; background:#52525b; margin-right:5px; vertical-align:middle; transition:background .3s; }
    .vo-dot.listening { background:#22c55e; animation:vo-pulse 1.2s infinite; }
    .vo-dot.thinking  { background:#f59e0b; animation:vo-pulse .8s infinite; }
    .vo-dot.speaking  { background:#3b82f6; animation:vo-pulse .6s infinite; }
    @keyframes vo-pulse { 0%,100%{opacity:1} 50%{opacity:.35} }

    .vo-transcript {
      max-height:200px; overflow-y:auto; display:flex; flex-direction:column; gap:8px;
      padding:4px 0; scroll-behavior:smooth;
    }
    .vo-msg { padding:8px 12px; border-radius:12px; font-size:13px; line-height:1.5; max-width:90%; }
    .vo-msg.user  { background:#27272a; color:#e4e4e7; align-self:flex-end; border-bottom-right-radius:4px; }
    .vo-msg.agent { background:\${_color}22; color:#d4d4d8; align-self:flex-start; border-bottom-left-radius:4px; border:1px solid \${_color}44; }
    .vo-empty { text-align:center; color:#52525b; font-size:13px; padding:16px 0; }

    .vo-controls { display:flex; gap:8px; }
    .vo-call-btn {
      flex:1; padding:10px; border:none; border-radius:10px; cursor:pointer; font-size:14px; font-weight:600;
      transition:opacity .15s;
    }
    .vo-call-btn:hover { opacity:.85; }
    .vo-call-btn.start { background:\${_color}; color:#fff; }
    .vo-call-btn.end   { background:#ef4444; color:#fff; }
    .vo-error { background:#451a1a; border:1px solid #7f1d1d; color:#fca5a5; font-size:12px; padding:8px 10px; border-radius:8px; }
  \`;

  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  /* ── DOM ─────────────────────────────────────────────────────────────── */
  var widget = document.createElement("div");
  widget.id = "voiceorch-widget";
  widget.className = "pos-" + _pos;
  widget.innerHTML = \`
    <div id="vo-panel">
      <div class="vo-header">
        <div class="vo-avatar" style="background:\${_color}22;border:1px solid \${_color}44">🤖</div>
        <div>
          <div class="vo-agent-name">\${_name}</div>
          <div class="vo-status"><span class="vo-dot" id="vo-dot"></span><span id="vo-status-text">Ready</span></div>
        </div>
      </div>
      <div class="vo-transcript" id="vo-transcript"><div class="vo-empty">Say something to start a conversation.</div></div>
      <div id="vo-error" class="vo-error" style="display:none"></div>
      <div class="vo-controls">
        <button class="vo-call-btn start" id="vo-action">Start Call</button>
      </div>
    </div>
    <button id="vo-btn" title="Talk to \${_name}">
      <svg viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 1 3 3v8a3 3 0 0 1-6 0V4a3 3 0 0 1 3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
    </button>
  \`;
  document.body.appendChild(widget);

  var panel      = document.getElementById("vo-panel");
  var btn        = document.getElementById("vo-btn");
  var dot        = document.getElementById("vo-dot");
  var statusTxt  = document.getElementById("vo-status-text");
  var transcript = document.getElementById("vo-transcript");
  var actionBtn  = document.getElementById("vo-action");
  var errorDiv   = document.getElementById("vo-error");

  /* ── State ───────────────────────────────────────────────────────────── */
  var panelOpen = false;
  var calling   = false;
  var ws        = null;
  var audioCtx  = null;
  var processor = null;
  var stream    = null;
  var nextPlayAt   = 0;
  var activeSrcs   = [];
  var msgCount     = 0;

  /* ── Toggle panel ────────────────────────────────────────────────────── */
  btn.addEventListener("click", function () {
    panelOpen = !panelOpen;
    panel.classList.toggle("open", panelOpen);
  });

  /* ── Helpers ─────────────────────────────────────────────────────────── */
  function setStatus(status, label) {
    dot.className = "vo-dot " + (status || "");
    statusTxt.textContent = label || "Ready";
  }

  function showError(msg) {
    errorDiv.textContent = msg;
    errorDiv.style.display = "block";
    setTimeout(function () { errorDiv.style.display = "none"; }, 6000);
  }

  function addMessage(speaker, text) {
    if (msgCount === 0) transcript.innerHTML = "";
    msgCount++;
    var el = document.createElement("div");
    el.className = "vo-msg " + speaker;
    el.textContent = text;
    transcript.appendChild(el);
    transcript.scrollTop = transcript.scrollHeight;
  }

  /* ── Float32 → Int16LE ───────────────────────────────────────────────── */
  function floatToInt16(f32) {
    var int16 = new Int16Array(f32.length);
    for (var i = 0; i < f32.length; i++) {
      int16[i] = Math.max(-32768, Math.min(32767, f32[i] * 32768));
    }
    return int16;
  }

  /* ── Int16LE → Float32 ───────────────────────────────────────────────── */
  function int16ToFloat(buf) {
    var int16 = new Int16Array(buf);
    var f32   = new Float32Array(int16.length);
    for (var i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768;
    return f32;
  }

  /* ── Stop all playing audio (barge-in) ──────────────────────────────── */
  function stopAllAudio() {
    activeSrcs.forEach(function(s) { try { s.stop(); } catch(_){} });
    activeSrcs = [];
    if (audioCtx) nextPlayAt = audioCtx.currentTime;
  }

  /* ── Play received PCM chunk ─────────────────────────────────────────── */
  function playPCM(arrayBuf) {
    if (!audioCtx) return;
    var f32    = int16ToFloat(arrayBuf);
    var abuf   = audioCtx.createBuffer(1, f32.length, 16000);
    abuf.getChannelData(0).set(f32);
    var src    = audioCtx.createBufferSource();
    src.buffer = abuf;
    src.connect(audioCtx.destination);
    nextPlayAt = Math.max(audioCtx.currentTime + 0.02, nextPlayAt);
    src.start(nextPlayAt);
    nextPlayAt += abuf.duration;
    activeSrcs.push(src);
    src.onended = function() { activeSrcs = activeSrcs.filter(function(s){ return s !== src; }); };
  }

  /* ── Start call ──────────────────────────────────────────────────────── */
  async function startCall() {
    try {
      setStatus("thinking", "Connecting…");
      actionBtn.disabled = true;

      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, sampleRate: 16000 }
      });

      var wsProto = _baseUrl.startsWith("https") ? "wss" : "ws";
      var wsUrl   = wsProto + "://" + _baseUrl.replace(/^https?:\\/\\//, "") + "/api/ws/webcall/" + _agentId;
      ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";

      ws.addEventListener("open", function () {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        nextPlayAt = 0;

        var src  = audioCtx.createMediaStreamSource(stream);
        processor = audioCtx.createScriptProcessor(2048, 1, 1);
        src.connect(processor);
        processor.connect(audioCtx.destination);

        processor.onaudioprocess = function (e) {
          if (!calling || ws.readyState !== WebSocket.OPEN) return;
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
            btn.classList.add("active");
            actionBtn.disabled = false;
            actionBtn.textContent = "End Call";
            actionBtn.className = "vo-call-btn end";
            setStatus("listening", "Listening…");
          } else if (msg.type === "interrupted") {
            stopAllAudio();
            setStatus("listening", "Listening…");
          } else if (msg.type === "status") {
            var labels = { idle:"Ready", listening:"Listening…", thinking:"Thinking…", speaking:"Speaking…" };
            setStatus(msg.status, labels[msg.status] || msg.status);
          } else if (msg.type === "transcript") {
            addMessage(msg.speaker, msg.text);
          } else if (msg.type === "ended") {
            cleanup("Call ended (" + msg.durationSeconds + "s)");
          } else if (msg.type === "error") {
            showError(msg.message || "An error occurred.");
            cleanup("Error");
          }
        } catch (_) {}
      });

      ws.addEventListener("close", function () {
        if (calling) cleanup("Disconnected");
      });

      ws.addEventListener("error", function () {
        showError("WebSocket connection failed.");
        cleanup("Error");
      });

    } catch (err) {
      showError("Microphone access denied or unavailable.");
      setStatus("", "Ready");
      actionBtn.disabled = false;
    }
  }

  /* ── End call ────────────────────────────────────────────────────────── */
  function endCall() {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "end" }));
    else cleanup("Ended");
  }

  function cleanup(statusLabel) {
    calling = false;
    if (processor) { try { processor.disconnect(); } catch(_){} processor = null; }
    if (audioCtx)  { try { audioCtx.close(); }       catch(_){} audioCtx = null; }
    if (stream)    { stream.getTracks().forEach(function(t){ t.stop(); }); stream = null; }
    if (ws && ws.readyState < 2) { try { ws.close(); } catch(_){} }
    ws = null;
    btn.classList.remove("active");
    actionBtn.disabled = false;
    actionBtn.textContent = "Start Call";
    actionBtn.className = "vo-call-btn start";
    setStatus("", statusLabel || "Ready");
  }

  /* ── Action button ───────────────────────────────────────────────────── */
  actionBtn.addEventListener("click", function () {
    if (!calling) startCall();
    else endCall();
  });

})();
`;

  res
    .set("Content-Type", "application/javascript; charset=utf-8")
    .set("Access-Control-Allow-Origin", "*")
    .set("Cache-Control", "public, max-age=300")
    .send(widgetJs);
});

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
router.get("/widget/lead-capture.js", (req, res): void => {
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
