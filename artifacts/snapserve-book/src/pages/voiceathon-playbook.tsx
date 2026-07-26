import { useEffect } from "react";

export default function VoiceathonPlaybook() {
  useEffect(() => {
    document.title = "SnapServe Voice-athon Playbook";
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-gray-100 font-sans">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        body { font-family: 'Inter', sans-serif; }
        .mono { font-family: 'JetBrains Mono', monospace; }
        .gradient-text {
          background: linear-gradient(135deg, #f97316 0%, #ec4899 50%, #8b5cf6 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .gradient-border {
          background: linear-gradient(135deg, #f97316 0%, #ec4899 50%, #8b5cf6 100%);
          padding: 1px;
          border-radius: 12px;
        }
        .card {
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          padding: 24px;
          transition: border-color 0.2s;
        }
        .card:hover { border-color: rgba(255,255,255,0.16); }
        .pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 12px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.02em;
        }
        .pill-orange { background: rgba(249,115,22,0.15); color: #f97316; border: 1px solid rgba(249,115,22,0.3); }
        .pill-pink { background: rgba(236,72,153,0.15); color: #ec4899; border: 1px solid rgba(236,72,153,0.3); }
        .pill-purple { background: rgba(139,92,246,0.15); color: #a78bfa; border: 1px solid rgba(139,92,246,0.3); }
        .pill-green { background: rgba(34,197,94,0.15); color: #4ade80; border: 1px solid rgba(34,197,94,0.3); }
        .pill-blue { background: rgba(59,130,246,0.15); color: #60a5fa; border: 1px solid rgba(59,130,246,0.3); }
        .pill-yellow { background: rgba(234,179,8,0.15); color: #facc15; border: 1px solid rgba(234,179,8,0.3); }
        .pill-red { background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.3); }
        .code-block {
          background: #0d1117;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          padding: 16px 20px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
          line-height: 1.7;
          overflow-x: auto;
          color: #e2e8f0;
        }
        .code-block .comment { color: #6b7280; }
        .code-block .string { color: #86efac; }
        .code-block .key { color: #93c5fd; }
        .code-block .number { color: #f9a8d4; }
        .code-block .keyword { color: #c4b5fd; }
        .section { padding: 64px 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
        .section:last-child { border-bottom: none; }
        h2 { font-size: 32px; font-weight: 800; margin: 0 0 8px; line-height: 1.2; }
        h3 { font-size: 20px; font-weight: 700; margin: 0 0 12px; }
        h4 { font-size: 15px; font-weight: 600; margin: 0 0 8px; }
        p { margin: 0 0 12px; line-height: 1.7; color: #9ca3af; }
        ul { margin: 0; padding-left: 20px; }
        ul li { margin-bottom: 6px; color: #9ca3af; line-height: 1.6; }
        .nav-dot { width: 6px; height: 6px; border-radius: 50%; background: rgba(249,115,22,0.6); display: inline-block; }
        .divider { height: 1px; background: rgba(255,255,255,0.06); margin: 32px 0; }
        .step-num {
          width: 32px; height: 32px; border-radius: 50%;
          background: linear-gradient(135deg, #f97316, #ec4899);
          display: flex; align-items: center; justify-content: center;
          font-size: 14px; font-weight: 700; flex-shrink: 0;
          color: white;
        }
        .idea-card {
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 10px;
          padding: 20px;
          transition: all 0.2s;
        }
        .idea-card:hover {
          background: rgba(255,255,255,0.05);
          border-color: rgba(255,255,255,0.14);
          transform: translateY(-1px);
        }
        table { width: 100%; border-collapse: collapse; }
        th { font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.08em; padding: 10px 14px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.08); }
        td { padding: 12px 14px; font-size: 14px; color: #d1d5db; border-bottom: 1px solid rgba(255,255,255,0.04); vertical-align: top; }
        tr:last-child td { border-bottom: none; }
        .trophy { font-size: 28px; }
        .feature-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
        .feature-item {
          display: flex; gap: 12px; align-items: flex-start;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 8px; padding: 14px;
        }
        .feature-icon { font-size: 20px; flex-shrink: 0; margin-top: 1px; }
        .track-header {
          display: flex; align-items: center; gap: 12px;
          margin-bottom: 16px; padding-bottom: 16px;
          border-bottom: 1px solid rgba(255,255,255,0.07);
        }
        .track-icon { font-size: 28px; }
        .note-box {
          background: rgba(249,115,22,0.08);
          border: 1px solid rgba(249,115,22,0.2);
          border-radius: 8px;
          padding: 14px 18px;
          font-size: 14px;
          color: #fdba74;
        }
        .info-box {
          background: rgba(59,130,246,0.08);
          border: 1px solid rgba(59,130,246,0.2);
          border-radius: 8px;
          padding: 14px 18px;
          font-size: 14px;
          color: #93c5fd;
        }
        .winner-box {
          background: linear-gradient(135deg, rgba(249,115,22,0.08), rgba(139,92,246,0.08));
          border: 1px solid rgba(249,115,22,0.2);
          border-radius: 10px;
          padding: 20px 24px;
        }
        @media (max-width: 768px) {
          h2 { font-size: 24px; }
          .feature-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      {/* ── Hero ──────────────────────────────────────────────── */}
      <div style={{
        background: "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(249,115,22,0.15) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 80% 80%, rgba(139,92,246,0.1) 0%, transparent 50%)",
        padding: "80px 24px 64px",
        textAlign: "center",
        position: "relative",
        overflow: "hidden",
      }}>
        {/* background grid */}
        <div style={{
          position: "absolute", inset: 0, opacity: 0.06,
          backgroundImage: "linear-gradient(rgba(255,255,255,.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.4) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }} />

        <div style={{ position: "relative", maxWidth: 760, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
            <span className="pill pill-orange">🎙️ Voice-athon</span>
            <span className="pill pill-purple">Official Participant Playbook</span>
          </div>

          <h1 style={{ fontSize: "clamp(36px, 6vw, 60px)", fontWeight: 900, lineHeight: 1.1, margin: "0 0 20px" }}>
            Build the Future of<br/>
            <span className="gradient-text">Voice Intelligence</span>
          </h1>

          <p style={{ fontSize: 18, color: "#9ca3af", maxWidth: 580, margin: "0 auto 32px", lineHeight: 1.7 }}>
            Everything you need to go from zero to a live AI voice agent in under 30 minutes — and win.
          </p>

          <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
            <span className="pill pill-green">✓ Real phone calls</span>
            <span className="pill pill-blue">✓ 10+ LLMs</span>
            <span className="pill pill-pink">✓ Indian languages</span>
            <span className="pill pill-yellow">✓ Persistent memory</span>
            <span className="pill pill-purple">✓ Multi-agent squads</span>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 24px" }}>

        {/* ── Table of Contents ─────────────────────────────── */}
        <div className="section" style={{ paddingTop: 48 }}>
          <div className="card" style={{ background: "rgba(249,115,22,0.04)", borderColor: "rgba(249,115,22,0.15)" }}>
            <h3 style={{ color: "#f97316", marginBottom: 20 }}>📋 What's Inside</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "8px 24px" }}>
              {[
                ["01", "What is SnapServe?"],
                ["02", "The Full Capability Map"],
                ["03", "Your Toolkit (APIs + Tools)"],
                ["04", "Project Ideas by Track"],
                ["05", "Hello World in 5 Min"],
                ["06", "API Reference"],
                ["07", "Power Features"],
                ["08", "Judging Criteria"],
                ["09", "Winning Strategies"],
                ["10", "Resources & Support"],
              ].map(([num, label]) => (
                <div key={num} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0" }}>
                  <span className="mono" style={{ color: "#f97316", fontSize: 12, fontWeight: 600 }}>{num}</span>
                  <span style={{ color: "#d1d5db", fontSize: 14 }}>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── 01. What is SnapServe ─────────────────────────── */}
        <div className="section">
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <span className="pill pill-orange">01</span>
            <span style={{ color: "#6b7280", fontSize: 14 }}>Foundation</span>
          </div>
          <h2>What is SnapServe?</h2>
          <p style={{ fontSize: 16, marginBottom: 32 }}>
            SnapServe is India's voice AI orchestration platform. It wires together Speech-to-Text, Large Language Models, and Text-to-Speech
            into real-time phone conversations — with persistent memory, multilingual support, and TRAI/DPDP compliance baked in.
          </p>

          {/* Pipeline diagram */}
          <div style={{
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12, padding: "24px", marginBottom: 32
          }}>
            <p style={{ color: "#6b7280", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 16 }}>
              The Orchestration Pipeline
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {[
                { label: "Caller", color: "#f97316", emoji: "📞" },
                { label: "→" },
                { label: "STT", sublabel: "Deepgram / Sarvam / Azure", color: "#3b82f6", emoji: "🎙️" },
                { label: "→" },
                { label: "LLM", sublabel: "GPT / Claude / Gemini / Llama", color: "#8b5cf6", emoji: "🧠" },
                { label: "→" },
                { label: "TTS", sublabel: "ElevenLabs / Cartesia / Sarvam", color: "#ec4899", emoji: "🔊" },
                { label: "→" },
                { label: "Caller", color: "#f97316", emoji: "📞" },
              ].map((item, i) => (
                <div key={i}>
                  {item.sublabel ? (
                    <div style={{
                      background: `rgba(${item.color === "#3b82f6" ? "59,130,246" : item.color === "#8b5cf6" ? "139,92,246" : "236,72,153"},0.12)`,
                      border: `1px solid rgba(${item.color === "#3b82f6" ? "59,130,246" : item.color === "#8b5cf6" ? "139,92,246" : "236,72,153"},0.25)`,
                      borderRadius: 8, padding: "10px 16px", textAlign: "center"
                    }}>
                      <div style={{ fontSize: 20, marginBottom: 4 }}>{item.emoji}</div>
                      <div style={{ color: item.color, fontWeight: 700, fontSize: 14 }}>{item.label}</div>
                      <div style={{ color: "#6b7280", fontSize: 11, marginTop: 2 }}>{item.sublabel}</div>
                    </div>
                  ) : item.label === "→" ? (
                    <span style={{ color: "#374151", fontSize: 20, fontWeight: 300 }}>→</span>
                  ) : (
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 20, marginBottom: 4 }}>{item.emoji}</div>
                      <div style={{ color: item.color, fontWeight: 700, fontSize: 14 }}>{item.label}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="divider" />
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <div>
                <span style={{ color: "#6b7280", fontSize: 12 }}>Round-trip latency</span>
                <div style={{ color: "#4ade80", fontWeight: 700 }}>&lt; 1 second</div>
              </div>
              <div>
                <span style={{ color: "#6b7280", fontSize: 12 }}>Languages</span>
                <div style={{ color: "#60a5fa", fontWeight: 700 }}>10+ incl. Tamil, Hindi, Hinglish</div>
              </div>
              <div>
                <span style={{ color: "#6b7280", fontSize: 12 }}>Memory</span>
                <div style={{ color: "#c4b5fd", fontWeight: 700 }}>Persists across ALL calls</div>
              </div>
              <div>
                <span style={{ color: "#6b7280", fontSize: 12 }}>Compliance</span>
                <div style={{ color: "#f9a8d4", fontWeight: 700 }}>TRAI · DPDP · IRDAI ready</div>
              </div>
            </div>
          </div>

          <div className="note-box">
            <strong>Think of SnapServe as your voice-call backend.</strong> You focus on what the agent says and does —
            SnapServe handles the telephony plumbing, real-time audio streaming, provider failover, billing, and memory storage.
          </div>
        </div>

        {/* ── 02. Capability Map ────────────────────────────── */}
        <div className="section">
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <span className="pill pill-purple">02</span>
            <span style={{ color: "#6b7280", fontSize: 14 }}>Platform</span>
          </div>
          <h2>The Full Capability Map</h2>
          <p>Every lever you can pull to build your project. Nothing is off-limits.</p>

          <div className="feature-grid" style={{ marginTop: 24 }}>
            {[
              { icon: "📞", title: "Outbound Calls", desc: "Trigger real calls via API. Single number or bulk campaigns." },
              { icon: "📥", title: "Inbound Calls", desc: "Assign a phone number to an agent. Callers are answered live." },
              { icon: "🧠", title: "Persistent Memory", desc: "Agent remembers the caller's name, preferences, past issues — forever." },
              { icon: "📚", title: "Knowledge Base", desc: "Upload PDFs, websites, or text. Agent uses RAG to answer grounded questions." },
              { icon: "📅", title: "In-call Booking", desc: "Agent books, reschedules, cancels appointments on Google Calendar live on the call." },
              { icon: "🤝", title: "Multi-agent Squads", desc: "Supervisor agent hands off to specialist agents mid-call or for follow-ups." },
              { icon: "📊", title: "Campaign Engine", desc: "Upload a CSV or send a webhook — auto-dials a list with retry logic." },
              { icon: "🌐", title: "Website Leads", desc: "Embed a snippet on any website; form submissions trigger instant calls." },
              { icon: "💬", title: "WhatsApp", desc: "Two-way WhatsApp messaging wired to the same agent logic." },
              { icon: "📋", title: "Disposition Engine", desc: "Auto-categorize every call outcome with a custom taxonomy using AI." },
              { icon: "📝", title: "Google Sheets Sync", desc: "Pull leads from Sheets, write call outcomes back automatically." },
              { icon: "🎭", title: "Voice Cloning", desc: "Use a cloned voice (Cartesia/ElevenLabs) to give your agent a branded sound." },
              { icon: "🔗", title: "Custom Webhook Tools", desc: "Agent calls your external APIs mid-conversation to fetch or post live data." },
              { icon: "📡", title: "Real-time Events", desc: "Receive call.started / call.completed webhooks with full transcripts." },
              { icon: "🌍", title: "Multilingual", desc: "Detect and respond in Tamil, Hindi, Kannada, Hinglish, Telugu, and more." },
              { icon: "⚡", title: "Gemini Live", desc: "Native realtime audio with Gemini — zero round-trip STT/TTS overhead." },
              { icon: "🖥️", title: "Browser Webcall", desc: "Test any agent directly from the dashboard without using a phone." },
              { icon: "📱", title: "SMS Tool", desc: "Agent can send follow-up SMS messages mid-call via the send_sms tool." },
              { icon: "🔒", title: "DPDP / TRAI", desc: "Consent recording, DNC checking, TRAI calling-hours enforcement built in." },
              { icon: "📈", title: "Usage Analytics", desc: "Per-call latency breakdown: STT ms · LLM ms · TTS ms. Full transcripts." },
            ].map((f) => (
              <div key={f.title} className="feature-item">
                <span className="feature-icon">{f.icon}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#f3f4f6", marginBottom: 3 }}>{f.title}</div>
                  <div style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.5 }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── 03. Your Toolkit ─────────────────────────────── */}
        <div className="section">
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <span className="pill pill-blue">03</span>
            <span style={{ color: "#6b7280", fontSize: 14 }}>Access</span>
          </div>
          <h2>Your Toolkit</h2>
          <p>Everything you get as a Voice-athon participant.</p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16, marginTop: 24, marginBottom: 32 }}>
            {[
              {
                title: "REST API", icon: "⚡",
                items: ["API key: sk_live_••••••••", "Base URL: https://api.snapserve.ai", "Full CRUD on agents, calls, campaigns", "Webhook events with HMAC signatures"],
                color: "#f97316",
              },
              {
                title: "Dashboard (No-code)", icon: "🎛️",
                items: ["Visual agent builder", "Campaign wizard", "Live call monitor", "Transcript + recording viewer"],
                color: "#8b5cf6",
              },
              {
                title: "AI Providers (Managed)", icon: "🧠",
                items: ["OpenAI GPT-4.1 / 4o-mini", "Anthropic Claude 3.5 Sonnet", "Gemini 2.0 Flash / Live", "Groq Llama 3.3 70B (fastest)", "Krutrim, Sarvam, DeepSeek"],
                color: "#3b82f6",
              },
              {
                title: "Voice Stack", icon: "🔊",
                items: ["ElevenLabs Rachel + custom", "Cartesia + voice cloning", "Sarvam Bulbul v3 (38 Indian voices)", "OpenAI TTS (alloy, nova, shimmer…)", "Azure Neural voices"],
                color: "#ec4899",
              },
            ].map((t) => (
              <div key={t.title} className="card" style={{ borderColor: `rgba(${t.color === "#f97316" ? "249,115,22" : t.color === "#8b5cf6" ? "139,92,246" : t.color === "#3b82f6" ? "59,130,246" : "236,72,153"},0.2)` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                  <span style={{ fontSize: 22 }}>{t.icon}</span>
                  <h4 style={{ margin: 0, color: "#f3f4f6" }}>{t.title}</h4>
                </div>
                <ul>
                  {t.items.map(i => <li key={i} style={{ fontSize: 13 }}>{i}</li>)}
                </ul>
              </div>
            ))}
          </div>

          {/* Provider table */}
          <h3>Provider Menu — choose your stack</h3>
          <div style={{ overflow: "auto", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", marginTop: 16 }}>
            <table>
              <thead>
                <tr>
                  <th>Layer</th>
                  <th>Provider</th>
                  <th>Best For</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["STT", "Deepgram Nova-2", "English, low latency", "Streaming, recommended default"],
                  ["STT", "Sarvam Saaras v3", "Indian languages", "Tamil, Hindi, Kannada, Marathi…"],
                  ["STT", "Azure Cognitive", "Multi-language + LID", "Live language detection mid-call"],
                  ["LLM", "Groq Llama 3.3 70B", "Fastest responses", "Best TTFT for real-time feel"],
                  ["LLM", "OpenAI GPT-4.1", "Complex reasoning", "Tool use, structured outputs"],
                  ["LLM", "Claude 3.5 Sonnet", "Long context, safety", "Best at following instructions"],
                  ["LLM", "Gemini Live", "Native realtime audio", "No STT/TTS round-trip at all"],
                  ["LLM", "Sarvam-30B / 105B", "Indic languages", "Native Hindi/Tamil reasoning"],
                  ["LLM", "Krutrim gpt-oss-20B", "India-hosted", "Low latency on Indian traffic"],
                  ["TTS", "Cartesia", "Ultra-low latency", "Best for English, voice cloning"],
                  ["TTS", "Sarvam Bulbul v3", "Indian voices", "38 voices: Hindi, Tamil, Kannada…"],
                  ["TTS", "ElevenLabs", "Highest quality / cloning", "Broadcast-grade naturalness"],
                  ["Telephony", "VoBiz", "Indian numbers", "Primary for India calls"],
                  ["Telephony", "Twilio", "Global / testing", "Widest coverage"],
                  ["Telephony", "Plivo", "Cost-optimised", "Good for high-volume campaigns"],
                ].map(([layer, prov, best, notes]) => (
                  <tr key={prov}>
                    <td><span className={`pill ${layer === "STT" ? "pill-blue" : layer === "LLM" ? "pill-purple" : layer === "TTS" ? "pill-pink" : "pill-orange"}`} style={{ fontSize: 11 }}>{layer}</span></td>
                    <td style={{ fontWeight: 500, color: "#f3f4f6" }}>{prov}</td>
                    <td style={{ color: "#9ca3af" }}>{best}</td>
                    <td style={{ color: "#6b7280", fontSize: 13 }}>{notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── 04. Project Ideas ─────────────────────────────── */}
        <div className="section">
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <span className="pill pill-pink">04</span>
            <span style={{ color: "#6b7280", fontSize: 14 }}>Inspiration</span>
          </div>
          <h2>Project Ideas by Track</h2>
          <p>
            Difficulty: <span className="pill pill-green" style={{ padding: "2px 8px", fontSize: 11 }}>Starter</span>{" "}
            <span className="pill pill-yellow" style={{ padding: "2px 8px", fontSize: 11 }}>Intermediate</span>{" "}
            <span className="pill pill-red" style={{ padding: "2px 8px", fontSize: 11 }}>Advanced</span>
          </p>

          {[
            {
              icon: "🏥", track: "Healthcare & Wellness",
              color: "#22c55e",
              ideas: [
                { title: "Medicine Reminder Bot", diff: "Starter", desc: "Calls patients daily at their preferred time. Agent asks 'Did you take your morning insulin?' Remembers adherence history. Escalates to a family number after 2 missed days.", features: ["Persistent memory", "Campaign scheduling", "Transfer tool"] },
                { title: "Post-discharge Follow-up", diff: "Intermediate", desc: "Hospitals upload discharge CSV. Agent calls each patient on Day 1, 3, 7. Asks PROMIS-5 questions. Flags abnormal responses via webhook to nursing dashboard.", features: ["CSV campaigns", "Disposition engine", "Outbound webhooks"] },
                { title: "Mental Health Check-in", diff: "Intermediate", desc: "Weekly scheduled calls in the patient's native language. Tracks PHQ-2 score over time using persistent memory. Routes to crisis line if score crosses threshold.", features: ["Memory", "Multilingual", "Squad handoff"] },
                { title: "Chronic Disease Daily Tracker", diff: "Advanced", desc: "BP/sugar logging via voice. Agent collects readings, logs to Google Sheets, uses KB with medical guidelines to give personalised advice. Alerts doctor webhook on danger values.", features: ["Knowledge Base", "Google Sheets", "Custom webhook tool"] },
              ]
            },
            {
              icon: "🏦", track: "BFSI — Banking, Finance & Insurance",
              color: "#3b82f6",
              ideas: [
                { title: "EMI Payment Reminder", diff: "Starter", desc: "Calls borrowers 3 days before due date, 1 day before, and on the day. Uses persistent memory to personalise: 'Hi Priya, your ₹12,400 EMI is due tomorrow.' Skips if already paid (CRM webhook check).", features: ["Campaign with retry", "Memory", "Webhook tool"] },
                { title: "Insurance Renewal Agent", diff: "Intermediate", desc: "Calls policyholders 30 days before expiry. KB loaded with policy details. Agent answers premium questions, books callback for underwriter, or takes soft commitment. Writes outcome to Sheets.", features: ["Knowledge Base", "Scheduling", "Google Sheets"] },
                { title: "Loan Pre-qualification", diff: "Intermediate", desc: "Website form triggers instant call within 60 seconds of inquiry. Agent collects income, employment, loan purpose. Scores the lead via webhook to credit engine. Routes hot leads to RM.", features: ["From Website (instant)", "Webhook tool", "Transfer"] },
                { title: "Voice KYC Assistant", diff: "Advanced", desc: "Guides customer through a KYC script in their language. Collects Aadhaar, PAN verbally. Webhook calls KYC provider API for liveness. Writes verified/failed outcome to admin dashboard.", features: ["Multilingual", "Custom tools", "Webhook tool"] },
              ]
            },
            {
              icon: "🛒", track: "E-commerce & Retail",
              color: "#f97316",
              ideas: [
                { title: "Delivery Confirmation + Rescheduling", diff: "Starter", desc: "Calls customer when order is out for delivery. 'Your Myntra order arrives in 2 hours — will you be home?' If no, books a redelivery slot via in-call booking tool.", features: ["Outbound call", "Native booking"] },
                { title: "Cart Abandonment Rescue", diff: "Starter", desc: "Website embed triggers instant call within 30 min of cart abandonment. Agent asks why they didn't complete. Offers discount code. Posts outcome to CRM webhook.", features: ["From Website", "Instant trigger", "Webhook tool"] },
                { title: "Post-delivery NPS Collector", diff: "Intermediate", desc: "Campaign fires 48h after delivery scan. Agent collects star rating, open feedback in any language. Disposition engine auto-routes 1–2 stars to escalation queue, 4–5 to review-request SMS.", features: ["Campaign", "Multilingual", "Disposition"] },
                { title: "Returns Concierge", diff: "Intermediate", desc: "Inbound number on the returns page. Agent confirms order, explains return policy from KB, schedules pickup slot, triggers reverse-logistics webhook. Zero human touch.", features: ["Inbound", "Knowledge Base", "Booking", "Webhook"] },
              ]
            },
            {
              icon: "🏫", track: "Education & Ed-Tech",
              color: "#8b5cf6",
              ideas: [
                { title: "Fee Payment Reminder", diff: "Starter", desc: "Monthly campaign to parents. Agent greets by student name (from CSV), states balance, offers payment link via SMS. Logs paid/deferred to Sheets.", features: ["CSV campaign", "Send SMS tool", "Sheets"] },
                { title: "Exam Result Communicator", diff: "Starter", desc: "Upload marks CSV. Agent calls each student, speaks their subject-wise scores, congratulates or encourages, offers re-exam booking.", features: ["CSV campaign", "Memory", "Booking"] },
                { title: "Student Retention Bot", diff: "Intermediate", desc: "Identifies students who haven't logged in for 7 days (webhook from LMS). Calls them. Agent is empathetic, asks about blockers. Logs reasons. Offers to schedule a mentoring session.", features: ["Webhook trigger", "Booking", "Disposition"] },
                { title: "Parent-Teacher Coordinator", diff: "Advanced", desc: "Squad: Scheduler agent books PTM slots. Reminder agent calls 24h before. Feedback agent calls after PTM. Memory links parent, teacher, and student across all three interactions.", features: ["Squad", "Scheduling", "Memory", "Multi-agent"] },
              ]
            },
            {
              icon: "🏠", track: "Real Estate",
              color: "#ec4899",
              ideas: [
                { title: "Property Inquiry Qualifier", diff: "Starter", desc: "Website lead form triggers instant call. Agent asks budget, location, BHK preference. Logs qualified leads to Sheets, transfers hot leads to sales agent.", features: ["From Website", "Instant call", "Transfer", "Sheets"] },
                { title: "Site Visit Scheduler", diff: "Intermediate", desc: "Nurture campaign for cold leads. Agent reactivates interest, handles objections using KB (locality, amenities, pricing FAQs), books site visit on builder calendar.", features: ["Campaign", "Knowledge Base", "Native booking"] },
                { title: "Tenant Rent Reminder", diff: "Starter", desc: "Monthly auto-campaign to tenants. Agent speaks rent amount in tenant's language, confirms receipt or escalates overdue, logs outcome.", features: ["Campaign", "Multilingual", "Memory"] },
                { title: "Builder Launch Outreach", diff: "Intermediate", desc: "New project launch: blast campaign to prospect list. Agent delivers personalised pitch. Handles 5 common objections (from KB). Books callbacks or site visits.", features: ["Campaign", "KB", "Booking", "Disposition"] },
              ]
            },
            {
              icon: "🧑‍💼", track: "HR & Recruitment",
              color: "#facc15",
              ideas: [
                { title: "Interview Scheduler", diff: "Starter", desc: "ATS webhook triggers call to shortlisted candidate. Agent confirms interest, asks availability, books interview slot on company calendar. Logs confirmation to ATS webhook.", features: ["Webhook trigger", "Booking", "Outbound webhook"] },
                { title: "AI Screening Agent", diff: "Intermediate", desc: "Agent conducts 5-min screening: asks about experience, notice period, CTC expectations, role fit. Disposition engine scores the call. Exports to Sheets.", features: ["Knowledge Base", "Disposition", "Sheets"] },
                { title: "Onboarding Concierge", diff: "Intermediate", desc: "Day 1 buddy: calls new hire morning of joining. Answers KB-grounded questions about parking, dress code, first day schedule. Collects document submission status.", features: ["Inbound + Outbound", "KB", "Memory"] },
                { title: "Squad: End-to-End Hiring", diff: "Advanced", desc: "Squad of 3: Sourcing agent qualifies. Scheduling agent books interviews. Offer agent handles negotiations. All share memory about the candidate.", features: ["Squad", "Memory", "Multi-agent", "Booking"] },
              ]
            },
            {
              icon: "🍽️", track: "Hospitality & Events",
              color: "#06b6d4",
              ideas: [
                { title: "Reservation Reminder", diff: "Starter", desc: "Restaurant campaign: calls guests 2h before reservation. Confirms headcount, notes allergies, offers early arrival. Logs no-shows for table release.", features: ["Campaign", "Memory", "Disposition"] },
                { title: "Post-stay Feedback", diff: "Starter", desc: "Hotel checkout triggers campaign. Agent collects NPS + open-ended feedback. Disposition routes bad experiences to GM, good ones to review request SMS.", features: ["Campaign", "Multilingual", "Send SMS"] },
                { title: "Event RSVP + Logistics Bot", diff: "Intermediate", desc: "Conference or wedding: calls invitees. Collects attendance, meal preference, travel mode. Answers event FAQ (from KB). Sends confirmation SMS. Logs full roster.", features: ["Campaign", "KB", "SMS", "Sheets"] },
                { title: "Hotel Upsell Concierge", diff: "Intermediate", desc: "Calls guests day before check-in. Offers spa, early check-in, airport transfer. Agent handles acceptance or rejection, books via tool, charges extra to folio webhook.", features: ["Campaign", "Booking", "Webhook tool"] },
              ]
            },
            {
              icon: "⚡", track: "Developer / API Track",
              color: "#a78bfa",
              ideas: [
                { title: "Voice-Activated CRM", diff: "Starter", desc: "Simple app: call your CRM. 'Tell me Priya's last 3 interactions.' Agent fetches via webhook tool, speaks the answer, lets you dictate a new note.", features: ["Inbound", "Webhook tool", "Memory"] },
                { title: "Voice Analytics Dashboard", diff: "Intermediate", desc: "Pull call transcripts and latency data from the API. Build a Next.js dashboard with sentiment trend, topic clustering, average handle time, and disposition breakdown.", features: ["Calls API", "Disposition API", "Data viz"] },
                { title: "Multilingual IVR Replacement", diff: "Intermediate", desc: "Replace 'Press 1 for Hindi' with a natural-language router. Caller says their issue; language detection + intent extraction routes to right specialist agent in their tongue.", features: ["Inbound", "Multilingual", "Squad handoff"] },
                { title: "Memory Proxy API Wrapper", diff: "Advanced", desc: "Build a drop-in wrapper for Vapi/Retell/Bolna. Intercept their call events, write facts to SnapServe memory, inject them back at call start. Sell memory-as-a-service.", features: ["Memory API", "Webhooks", "External integration"] },
                { title: "WhatsApp → Voice Bridge", diff: "Advanced", desc: "User types a query on WhatsApp; if complex, agent offers a voice callback. Click-to-call flow triggers an outbound call, answers the question, posts summary back to WhatsApp.", features: ["WhatsApp", "Outbound call", "Memory", "Webhook"] },
              ]
            },
            {
              icon: "🌱", track: "Social Impact / Gov-Tech",
              color: "#4ade80",
              ideas: [
                { title: "Scheme Awareness Campaign", diff: "Starter", desc: "Government welfare campaign: calls beneficiary list, explains eligibility in their regional language, answers FAQ from KB, books enrollment appointment.", features: ["CSV campaign", "Multilingual", "KB", "Booking"] },
                { title: "Farmer Advisory Helpline", diff: "Intermediate", desc: "Inbound number for farmers. Agent answers crop, weather, and market price questions grounded in KB. Remembers each farmer's crops and location. Follows up with advisory calls.", features: ["Inbound", "KB", "Memory", "Multilingual"] },
                { title: "Emergency Contact Blast", diff: "Starter", desc: "Upload list of residents in disaster zone. Campaign calls all within minutes. Agent confirms safety status, collects location of stranded residents, logs to Sheets.", features: ["Campaign", "Sheets", "Instant trigger"] },
                { title: "Tax Filing Reminder", diff: "Starter", desc: "CA firm campaign to clients. Agent calls each, mentions their specific deadline and last year's filing date (from memory), offers to book a call with the CA.", features: ["Campaign", "Memory", "Booking"] },
              ]
            },
          ].map((track) => (
            <div key={track.track} style={{ marginBottom: 40 }}>
              <div className="track-header">
                <span className="track-icon">{track.icon}</span>
                <div>
                  <h3 style={{ margin: 0, color: "#f3f4f6" }}>{track.track}</h3>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 12 }}>
                {track.ideas.map((idea) => (
                  <div key={idea.title} className="idea-card">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                      <h4 style={{ margin: 0, color: "#f3f4f6", fontSize: 15 }}>{idea.title}</h4>
                      <span className={`pill ${idea.diff === "Starter" ? "pill-green" : idea.diff === "Intermediate" ? "pill-yellow" : "pill-red"}`} style={{ fontSize: 11, flexShrink: 0, marginLeft: 8 }}>
                        {idea.diff}
                      </span>
                    </div>
                    <p style={{ fontSize: 13, marginBottom: 12 }}>{idea.desc}</p>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {idea.features.map(f => (
                        <span key={f} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: "rgba(255,255,255,0.06)", color: "#9ca3af", border: "1px solid rgba(255,255,255,0.08)" }}>{f}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* ── 05. Hello World ────────────────────────────────── */}
        <div className="section">
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <span className="pill pill-green">05</span>
            <span style={{ color: "#6b7280", fontSize: 14 }}>Quick Start</span>
          </div>
          <h2>Hello World in 5 Minutes</h2>
          <p>Make your first live AI phone call with three API calls.</p>

          <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 28 }}>
            {[
              {
                step: 1,
                title: "Create your Agent",
                desc: "Define who the agent is, what language it speaks, and which providers to use.",
                code: `curl -X POST https://api.snapserve.ai/api/agents \\
  -H "Authorization: Bearer sk_live_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
  "name": "Priya - Appointment Agent",
  "systemPrompt": "You are Priya, a warm and helpful appointment coordinator for City Clinic. Your goal is to help patients reschedule or book appointments. Always confirm the patient\\'s name before proceeding.",
  "greetingMessage": "Namaste! Main Priya bol rahi hoon City Clinic se. Kya aap apna appointment book karna chahenge?",
  "llmProvider": "groq",
  "llmModel": "llama-3.3-70b-versatile",
  "ttsProvider": "sarvam",
  "asrProvider": "sarvam",
  "asrLanguage": "hi-IN",
  "tools": [{"type": "native_booking"}, {"type": "end_call"}]
}'`,
              },
              {
                step: 2,
                title: "Make the Call",
                desc: "Trigger a live outbound call using the agent ID from Step 1.",
                code: `curl -X POST https://api.snapserve.ai/api/calls/outbound \\
  -H "Authorization: Bearer sk_live_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
  "agentId": 42,
  "toNumber": "+919876543210"
}'

# Response:
# { "id": 1001, "status": "ringing", "toNumber": "+919876543210" }`,
              },
              {
                step: 3,
                title: "Receive the Transcript",
                desc: "Set a webhookUrl on your agent. SnapServe POSTs this payload when the call ends.",
                code: `// Payload received at your webhook endpoint:
{
  "event": "call.completed",
  "timestamp": "2026-07-26T10:30:00Z",
  "data": {
    "id": 1001,
    "status": "booked",
    "durationSeconds": 87,
    "transcript": "Agent: Namaste! Main Priya...\\nCaller: Haan, appointment chahiye...",
    "agentName": "Priya - Appointment Agent",
    "toNumber": "+919876543210"
  }
}`,
              },
            ].map(({ step, title, desc, code }) => (
              <div key={step} style={{ display: "flex", gap: 16 }}>
                <div style={{ flexShrink: 0, paddingTop: 2 }}>
                  <div className="step-num">{step}</div>
                </div>
                <div style={{ flex: 1 }}>
                  <h4 style={{ color: "#f3f4f6" }}>{title}</h4>
                  <p style={{ marginBottom: 12 }}>{desc}</p>
                  <div className="code-block">{code}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="divider" />

          <h3>Or — Use the Dashboard (No Code)</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10, marginTop: 16 }}>
            {[
              ["1", "Login → Agents → + New"],
              ["2", "Pick LLM + TTS + language"],
              ["3", "Write a system prompt"],
              ["4", "Click 'Test in Browser'"],
              ["5", "Talk to your agent live"],
              ["6", "Iterate on the prompt"],
            ].map(([n, text]) => (
              <div key={n} style={{ display: "flex", gap: 10, alignItems: "center", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "12px" }}>
                <span style={{ color: "#f97316", fontWeight: 700, fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>{n}</span>
                <span style={{ color: "#d1d5db", fontSize: 13 }}>{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── 06. API Reference ─────────────────────────────── */}
        <div className="section">
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <span className="pill pill-yellow">06</span>
            <span style={{ color: "#6b7280", fontSize: 14 }}>Reference</span>
          </div>
          <h2>API Reference</h2>
          <p>The essential endpoints. All routes are under <code className="mono" style={{ background: "rgba(255,255,255,0.08)", padding: "2px 6px", borderRadius: 4, color: "#93c5fd" }}>https://api.snapserve.ai/api</code> with Bearer auth.</p>

          <div style={{ overflow: "auto", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", marginTop: 20 }}>
            <table>
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Endpoint</th>
                  <th>What it does</th>
                  <th>Key params</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["POST", "/agents", "Create a voice agent", "name, systemPrompt, llmProvider, ttsProvider, tools[]"],
                  ["PATCH", "/agents/:id", "Update agent config", "Any field; partial update OK"],
                  ["POST", "/calls/outbound", "Trigger one outbound call", "agentId, toNumber"],
                  ["GET", "/calls/:id", "Get call + transcript", "Returns status, transcript, recording"],
                  ["PATCH", "/calls/:id/end", "Forcefully end a live call", "—"],
                  ["POST", "/campaigns", "Create a campaign", "agentId, leadSource, triggerMode, maxAttempts"],
                  ["POST", "/campaigns/:id/import-leads", "Upload leads (CSV or JSON)", "Multipart CSV or JSON array"],
                  ["POST", "/campaigns/:webhook-token/leads", "Inject a lead via webhook URL", "phone + any extra fields"],
                  ["GET", "/campaigns/:id/leads", "List all leads + status", "Pagination: page, limit"],
                  ["GET", "/agents/:id/memory/facts", "Get caller memory for a number", "phoneNumber query param"],
                  ["GET", "/wallet", "Check credit balance", "Returns balanceCents"],
                  ["GET", "/billing/rates", "Get per-minute rates", "By provider + plan type"],
                  ["POST", "/knowledge-sources", "Add KB entry (text/URL/FAQ)", "type, title, content or url"],
                  ["POST", "/knowledge-sources/upload", "Upload PDF/DOCX to KB", "Multipart file"],
                  ["POST", "/squads", "Create a multi-agent squad", "name, members[], supervisorAgentId"],
                  ["POST", "/squads/:id/runs", "Run a squad on a task", "kind, goal, agentId or toNumber"],
                ].map(([method, path, desc, params]) => (
                  <tr key={path}>
                    <td>
                      <span className={`pill ${method === "POST" ? "pill-green" : method === "PATCH" ? "pill-yellow" : "pill-blue"}`} style={{ fontSize: 11 }}>{method}</span>
                    </td>
                    <td className="mono" style={{ color: "#93c5fd", fontSize: 13 }}>{path}</td>
                    <td>{desc}</td>
                    <td style={{ color: "#6b7280", fontSize: 12 }}>{params}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="divider" />

          <h3 style={{ marginBottom: 12 }}>Webhook Lead Injection — Instant Calls from Anywhere</h3>
          <p>Every campaign has a unique URL. POST a JSON body to it — agent calls the number within seconds.</p>
          <div className="code-block">{`# The campaign's webhookToken is returned when you create it
POST https://api.snapserve.ai/api/webhooks/campaign/{webhookToken}/lead

{
  "phone": "+919876543210",
  "name": "Ramesh Kumar",
  "loan_amount": "250000",
  "city": "Chennai",
  "product_interest": "Home Loan"
}

# All extra fields are injected into the agent's system prompt as:
# === LEAD CONTEXT ===
# name: Ramesh Kumar
# loan_amount: 250000
# city: Chennai
# product_interest: Home Loan`}
          </div>

          <div className="divider" />

          <h3 style={{ marginBottom: 12 }}>Outgoing Webhook Events</h3>
          <p>Set <code className="mono" style={{ background: "rgba(255,255,255,0.08)", padding: "2px 6px", borderRadius: 4, color: "#93c5fd" }}>webhookUrl</code> on your agent. These events are delivered with HMAC-SHA256 signatures.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10, marginTop: 12 }}>
            {[
              ["call.started", "Call answered"],
              ["call.completed", "Call ended normally"],
              ["call.failed", "No pickup / error"],
              ["scheduling.booking.created", "Appointment booked in-call"],
              ["scheduling.booking.cancelled", "Appointment cancelled"],
              ["scheduling.booking.rescheduled", "Appointment moved"],
            ].map(([event, desc]) => (
              <div key={event} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: 12 }}>
                <div className="mono" style={{ color: "#a78bfa", fontSize: 12, marginBottom: 4 }}>{event}</div>
                <div style={{ color: "#6b7280", fontSize: 12 }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── 07. Power Features ───────────────────────────── */}
        <div className="section">
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <span className="pill pill-purple">07</span>
            <span style={{ color: "#6b7280", fontSize: 14 }}>Advanced</span>
          </div>
          <h2>Power Features</h2>
          <p>Use these to go from "demo" to "production-grade" — and from shortlisted to winner.</p>

          <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 24 }}>
            {[
              {
                icon: "🧠", title: "Persistent Cross-call Memory",
                color: "#8b5cf6",
                body: "Every call, the agent extracts key facts about the caller (name, preferences, past issues, context) and stores them. On the NEXT call to the same number, those facts are automatically injected into the prompt. The agent picks up exactly where it left off — no repeat introductions.",
                use: "Essential for: support bots, healthcare check-ins, relationship sales, any multi-touch workflow.",
                code: `# Check what an agent remembers about a number
GET /api/agents/42/memory/facts?phoneNumber=%2B919876543210`
              },
              {
                icon: "📚", title: "Knowledge Base (RAG)",
                color: "#3b82f6",
                body: "Upload your documents — PDFs, Word docs, CSVs, or just paste text. Crawl a website URL. The platform chunks and embeds everything into pgvector. Every turn, the agent retrieves the top-k most relevant chunks to answer grounded questions.",
                use: "Essential for: support bots, product info, policy FAQs, medical guidelines, legal T&Cs.",
                code: `# Upload a PDF to an agent's KB
POST /api/knowledge-sources/upload
Content-Type: multipart/form-data
  file: @policy_document.pdf
  agentId: 42
  title: "Motor Insurance Policy 2026"`
              },
              {
                icon: "📅", title: "In-call Appointment Booking",
                color: "#f97316",
                body: "Give your agent the native_booking tool. Mid-conversation, it can check real availability, offer slots, and confirm a booking — all without the caller ever leaving the call. Works with Google Calendar and Cal.com.",
                use: "Essential for: clinics, salons, CA firms, property site visits, interview scheduling.",
                code: `// Add to agent.tools:
{ "type": "native_booking", "eventTypeId": 7 }
// Agent now says: "I have slots at 3pm and 5pm today — which works for you?"`
              },
              {
                icon: "🤝", title: "Multi-agent Squads",
                color: "#ec4899",
                body: "Build teams of specialist agents. A supervisor routes incoming calls. A technical specialist handles T1. A billing specialist handles payments. Handoffs happen live mid-call or as follow-up calls. All agents share squad context.",
                use: "Essential for: multi-department support, end-to-end sales pipeline, complex workflows.",
                code: `POST /api/squads
{
  "name": "Clinic Squad",
  "members": [
    { "agentId": 10, "roleName": "Receptionist", "handoffEnabled": true },
    { "agentId": 11, "roleName": "Doctor Follow-up Specialist" },
    { "agentId": 12, "roleName": "Billing Agent" }
  ]
}`
              },
              {
                icon: "🔧", title: "Custom Webhook Tools",
                color: "#22c55e",
                body: "Give the agent the ability to call YOUR APIs mid-conversation. Fetch a user's account balance, check inventory, submit a form, update a record. The agent sees the response and speaks it naturally.",
                use: "Essential for: CRM integration, live inventory checks, payment confirmation, any real-time lookup.",
                code: `// Add to agent.tools:
{
  "type": "webhook",
  "name": "check_balance",
  "description": "Check the customer's current loan balance by their phone number",
  "url": "https://yourapi.com/balance",
  "method": "POST",
  "parameters": {
    "phone": { "type": "string", "description": "Customer phone number" }
  }
}`
              },
              {
                icon: "📊", title: "Disposition Engine",
                color: "#facc15",
                body: "After every call, an LLM analyzes the transcript against YOUR custom taxonomy. Define outcomes like: Hot Lead / Warm Lead / Cold Lead / Callback Requested / DNC. Each call gets auto-labeled with confidence score. Route to CRM, Sheets, or alert.",
                use: "Essential for: sales campaigns, quality monitoring, compliance reporting.",
                code: `// Configure on agent:
"dispositionConfig": {
  "taxonomy": {
    "primary": ["hot_lead", "warm_lead", "cold_lead", "not_interested", "callback"],
    "sub": ["pricing_objection", "competitor_mentioned", "ready_to_buy"]
  }
}`
              },
              {
                icon: "🌍", title: "Multilingual + Language Switching",
                color: "#06b6d4",
                body: "Set asrLanguage to any Indian language. Azure STT supports continuous language detection — the caller can switch from English to Tamil mid-sentence, and the agent follows. Sarvam's Bulbul v3 has 38 Indian voices. Use Sarvam LLM for natively Indic reasoning.",
                use: "Essential for: any India-facing product. Rural users often can't speak English.",
                code: `"asrProvider": "azure",
"asrLanguage": "ta-IN",          // Tamil primary
"asrSecondaryLanguage": "en-IN", // English fallback
"ttsProvider": "sarvam",
"ttsVoice": "priya",             // Tamil female voice`
              },
              {
                icon: "⚡", title: "Gemini Live (Zero-latency)",
                color: "#a78bfa",
                body: "Select Gemini Live as your model. Audio goes directly to Gemini — no STT→LLM→TTS round-trip. The agent responds in under 300ms. Best for demos, real-time assistants, and where response speed is the feature.",
                use: "Essential for: demos that need to impress fast, conversational AI showcases.",
                code: `"llmProvider": "google",
"llmModel": "gemini-3.1-flash-live-preview",
"voiceStack": "gemini_live",
"geminiLiveVoiceName": "Kore"  // 24 preset voices available`
              },
            ].map((f) => (
              <div key={f.title} className="card" style={{ borderColor: `rgba(${f.color === "#8b5cf6" ? "139,92,246" : f.color === "#3b82f6" ? "59,130,246" : f.color === "#f97316" ? "249,115,22" : f.color === "#ec4899" ? "236,72,153" : f.color === "#22c55e" ? "34,197,94" : f.color === "#facc15" ? "234,179,8" : f.color === "#06b6d4" ? "6,182,212" : "167,139,250"},0.2)` }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 12 }}>
                  <span style={{ fontSize: 24 }}>{f.icon}</span>
                  <div style={{ flex: 1 }}>
                    <h4 style={{ color: "#f3f4f6", fontSize: 16, marginBottom: 8 }}>{f.title}</h4>
                    <p style={{ marginBottom: 8 }}>{f.body}</p>
                    <div className="info-box" style={{ marginBottom: 12, padding: "10px 14px" }}>
                      <strong>Use for: </strong>{f.use}
                    </div>
                    <div className="code-block" style={{ fontSize: 12 }}>{f.code}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── 08. Judging Criteria ─────────────────────────── */}
        <div className="section">
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <span className="pill pill-yellow">08</span>
            <span style={{ color: "#6b7280", fontSize: 14 }}>Competition</span>
          </div>
          <h2>Judging Criteria</h2>
          <p>What the judges are looking for. Weight each dimension accordingly.</p>

          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 24 }}>
            {[
              {
                score: "25%", emoji: "🎯", title: "Problem Fit",
                desc: "Is this a REAL problem that REAL people have? Is the voice modality the right medium — not just a gimmick? Does the agent solve it better than existing non-voice alternatives?",
                tips: ["Pick a pain point you or someone you know actually feels", "Quantify the problem: 'X crore people face Y, costing Z per month'", "Voice must be the natural interface — not a chatbot with speech"],
              },
              {
                score: "25%", emoji: "⚙️", title: "Technical Depth",
                desc: "How well did you use the platform? Did you go beyond the basics? Multi-feature integrations beat single-endpoint demos every time.",
                tips: ["Use at least 3 platform capabilities", "Persistent memory + KB + a custom tool = strong signal", "Squads or Disposition engine shows advanced thinking"],
              },
              {
                score: "20%", emoji: "🗣️", title: "Conversation Quality",
                desc: "Is the agent actually pleasant to talk to? Does it sound natural, stay on task, handle edge cases gracefully, and avoid hallucination?",
                tips: ["Write a detailed system prompt — every sentence matters", "Load your KB with real domain knowledge, not placeholder text", "Test with Webcall 20+ times before your demo"],
              },
              {
                score: "20%", emoji: "🚀", title: "Demo Impact",
                desc: "Did the live demo work? Was it impressive? Did it make the judges want to use it? Demos that actually work are rare — be the team that has one.",
                tips: ["Do a live call in the room if you can", "Have a fallback recording in case of network issues", "Show the transcript + disposition + booking confirmation in real time"],
              },
              {
                score: "10%", emoji: "📈", title: "Market Potential",
                desc: "Is there a real business here? Who pays, how much, and why now?",
                tips: ["One slide on TAM / ICP / monetisation is enough", "India's BPO sector is ₹3L Cr — pick your slice"],
              },
            ].map((c) => (
              <div key={c.title} className="card">
                <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                  <div style={{ textAlign: "center", minWidth: 60 }}>
                    <div style={{ fontSize: 28, marginBottom: 4 }}>{c.emoji}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#f97316" }}>{c.score}</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <h4 style={{ color: "#f3f4f6", fontSize: 16, marginBottom: 6 }}>{c.title}</h4>
                    <p style={{ marginBottom: 10 }}>{c.desc}</p>
                    <ul>
                      {c.tips.map(t => <li key={t} style={{ fontSize: 13, color: "#9ca3af" }}>{t}</li>)}
                    </ul>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── 09. Winning Strategies ───────────────────────── */}
        <div className="section">
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <span className="pill pill-orange">09</span>
            <span style={{ color: "#6b7280", fontSize: 14 }}>Strategy</span>
          </div>
          <h2>Winning Strategies</h2>
          <p>Hard-won advice from building real voice AI products.</p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14, marginTop: 24 }}>
            {[
              { emoji: "🎯", title: "Start with the script, not the code", desc: "Write out the exact conversation word-for-word before touching the API. 'What does the agent say when someone says no?' — answer this first." },
              { emoji: "📝", title: "Your system prompt is your product", desc: "80% of output quality comes from prompt quality. Be specific: who the agent is, what it must never say, how to handle objections, what to do at the end of the call." },
              { emoji: "🌍", title: "Go multilingual to stand out", desc: "Most teams will build English-only. Switching to Hindi or Tamil instantly shows India-market understanding. Use Sarvam STT + TTS + Groq Llama for an all-Indian stack." },
              { emoji: "🔗", title: "Add a real data integration", desc: "Connect to a real external system — a spreadsheet, a mock CRM API, a Google Calendar. Agents that actually do things beat agents that just talk." },
              { emoji: "⚡", title: "Speed first, polish second", desc: "Get to a working call in 30 minutes. Then spend the rest of the time making the conversation better — not adding features. One great conversation beats ten mediocre ones." },
              { emoji: "🧪", title: "Test with real edge cases", desc: "What happens when the caller says 'I'm in a meeting, call later'? Or speaks in broken English? Or says nothing for 10 seconds? Handle these in your prompt." },
              { emoji: "📊", title: "Show the data flywheel", desc: "Show judges: call is made → transcript captured → disposition applied → result written to Sheets. The data loop is the business model. Make it visible." },
              { emoji: "🤝", title: "Use squads for narrative arc", desc: "A single agent is a feature. A squad of 3 agents (qualify → schedule → follow up) is a product. Squads tell a better story about scalability." },
              { emoji: "🎙️", title: "Pick the right voice for your persona", desc: "Sarvam Bulbul v3 for Indian characters. Cartesia for crisp English. ElevenLabs for premium/emotional. A voice that matches the persona is 20% of first impressions." },
              { emoji: "🏆", title: "Live demo > slides", desc: "Call a judge's phone number from the stage. Real > recorded > slides. Anything that can go live, should go live." },
            ].map((tip) => (
              <div key={tip.title} className="card">
                <div style={{ fontSize: 28, marginBottom: 10 }}>{tip.emoji}</div>
                <h4 style={{ color: "#f3f4f6", marginBottom: 8 }}>{tip.title}</h4>
                <p style={{ fontSize: 13, margin: 0 }}>{tip.desc}</p>
              </div>
            ))}
          </div>

          <div className="divider" />

          <div className="winner-box">
            <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              <span style={{ fontSize: 36 }}>🏆</span>
              <div>
                <h3 style={{ color: "#f97316", margin: "0 0 8px" }}>The Winning Formula</h3>
                <p style={{ fontSize: 15, color: "#d1d5db", margin: 0, lineHeight: 1.7 }}>
                  <strong style={{ color: "#f3f4f6" }}>Real pain</strong> + <strong style={{ color: "#f3f4f6" }}>multilingual voice</strong> + <strong style={{ color: "#f3f4f6" }}>persistent memory</strong> + <strong style={{ color: "#f3f4f6" }}>live data integration</strong> + <strong style={{ color: "#f3f4f6" }}>working demo</strong> = hard to beat.
                  <br /><br />
                  Teams that win don't try to build everything. They pick one workflow, make it work end-to-end,
                  and show exactly what happens from "call starts" to "outcome in the database." That story is worth more than ten disconnected features.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── 10. Resources ─────────────────────────────────── */}
        <div className="section">
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <span className="pill pill-blue">10</span>
            <span style={{ color: "#6b7280", fontSize: 14 }}>Resources</span>
          </div>
          <h2>Resources & Support</h2>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 14, marginTop: 24 }}>
            {[
              { icon: "🖥️", title: "Dashboard", desc: "Visual builder for agents, campaigns, KB, scheduling", link: "app.snapserve.ai" },
              { icon: "📖", title: "API Docs (In-app)", desc: "Agents → API Reference → Try it out", link: "app.snapserve.ai/docs" },
              { icon: "🔊", title: "Sarvam Voices", desc: "38 Indian voices — preview all of them", link: "sarvam.ai/voices" },
              { icon: "🎙️", title: "Cartesia Voice Library", desc: "English voice catalogue + cloning", link: "cartesia.ai/voices" },
              { icon: "📞", title: "Webcall Tester", desc: "Test agents in-browser — no phone needed", link: "app.snapserve.ai/vibe" },
              { icon: "💬", title: "Mentor Desk", desc: "Stuck? Ask a SnapServe engineer at the mentor desk", link: "" },
            ].map((r) => (
              <div key={r.title} className="card" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span style={{ fontSize: 24 }}>{r.icon}</span>
                <div>
                  <h4 style={{ color: "#f3f4f6", marginBottom: 4 }}>{r.title}</h4>
                  <p style={{ fontSize: 13, margin: "0 0 6px" }}>{r.desc}</p>
                  {r.link && <span className="mono" style={{ color: "#60a5fa", fontSize: 12 }}>{r.link}</span>}
                </div>
              </div>
            ))}
          </div>

          <div className="divider" />

          {/* Key concepts quick ref */}
          <h3 style={{ marginBottom: 14 }}>Glossary — Things you'll encounter</h3>
          <div style={{ overflow: "auto", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)" }}>
            <table>
              <thead>
                <tr>
                  <th>Term</th>
                  <th>What it is</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Agent", "Your AI voice persona. Has a system prompt, voice, and tools."],
                  ["Campaign", "A batch of leads the agent dials automatically. CSV or webhook-driven."],
                  ["Lead", "A phone number (+ metadata) inside a campaign. Can be retried."],
                  ["System Prompt", "The instructions that define the agent's personality, goals, and constraints."],
                  ["Greeting Message", "The first sentence the agent says when the call connects."],
                  ["KB (Knowledge Base)", "Documents/URLs the agent retrieves from during conversation."],
                  ["Disposition", "Auto-classification of a call's outcome using a custom taxonomy."],
                  ["Squad", "A team of agents with handoff and follow-up capabilities."],
                  ["Webhook Tool", "Lets the agent call your external API mid-conversation."],
                  ["Persistent Memory", "Facts extracted per caller, injected back on the next call."],
                  ["triggerMode: instant", "Campaign that calls within seconds of a new lead arriving."],
                  ["triggerMode: batch", "Campaign that dials all leads at a scheduled time."],
                  ["Webcall", "Browser-based call tester — no phone needed."],
                  ["Vibe", "Speed-testing interface: swap voices and LLMs and test instantly."],
                  ["BYOP", "Bring Your Own Providers — supply your own AI API keys."],
                  ["DPDP", "India's Digital Personal Data Protection Act. Consent controls built in."],
                  ["TRAI", "Telecom Regulatory Authority of India. Calling-hours rules enforced."],
                ].map(([term, def]) => (
                  <tr key={term}>
                    <td className="mono" style={{ color: "#a78bfa", fontSize: 13 }}>{term}</td>
                    <td style={{ fontSize: 14 }}>{def}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Footer ───────────────────────────────────────── */}
        <div style={{ padding: "48px 0 64px", textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🎙️</div>
          <h2 style={{ marginBottom: 8 }}>
            Now go build something <span className="gradient-text">unforgettable</span>.
          </h2>
          <p style={{ color: "#6b7280", maxWidth: 480, margin: "0 auto" }}>
            Every great voice product started with one call that worked. Make yours.
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 24, flexWrap: "wrap" }}>
            <span className="pill pill-orange">Good luck 🚀</span>
            <span className="pill pill-purple">Build fast 💨</span>
            <span className="pill pill-green">Ship it 🛠️</span>
          </div>
          <p style={{ color: "#374151", fontSize: 12, marginTop: 32 }}>
            SnapServe Voice-athon Playbook · Confidential · For participant use only
          </p>
        </div>

      </div>
    </div>
  );
}
