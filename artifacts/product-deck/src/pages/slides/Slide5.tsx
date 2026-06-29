export default function Slide5() {
  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{ width: "100vw", height: "100vh", overflow: "hidden", backgroundColor: "#FFFFFF", fontFamily: "'Inter', sans-serif", color: "#1C1C1C", position: "relative", display: "flex", flexDirection: "column", padding: "7vh 8vw 5vh 8vw", boxSizing: "border-box" }}>
      <div style={{ width: "84vw", height: "0.2vh", backgroundColor: "#1C1C1C", position: "absolute", top: "7vh", left: "8vw" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "2vh", zIndex: 1 }}>
        <div style={{ fontSize: "0.95vw", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'DM Mono', monospace" }}>snapserve.ai</div>
        <div style={{ fontSize: "0.9vw", fontWeight: 400, color: "#888888", fontFamily: "'DM Mono', monospace" }}>05 — The Moat</div>
      </div>
      <div style={{ position: "absolute", top: "28vh", right: "4vw", fontSize: "22vw", fontWeight: 700, color: "#F5F5F5", lineHeight: 1, zIndex: 0, userSelect: "none", letterSpacing: "-0.06em" }}>06</div>
      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "flex-start", zIndex: 1, position: "relative", marginTop: "5vh" }}>
        <h2 style={{ fontSize: "3.4vw", fontWeight: 700, margin: "0 0 1.5vh 0", lineHeight: 1.1, letterSpacing: "-0.025em" }}>Caller memory. No competitor has it.</h2>
        <p style={{ fontSize: "1.2vw", color: "#4A4A4A", maxWidth: "62vw", lineHeight: 1.6, marginBottom: "4vh" }}>Vapi and Bolna treat every call as stateless. SnapServe maintains a persistent three-layer memory graph per caller — facts, episodes, and semantic context — that every agent accesses on every call. The agent that remembers is the agent customers prefer.</p>
        <div style={{ display: "flex", gap: "4vw", marginBottom: "3.5vh" }}>
          <div style={{ flex: 1, borderLeft: "0.3vh solid #1C1C1C", paddingLeft: "1.5vw" }}>
            <div style={{ fontSize: "0.8vw", color: "#888888", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "1vh" }}>Layer 1 — Facts</div>
            <div style={{ fontSize: "1.2vw", fontWeight: 600, marginBottom: "0.5vh" }}>Structured caller profile</div>
            <div style={{ fontSize: "1vw", color: "#4A4A4A", lineHeight: 1.5 }}>Name, account details, language preference, stated goals. Extracted and structured from every call.</div>
          </div>
          <div style={{ flex: 1, borderLeft: "0.3vh solid #1C1C1C", paddingLeft: "1.5vw" }}>
            <div style={{ fontSize: "0.8vw", color: "#888888", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "1vh" }}>Layer 2 — Episodes</div>
            <div style={{ fontSize: "1.2vw", fontWeight: 600, marginBottom: "0.5vh" }}>Interaction history</div>
            <div style={{ fontSize: "1vw", color: "#4A4A4A", lineHeight: 1.5 }}>Every past call, its outcome, any complaints, follow-up actions. The agent never asks the same question twice.</div>
          </div>
          <div style={{ flex: 1, borderLeft: "0.3vh solid #1C1C1C", paddingLeft: "1.5vw" }}>
            <div style={{ fontSize: "0.8vw", color: "#888888", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "1vh" }}>Layer 3 — Semantic</div>
            <div style={{ fontSize: "1.2vw", fontWeight: 600, marginBottom: "0.5vh" }}>Inferred intent graph</div>
            <div style={{ fontSize: "1vw", color: "#4A4A4A", lineHeight: 1.5 }}>Patterns, preferences, predicted next action. Enables proactive outreach before the customer calls in.</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "3vw", alignItems: "center", backgroundColor: "#FAFAFA", padding: "2.5vh 2.5vw", border: "0.1vh solid #E0E0E0" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "1.1vw", fontWeight: 600, marginBottom: "0.5vh" }}>Why this is a defensible moat</div>
            <div style={{ fontSize: "1vw", color: "#4A4A4A", lineHeight: 1.5 }}>The more calls a business runs on SnapServe, the richer every caller's memory gets. Switching to a competitor resets all that context. Data gravity compounds with usage — this is how platform stickiness is built.</div>
          </div>
          <div style={{ width: "0.1vw", height: "8vh", backgroundColor: "#E0E0E0" }} />
          <div style={{ textAlign: "center", minWidth: "14vw" }}>
            <div style={{ fontSize: "3.5vw", fontWeight: 700, letterSpacing: "-0.03em" }}>3×</div>
            <div style={{ fontSize: "0.9vw", color: "#666666", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", marginTop: "0.5vh" }}>Higher FCR with memory</div>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", borderTop: "0.1vh solid #E0E0E0", paddingTop: "2.5vh", marginTop: "auto", fontFamily: "'DM Mono', monospace", fontSize: "0.85vw", color: "#4A4A4A", zIndex: 1 }}>
        <div style={{ display: "flex", gap: "5vw" }}>
          <div>
            <div style={{ color: "#999999", marginBottom: "0.4vh", textTransform: "uppercase", fontSize: "0.65vw" }}>Date</div>
            <div>June 2026</div>
          </div>
          <div>
            <div style={{ color: "#999999", marginBottom: "0.4vh", textTransform: "uppercase", fontSize: "0.65vw" }}>Prepared By</div>
            <div>SnapServe</div>
          </div>
          <div>
            <div style={{ color: "#999999", marginBottom: "0.4vh", textTransform: "uppercase", fontSize: "0.65vw" }}>Status</div>
            <div>Live</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: "#999999", marginBottom: "0.4vh", textTransform: "uppercase", fontSize: "0.65vw" }}>Page</div>
          <div style={{ fontWeight: 600, color: "#1C1C1C" }}>06 / 12</div>
        </div>
      </div>
    </div>
  );
}
