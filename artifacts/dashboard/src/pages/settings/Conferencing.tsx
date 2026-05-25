import { useEffect, useState } from "react";
import { Video, CheckCircle2, Loader2, Eye, EyeOff, ExternalLink, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

type GCalStatus = { connected: boolean; email: string | null; credentialsConfigured: boolean };
type CredentialStatus = { configured: boolean; clientIdHint: string | null };

async function fetchGCalStatus(): Promise<GCalStatus> {
  const r = await fetch(`${API}/scheduling/google/status`, { credentials: "include" });
  if (!r.ok) throw new Error("Failed");
  return r.json();
}

async function fetchCredStatus(): Promise<CredentialStatus> {
  const r = await fetch(`${API}/scheduling/google/credentials`, { credentials: "include" });
  if (!r.ok) throw new Error("Failed");
  return r.json();
}

export default function ConferencingPage() {
  const [status, setStatus] = useState<GCalStatus | null>(null);
  const [credStatus, setCredStatus] = useState<CredentialStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const { toast } = useToast();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gcal = params.get("gcal");
    if (gcal === "connected") {
      toast({ title: "Google Calendar connected!", description: "Meet links will be auto-generated for new bookings." });
      window.history.replaceState({}, "", window.location.pathname);
    } else if (gcal === "error") {
      toast({ title: "Connection failed", description: "Something went wrong with Google OAuth. Check your credentials and try again.", variant: "destructive" });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchGCalStatus(), fetchCredStatus()])
      .then(([s, c]) => { setStatus(s); setCredStatus(c); })
      .catch(() => { setStatus({ connected: false, email: null, credentialsConfigured: false }); setCredStatus({ configured: false, clientIdHint: null }); })
      .finally(() => setLoading(false));
  }, []);

  async function handleSaveCredentials() {
    if (!clientId.trim() || !clientSecret.trim()) {
      toast({ title: "Both Client ID and Client Secret are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const r = await fetch(`${API}/scheduling/google/credentials`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }),
      });
      if (!r.ok) throw new Error("Failed");
      const hint = clientId.length > 8 ? `${clientId.slice(0, 8)}...${clientId.slice(-4)}` : clientId;
      setCredStatus({ configured: true, clientIdHint: hint });
      setClientId("");
      setClientSecret("");
      setStatus(s => s ? { ...s, credentialsConfigured: true } : s);
      toast({ title: "Google OAuth credentials saved", description: "You can now connect your Google Calendar." });
    } catch {
      toast({ title: "Failed to save credentials", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveCredentials() {
    await fetch(`${API}/scheduling/google/credentials`, { method: "DELETE", credentials: "include" });
    setCredStatus({ configured: false, clientIdHint: null });
    setStatus(s => s ? { ...s, credentialsConfigured: false, connected: false, email: null } : s);
    toast({ title: "Google OAuth credentials removed" });
  }

  function handleConnect() {
    setConnecting(true);
    window.location.href = `${API}/scheduling/google/connect`;
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await fetch(`${API}/scheduling/google/disconnect`, { method: "DELETE", credentials: "include" });
      setStatus(s => s ? { ...s, connected: false, email: null } : s);
      toast({ title: "Google Calendar disconnected" });
    } catch {
      toast({ title: "Failed to disconnect", variant: "destructive" });
    } finally {
      setDisconnecting(false);
    }
  }

  const credConfigured = credStatus?.configured ?? false;
  const calConnected = status?.connected ?? false;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold">Conferencing</h1>
        <p className="text-sm text-muted-foreground">
          Connect a video conferencing tool — links are auto-generated and included in every booking email
        </p>
      </div>

      {/* Google Meet card */}
      <Card className={calConnected ? "border-emerald-300 bg-emerald-50/20" : ""}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0 border border-blue-200">
                <Video className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">Google Meet</CardTitle>
                  {calConnected && (
                    <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs">
                      <CheckCircle2 className="h-3 w-3 mr-1" /> Connected
                    </Badge>
                  )}
                </div>
                {calConnected && status?.email && (
                  <p className="text-xs text-muted-foreground mt-0.5">{status.email}</p>
                )}
              </div>
            </div>
            <div className="shrink-0">
              {loading ? (
                <Button variant="outline" size="sm" disabled><Loader2 className="h-3.5 w-3.5 animate-spin" /></Button>
              ) : calConnected ? (
                <Button variant="outline" size="sm" onClick={handleDisconnect} disabled={disconnecting}
                  className="text-destructive border-destructive/30 hover:bg-destructive/5">
                  {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Disconnect"}
                </Button>
              ) : (
                <Button size="sm" onClick={handleConnect} disabled={!credConfigured || connecting} className="gap-1.5">
                  {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Video className="h-3.5 w-3.5" />}
                  {connecting ? "Redirecting…" : "Connect"}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0 space-y-4">
          <CardDescription className="text-sm">
            Automatically create Google Meet video links when a booking is confirmed. Attendees and host both receive the link in their email.
          </CardDescription>

          {calConnected && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
              <p className="text-xs text-emerald-700 font-medium">✓ Active — Google Meet links are created automatically for all new bookings</p>
              <p className="text-xs text-emerald-600 mt-0.5">The Meet link is included in both the attendee confirmation and the host notification email.</p>
            </div>
          )}

          {/* Step 1 — OAuth App Credentials */}
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-muted text-xs font-bold">1</span>
                  Google OAuth App Credentials
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  From your{" "}
                  <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer"
                    className="underline underline-offset-2 inline-flex items-center gap-0.5">
                    Google Cloud Console <ExternalLink className="h-3 w-3" />
                  </a>
                  {" "}— create an OAuth 2.0 Client ID (Web application type).
                </p>
              </div>
              {credConfigured && (
                <Button variant="ghost" size="sm" onClick={handleRemoveCredentials} className="h-7 text-muted-foreground hover:text-destructive shrink-0">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>

            {credConfigured ? (
              <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                <span>Credentials saved — Client ID: <code className="font-mono">{credStatus?.clientIdHint}</code></span>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">Client ID</Label>
                  <Input
                    placeholder="1234567890-abc123.apps.googleusercontent.com"
                    value={clientId}
                    onChange={e => setClientId(e.target.value)}
                    className="text-sm font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Client Secret</Label>
                  <div className="relative">
                    <Input
                      type={showSecret ? "text" : "password"}
                      placeholder="GOCSPX-…"
                      value={clientSecret}
                      onChange={e => setClientSecret(e.target.value)}
                      className="text-sm font-mono pr-9"
                    />
                    <Button variant="ghost" size="sm" type="button"
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0 text-muted-foreground"
                      onClick={() => setShowSecret(v => !v)}>
                      {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Add <code className="font-mono text-xs bg-muted px-1 rounded">{window.location.origin}/api/scheduling/google/callback</code> as an Authorized Redirect URI in your Google Cloud Console.
                </p>
                <Button size="sm" onClick={handleSaveCredentials} disabled={saving || !clientId.trim() || !clientSecret.trim()}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                  Save credentials
                </Button>
              </div>
            )}
          </div>

          {/* Step 2 — Connect */}
          <div className={`border rounded-lg p-4 space-y-2 ${!credConfigured ? "opacity-50" : ""}`}>
            <p className="text-sm font-medium flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-muted text-xs font-bold">2</span>
              Sign in with Google
            </p>
            <p className="text-xs text-muted-foreground">
              {calConnected
                ? `Connected as ${status?.email}. Click Disconnect above to unlink.`
                : credConfigured
                  ? "Click Connect above to sign in with Google and authorize calendar access."
                  : "Save your OAuth credentials first, then connect your Google account."}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Coming soon */}
      {[
        { name: "Zoom", desc: "Generate Zoom meeting links automatically on each booking. Requires a Zoom OAuth app." },
        { name: "Microsoft Teams", desc: "Generate Teams meeting links. Requires a Microsoft 365 work/school account." },
        { name: "Jitsi Video", desc: "Free open-source video conferencing. No account required — a unique room is generated per booking." },
      ].map(app => (
        <Card key={app.name} className="opacity-60">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{app.name}</CardTitle>
              <Badge variant="outline" className="text-xs text-muted-foreground">Coming soon</Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <CardDescription>{app.desc}</CardDescription>
          </CardContent>
        </Card>
      ))}

      <p className="text-xs text-muted-foreground border-t pt-4">
        Conferencing links are generated at booking time and included in confirmation emails. Only one conferencing tool can be active per account.
      </p>
    </div>
  );
}
