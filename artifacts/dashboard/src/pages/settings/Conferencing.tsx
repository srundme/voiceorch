import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Video, CheckCircle2, XCircle, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

type GCalStatus = { connected: boolean; email: string | null };

async function fetchGCalStatus(): Promise<GCalStatus> {
  const r = await fetch(`${API}/scheduling/google/status`, { credentials: "include" });
  if (!r.ok) throw new Error("Failed to fetch status");
  return r.json();
}

async function disconnectGCal(): Promise<void> {
  const r = await fetch(`${API}/scheduling/google/disconnect`, { method: "DELETE", credentials: "include" });
  if (!r.ok) throw new Error("Failed to disconnect");
}

export default function ConferencingPage() {
  const [status, setStatus] = useState<GCalStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const { toast } = useToast();
  const [location] = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gcal = params.get("gcal");
    if (gcal === "connected") {
      toast({ title: "Google Calendar connected!", description: "Meet links will be auto-generated for new bookings." });
      window.history.replaceState({}, "", window.location.pathname);
    } else if (gcal === "error") {
      toast({ title: "Connection failed", description: "Something went wrong with Google OAuth. Please try again.", variant: "destructive" });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    fetchGCalStatus()
      .then(setStatus)
      .catch(() => setStatus({ connected: false, email: null }))
      .finally(() => setLoading(false));
  }, []);

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await disconnectGCal();
      setStatus({ connected: false, email: null });
      toast({ title: "Google Calendar disconnected" });
    } catch {
      toast({ title: "Failed to disconnect", variant: "destructive" });
    } finally {
      setDisconnecting(false);
    }
  }

  function handleConnect() {
    window.location.href = `${API}/scheduling/google/connect`;
  }

  const conferencing = [
    {
      id: "google-meet",
      name: "Google Meet",
      description: "Automatically create Google Meet video links when a booking is confirmed. Attendees and host both receive the link in their email.",
      logo: "https://www.gstatic.com/meet/google_meet_horizontal_wordmark_2020q4_2x_icon_124_40_2373e79660dabbf194273d27aa7ee1f5.png",
      logoFallback: "Meet",
      color: "bg-blue-50",
      textColor: "text-blue-700",
      borderColor: "border-blue-200",
      available: true,
    },
    {
      id: "zoom",
      name: "Zoom",
      description: "Generate Zoom meeting links automatically on each booking. Requires a Zoom OAuth app.",
      logo: null,
      logoFallback: "Z",
      color: "bg-sky-50",
      textColor: "text-sky-700",
      borderColor: "border-sky-200",
      available: false,
      comingSoon: true,
    },
    {
      id: "jitsi",
      name: "Jitsi Video",
      description: "Free open-source video conferencing. No account required — a unique Jitsi room is generated per booking.",
      logo: null,
      logoFallback: "J",
      color: "bg-purple-50",
      textColor: "text-purple-700",
      borderColor: "border-purple-200",
      available: false,
      comingSoon: true,
    },
    {
      id: "teams",
      name: "Microsoft Teams",
      description: "Generate Teams meeting links. Requires a Microsoft 365 work/school account.",
      logo: null,
      logoFallback: "T",
      color: "bg-indigo-50",
      textColor: "text-indigo-700",
      borderColor: "border-indigo-200",
      available: false,
      comingSoon: true,
    },
  ];

  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold">Conferencing</h1>
        <p className="text-sm text-muted-foreground">
          Connect a video conferencing tool — links are auto-generated and included in every booking email
        </p>
      </div>

      <div className="space-y-4">
        {conferencing.map((app) => {
          const isGoogleMeet = app.id === "google-meet";
          const connected = isGoogleMeet && status?.connected;

          return (
            <Card key={app.id} className={`border ${connected ? "border-emerald-300 bg-emerald-50/30" : ""}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl ${app.color} flex items-center justify-center shrink-0 border ${app.borderColor}`}>
                      {app.logo ? (
                        <img src={app.logo} alt={app.name} className="w-6 h-6 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      ) : (
                        <span className={`font-bold text-sm ${app.textColor}`}>{app.logoFallback}</span>
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base">{app.name}</CardTitle>
                        {connected && (
                          <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-xs">
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Connected
                          </Badge>
                        )}
                        {app.comingSoon && (
                          <Badge variant="outline" className="text-xs text-muted-foreground">Coming soon</Badge>
                        )}
                      </div>
                      {isGoogleMeet && status?.email && (
                        <p className="text-xs text-muted-foreground mt-0.5">{status.email}</p>
                      )}
                    </div>
                  </div>

                  <div className="shrink-0">
                    {isGoogleMeet && (
                      loading ? (
                        <Button variant="outline" size="sm" disabled>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        </Button>
                      ) : connected ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleDisconnect}
                          disabled={disconnecting}
                          className="text-destructive border-destructive/30 hover:bg-destructive/5"
                        >
                          {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Disconnect"}
                        </Button>
                      ) : (
                        <Button size="sm" onClick={handleConnect} className="gap-1.5">
                          <Video className="h-3.5 w-3.5" /> Connect
                        </Button>
                      )
                    )}
                    {app.comingSoon && (
                      <Button variant="outline" size="sm" disabled>Coming soon</Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <CardDescription className="text-sm">{app.description}</CardDescription>

                {isGoogleMeet && connected && (
                  <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                    <p className="text-xs text-emerald-700 font-medium">✓ Active — Google Meet links will be created automatically for all new bookings</p>
                    <p className="text-xs text-emerald-600 mt-0.5">The Meet link is included in both the attendee confirmation email and the host notification email.</p>
                  </div>
                )}

                {isGoogleMeet && !connected && !loading && (
                  <div className="mt-3 p-3 bg-muted/40 rounded-lg">
                    <p className="text-xs text-muted-foreground">
                      Click <strong>Connect</strong> to sign in with Google. You'll choose which Google account to use — your users never need to touch the Google Cloud Console.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="text-xs text-muted-foreground border-t pt-4">
        Conferencing links are generated at booking time and included in confirmation emails. Only one conferencing tool can be active per account.
      </div>
    </div>
  );
}
