import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { AlertCircle, Camera, ImagePlus, Loader2, Mic, Shield } from "lucide-react";
import { WebcallPanel } from "@/components/webcall-panel";
import { Button } from "@/components/ui/button";

type JoinMeta = {
  token: string;
  agentId: number;
  agentName: string;
  label: string | null;
  purpose: string | null;
  requireCamera: boolean;
  visionMode: string | null;
};

export default function WebcallJoinPage() {
  const params = useParams<{ token: string }>();
  const token = params.token ?? "";
  const [meta, setMeta] = useState<JoinMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [consented, setConsented] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch(`/api/webcall-links/join/${encodeURIComponent(token)}`);
        const data = await resp.json().catch(() => ({})) as JoinMeta & { error?: string };
        if (!resp.ok) throw new Error(data.error || `Could not open link (${resp.status})`);
        if (!cancelled) setMeta(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Invalid link");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (error || !meta) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full rounded-2xl border border-border bg-card p-6 space-y-3 text-center">
          <AlertCircle className="h-8 w-8 text-red-400 mx-auto" />
          <h1 className="text-lg font-semibold">Link unavailable</h1>
          <p className="text-sm text-muted-foreground">{error || "This join link is invalid or expired."}</p>
        </div>
      </div>
    );
  }

  const headline = meta.label || meta.agentName || "Voice Call";

  if (!consented) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full rounded-2xl border border-border bg-card p-6 space-y-4">
          <div className="flex items-center gap-2 text-foreground">
            <Shield className="h-5 w-5" />
            <h1 className="text-lg font-semibold">{headline}</h1>
          </div>
          {meta.purpose && (
            <p className="text-sm text-muted-foreground">{meta.purpose}</p>
          )}
          <p className="text-sm text-muted-foreground leading-relaxed">
            You&apos;re about to join a live voice call with{" "}
            <span className="font-medium text-foreground">{meta.agentName}</span>.
          </p>
          <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
            <Mic className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            Microphone access is needed for this call.
          </div>
          <Button className="w-full" onClick={() => setConsented(true)}>
            Continue
          </Button>
          <p className="text-[10px] text-muted-foreground/70 text-center">
            By continuing you consent to audio use for this session.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background flex flex-col">
      <div className="px-4 py-3 border-b border-border">
        <p className="text-sm font-semibold truncate">{headline}</p>
        {meta.purpose && <p className="text-[11px] text-muted-foreground truncate">{meta.purpose}</p>}
      </div>
      <div className="flex-1 min-h-0 p-3 sm:p-6 flex justify-center">
        <div className="w-full max-w-lg h-[min(720px,calc(100dvh-5.5rem))]">
          <WebcallPanel
            agentId={meta.agentId}
            agentName={meta.agentName}
            compact
            shareToken={meta.token}
            requireCamera={meta.requireCamera}
            visionMode={meta.visionMode ?? undefined}
          />
        </div>
      </div>
    </div>
  );
}
