import { useEffect, useState, useCallback } from "react";
import { Video, CheckCircle2, Loader2, Plus, Trash2, Link2, Unlink, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { customFetch } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

type GoogleConnection = {
  id: string;
  email: string;
  connectedAt: string;
  needsReconnect?: boolean;
  reconnectReason?: string | null;
};

export default function ConferencingPage({ embedded = false }: { embedded?: boolean }) {
  const [connections, setConnections] = useState<GoogleConnection[]>([]);
  const [loading, setLoading]         = useState(true);
  const [connecting, setConnecting]   = useState(false);
  const [removingId, setRemovingId]   = useState<string | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const data = await customFetch<GoogleConnection[]>(`${API}/scheduling/google/connections`);
      setConnections(data);
    } catch {
      setConnections([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Handle OAuth return in THIS tab (?gcal=connected / ?gcal=error)
  // This runs when the OAuth popup redirects back and lands on this page.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gcal  = params.get("gcal");
    const email = params.get("email");
    if (gcal === "connected") {
      window.history.replaceState({}, "", window.location.pathname);
      // Broadcast to the original tab so it reloads without user action
      try {
        const ch = new BroadcastChannel("google-oauth");
        ch.postMessage({ type: "connected", email: email ?? "" });
        ch.close();
      } catch { /* BroadcastChannel not available (old Safari) */ }
      // Also refresh & show toast in this tab (same-tab / production flow)
      toast({
        title: "Google account connected!",
        description: email
          ? `${email} is now linked. Meet links will be created automatically.`
          : "Your Google Calendar is now connected.",
      });
      setTimeout(() => void load(), 600);
      // Close this tab if it was the OAuth popup
      setTimeout(() => { try { window.close(); } catch { /* noop */ } }, 1800);
    } else if (gcal === "error") {
      window.history.replaceState({}, "", window.location.pathname);
      try {
        const ch = new BroadcastChannel("google-oauth");
        ch.postMessage({ type: "error" });
        ch.close();
      } catch { /* noop */ }
      toast({
        title: "Connection failed",
        description: "Something went wrong with Google sign-in. Please try again.",
        variant: "destructive",
      });
      setTimeout(() => { try { window.close(); } catch { /* noop */ } }, 1800);
    }
  }, [toast, load]);

  // Receive broadcast from OAuth popup tab → reload connections in original tab
  useEffect(() => {
    let ch: BroadcastChannel;
    try {
      ch = new BroadcastChannel("google-oauth");
      ch.onmessage = (e: MessageEvent<{ type: string; email?: string }>) => {
        if (e.data?.type === "connected") {
          toast({
            title: "Google account connected!",
            description: e.data.email
              ? `${e.data.email} is now linked. Meet links will be created automatically.`
              : "Your Google Calendar is now connected.",
          });
          setTimeout(() => void load(), 600);
          setConnecting(false);
        } else if (e.data?.type === "error") {
          toast({ title: "Connection failed", description: "Something went wrong with Google sign-in.", variant: "destructive" });
          setConnecting(false);
        }
      };
    } catch { /* BroadcastChannel not available */ }
    return () => { try { ch?.close(); } catch { /* noop */ } };
  }, [toast, load]);

  useEffect(() => { void load(); }, [load]);

  async function handleConnect() {
    setConnecting(true);
    try {
      const { url } = await customFetch<{ url: string }>(`${API}/scheduling/google/connect-url?returnTo=conferencing&returnOrigin=${encodeURIComponent(window.location.origin)}`);
      window.open(url, "_blank", "noopener");
    } catch {
      toast({ title: "Could not start Google sign-in", variant: "destructive" });
      setConnecting(false);
    }
  }

  async function handleRemove(id: string) {
    setRemovingId(id);
    try {
      await customFetch<void>(`${API}/scheduling/google/connections/${id}`, { method: "DELETE" });
      setConnections(prev => prev.filter(c => c.id !== id));
      toast({ title: "Google account disconnected" });
    } catch {
      toast({ title: "Failed to disconnect", variant: "destructive" });
    } finally {
      setRemovingId(null);
    }
  }

  const hasConnections = connections.length > 0;

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      {!embedded && (
        <div>
          <h1 className="text-xl font-semibold">Conferencing</h1>
          <p className="text-sm text-muted-foreground">
            Connect Google Calendar accounts — Meet links are auto-generated and included in every booking confirmation
          </p>
        </div>
      )}

      {/* Google Meet card */}
      <Card className={hasConnections ? "border-zinc-300 bg-muted/20" : ""}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              {/* Google color icon */}
              <div className="w-10 h-10 rounded-xl bg-card flex items-center justify-center shrink-0 border">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#a1a1aa"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#a1a1aa"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#a1a1aa"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#c45454"/>
                </svg>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">Google Meet</CardTitle>
                  {hasConnections && (
                    <Badge className="bg-muted text-foreground border-border text-xs">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      {connections.length === 1 ? "1 account" : `${connections.length} accounts`}
                    </Badge>
                  )}
                </div>
                <CardDescription className="text-xs mt-0.5">
                  Automatically create Google Meet links when bookings are confirmed
                </CardDescription>
              </div>
            </div>

            <Button
              size="sm"
              onClick={handleConnect}
              disabled={connecting || loading}
              className="shrink-0 gap-1.5"
              variant={hasConnections ? "outline" : "default"}
            >
              {connecting
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Plus className="h-3.5 w-3.5" />}
              {connecting ? "Redirecting…" : "Add account"}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="pt-0 space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : hasConnections ? (
            <>
              <div className="p-3 bg-muted border border-border rounded-lg text-xs text-foreground">
                <p className="font-medium">✓ Active — Google Meet links are generated for new bookings</p>
                <p className="mt-0.5 text-foreground">
                  Assign a specific account to each calendar from the{" "}
                  <a href={`${BASE}/app/scheduling/calendars`} className="underline underline-offset-2">Calendars</a>{" "}
                  page. Unassigned calendars use the first connected account.
                </p>
              </div>

              <div className="space-y-2">
                {connections.map(conn => (
                  <div
                    key={conn.id}
                    className={`flex flex-col gap-2 p-3 bg-background border rounded-lg ${conn.needsReconnect ? "border-destructive/50" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                          <span className="text-xs font-semibold text-foreground">
                            {conn.email[0]?.toUpperCase()}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{conn.email}</p>
                          <p className="text-xs text-muted-foreground">
                            Connected {new Date(conn.connectedAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={removingId === conn.id}
                        onClick={() => handleRemove(conn.id)}
                        className="h-7 px-2 text-muted-foreground hover:text-destructive shrink-0"
                      >
                        {removingId === conn.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Trash2 className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                    {conn.needsReconnect && (
                      <div className="flex items-center justify-between gap-2 rounded-md bg-destructive/10 px-2.5 py-2">
                        <div className="flex items-start gap-2 min-w-0">
                          <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                          <p className="text-xs text-destructive">
                            Reconnect needed — calendar events can’t be created until you re-authorize. Make sure to grant calendar access.
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={connecting}
                          onClick={handleConnect}
                          className="h-7 px-2 text-xs shrink-0"
                        >
                          {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Reconnect"}
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                <Link2 className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">No Google accounts connected</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Click <strong>Add account</strong> to sign in with Google — no developer setup needed.
                  <br />
                  Your booking confirmations will include a Google Meet link automatically.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* How it works */}
      <Card className="bg-muted/30 border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">How it works</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 text-xs text-muted-foreground space-y-1.5">
          <p>1. Click <strong>Add account</strong> → sign in with Google → grant calendar access</p>
          <p>2. Optionally assign specific Google accounts to individual calendars (for multi-tenant setups)</p>
          <p>3. When a booking is confirmed, a Meet link is created on that Google account and emailed to both parties</p>
          <p>4. You can connect multiple Google accounts — e.g. one per department or agent</p>
        </CardContent>
      </Card>

      {/* Coming soon */}
      {[
        { name: "Zoom", desc: "Generate Zoom meeting links automatically on each booking." },
        { name: "Microsoft Teams", desc: "Generate Teams meeting links. Requires a Microsoft 365 work/school account." },
        { name: "Jitsi Video", desc: "Free open-source video conferencing — unique room per booking, no account needed." },
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
        Meet links are generated at booking time and included in all confirmation emails.
        Disconnecting an account won't affect existing bookings.
      </p>
    </div>
  );
}
