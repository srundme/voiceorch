import { useState, useEffect } from "react";

interface ImpersonationData {
  sessionToken: string;
  name: string | null;
  email: string | null;
}

function getImpersonation(): ImpersonationData | null {
  try {
    const raw = localStorage.getItem("voiceorch:impersonation");
    if (!raw) return null;
    return JSON.parse(raw) as ImpersonationData;
  } catch {
    return null;
  }
}

export function ImpersonationBanner() {
  const [imp, setImp] = useState<ImpersonationData | null>(null);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    setImp(getImpersonation());
  }, []);

  if (!imp) return null;

  async function handleExit() {
    if (!imp || exiting) return;
    setExiting(true);
    try {
      const adminToken = localStorage.getItem("adminToken");
      if (adminToken && imp.sessionToken) {
        await fetch(`/api/admin/impersonate/sessions/${imp.sessionToken}`, {
          method: "DELETE",
          headers: { "x-admin-token": adminToken },
        }).catch(() => {});
      }
    } finally {
      localStorage.removeItem("voiceorch:impersonation");
      localStorage.removeItem("voiceorch:session");
      window.location.href = "/sign-in";
    }
  }

  return (
    <div
      style={{
        background: "linear-gradient(90deg, #92400e, #b45309)",
        color: "#fef3c7",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "9px 20px",
        fontSize: "0.8rem",
        fontWeight: 600,
        letterSpacing: "0.01em",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: "1rem" }}>⚠</span>
        <span>
          Admin Mode — Viewing as{" "}
          <strong>{imp.name || imp.email || "Unknown User"}</strong>
          {imp.email && imp.name ? ` (${imp.email})` : ""}
          {". "}All actions are audit logged.
        </span>
      </div>
      <button
        onClick={handleExit}
        disabled={exiting}
        style={{
          background: "rgba(255,255,255,0.15)",
          border: "1px solid rgba(255,255,255,0.3)",
          borderRadius: 6,
          color: "#fef3c7",
          padding: "4px 12px",
          fontSize: "0.75rem",
          fontWeight: 700,
          cursor: exiting ? "not-allowed" : "pointer",
          opacity: exiting ? 0.7 : 1,
          whiteSpace: "nowrap",
        }}
      >
        {exiting ? "Exiting…" : "Exit Admin Mode →"}
      </button>
    </div>
  );
}
