const SSWatermark = () => (
  <div style={{ position: "absolute", bottom: "2.8vh", left: "3vw", display: "flex", alignItems: "center", gap: "0.7vw" }}>
    <div style={{ width: "2.2vw", height: "0.3vh", background: "#FF6F00", borderRadius: "2px" }} />
    <span style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", opacity: 0.85 }}>
      snapserve.ai
    </span>
  </div>
);

const SlideHeader = ({ section, title, slide }: { section: string; title: string; slide: string }) => (
  <>
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "0.55vh", background: "#FF6F00" }} />
    <div style={{
      background: "#1A237E", padding: "3.2vh 6vw 2.8vh 6vw",
      display: "flex", alignItems: "flex-end", justifyContent: "space-between",
    }}>
      <div>
        <div style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", marginBottom: "0.8vh" }}>
          {section}
        </div>
        <h1 style={{ fontFamily: "var(--font-display-family)", fontSize: "2.6vw", fontWeight: 700, color: "#FFFFFF", margin: 0, lineHeight: 1.15 }}>
          {title}
        </h1>
      </div>
      <span style={{ fontSize: "0.85vw", fontWeight: 600, color: "#4B6CB7", letterSpacing: "0.06em", paddingBottom: "0.3vh" }}>{slide}</span>
    </div>
  </>
);

export default function Slide2() {
  const card: React.CSSProperties = {
    flex: 1, background: "#FFFFFF", border: "0.06vh solid #E8EAF0",
    borderRadius: "1.2vw", padding: "3.2vh 2.6vw",
    boxShadow: "0 0.8vh 2.4vh rgba(26,35,126,0.10)", display: "flex", flexDirection: "column",
  };
  const bullet: React.CSSProperties = {
    fontSize: "1.08vw", lineHeight: 1.6, color: "#3A3A5C", marginBottom: "1.2vh",
    paddingLeft: "1.4vw", position: "relative",
  };

  return (
    <div
      className="w-screen h-screen overflow-hidden relative"
      style={{ background: "#FAFAFA", fontFamily: "var(--font-body-family)", display: "flex", flexDirection: "column" }}
    >
      <SlideHeader section="The Team" title="Two builders who shipped it themselves" slide="02 / 16" />

      <div style={{ flex: 1, padding: "3.2vh 6vw 6.5vh 6vw", display: "flex", flexDirection: "column", gap: "2.4vh" }}>
        <div style={{ display: "flex", gap: "2.4vw", flex: 1 }}>
          <div style={card}>
            <div style={{
              width: "4vw", height: "4vw", borderRadius: "50%", background: "#EEF0FB",
              display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "2vh",
            }}>
              <svg width="2vw" height="2vw" viewBox="0 0 24 24" fill="none" stroke="#1A237E" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
              </svg>
            </div>
            <div style={{ fontSize: "1.55vw", fontWeight: 700, color: "#1A237E", marginBottom: "0.4vh" }}>Karthikeyan</div>
            <div style={{ fontSize: "0.88vw", fontWeight: 700, color: "#FF6F00", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "2vh" }}>
              Founder &amp; CEO
            </div>
            <div style={bullet}><span style={{ position: "absolute", left: 0, top: "0.7vh", width: "0.5vw", height: "0.5vw", borderRadius: "50%", background: "#1A237E" }} />
              CMA (US) — deep expertise in unit economics, financial modelling, and compliance frameworks.
            </div>
            <div style={bullet}><span style={{ position: "absolute", left: 0, top: "0.7vh", width: "0.5vw", height: "0.5vw", borderRadius: "50%", background: "#1A237E" }} />
              Non-technical founder who hand-built SnapServe's core operational logic — knows every product nuance end-to-end.
            </div>
            <div style={{ ...bullet, marginBottom: 0 }}><span style={{ position: "absolute", left: 0, top: "0.7vh", width: "0.5vw", height: "0.5vw", borderRadius: "50%", background: "#1A237E" }} />
              Took it from zero to production without external engineers — first principles founder.
            </div>
          </div>

          <div style={card}>
            <div style={{
              width: "4vw", height: "4vw", borderRadius: "50%", background: "#FFF3E0",
              display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "2vh",
            }}>
              <svg width="2vw" height="2vw" viewBox="0 0 24 24" fill="none" stroke="#FF6F00" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
              </svg>
            </div>
            <div style={{ fontSize: "1.55vw", fontWeight: 700, color: "#1A237E", marginBottom: "0.4vh" }}>Gopi N.</div>
            <div style={{ fontSize: "0.88vw", fontWeight: 700, color: "#FF6F00", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "2vh" }}>
              Co-Founder &amp; COO
            </div>
            <div style={bullet}><span style={{ position: "absolute", left: 0, top: "0.7vh", width: "0.5vw", height: "0.5vw", borderRadius: "50%", background: "#FF6F00" }} />
              Enterprise engineer from CGI — large-scale infrastructure and system design.
            </div>
            <div style={bullet}><span style={{ position: "absolute", left: 0, top: "0.7vh", width: "0.5vw", height: "0.5vw", borderRadius: "50%", background: "#FF6F00" }} />
              Built the entire technical platform — took SnapServe from prototype to live production calls.
            </div>
            <div style={{ ...bullet, marginBottom: 0 }}><span style={{ position: "absolute", left: 0, top: "0.7vh", width: "0.5vw", height: "0.5vw", borderRadius: "50%", background: "#FF6F00" }} />
              Responsible for sub-second latency, multi-provider failover, and real-world telephony integrations.
            </div>
          </div>
        </div>

        <div style={{
          background: "#FFFFFF", border: "0.06vh solid #E8EAF0", borderRadius: "1vw",
          padding: "2.2vh 2.4vw", boxShadow: "0 0.4vh 1.2vh rgba(26,35,126,0.07)",
        }}>
          <div style={{ fontSize: "0.78vw", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.16em", color: "#FF6F00", marginBottom: "1vh" }}>
            Why Us
          </div>
          <div style={{ fontSize: "1.05vw", color: "#3A3A5C", lineHeight: 1.6 }}>
            We spent 12+ months running a live voice AI agency in insurance — not as a side project, but as our primary business. We deployed real outbound call workflows for insurers, experienced context amnesia firsthand when customers repeated themselves on every call, and hit compliance walls that no existing tool helped us clear. SnapServe is the platform we needed and could not buy. We built it ourselves, in production, without external engineers.
          </div>
        </div>

        <div style={{
          background: "#F0F3FF", border: "0.06vh solid #C5CAE9", borderRadius: "1vw",
          padding: "2vh 2.4vw", display: "flex", alignItems: "center", gap: "1.4vw",
        }}>
          <div style={{ fontSize: "0.85vw", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "#1A237E", whiteSpace: "nowrap" }}>
            Advisors
          </div>
          <div style={{ width: "0.06vw", height: "2.8vh", background: "#C5CAE9" }} />
          <div style={{ fontSize: "1.02vw", color: "#6B7280", fontStyle: "italic" }}>
            Advisor seats open — introductions welcome. Strong domain fit in BFSI, SaaS, and Indian enterprise GTM preferred.
          </div>
        </div>
      </div>


    </div>
  );
}
