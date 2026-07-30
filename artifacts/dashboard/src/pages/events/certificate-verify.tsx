import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { BrandMark, PoweredBySarvam } from "@/components/logo";
import { AlertCircle, CheckCircle, Loader2 } from "lucide-react";

export default function CertificateVerifyPage() {
  const [, params] = useRoute("/events/certificates/:code/verify");
  const code = params?.code ?? "";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{
    recipientName: string;
    teamName: string;
    type: string;
    eventTitle: string | null;
    issuedAt: string;
    verificationCode: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/voiceathon/certificates/${encodeURIComponent(code)}/verify`)
      .then(async (res) => {
        if (!active) return;
        if (!res.ok) {
          setError("Certificate not found");
          return;
        }
        setData(await res.json());
      })
      .catch(() => { if (active) setError("Network error"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [code]);

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-muted/30">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-3 bg-muted/30 px-6 text-center">
        <AlertCircle className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-xl font-semibold">{error ?? "Invalid"}</h1>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center gap-4 bg-muted/30 px-6 text-center">
      <BrandMark />
      <PoweredBySarvam />
      <CheckCircle className="h-12 w-12 text-emerald-500" />
      <h1 className="text-2xl font-bold">Valid certificate</h1>
      <div className="text-sm space-y-1 max-w-md">
        <p><span className="text-muted-foreground">Recipient:</span> {data.recipientName}</p>
        <p><span className="text-muted-foreground">Team:</span> {data.teamName}</p>
        <p><span className="text-muted-foreground">Type:</span> {data.type}</p>
        <p><span className="text-muted-foreground">Event:</span> {data.eventTitle}</p>
        <p><span className="text-muted-foreground">Issued:</span> {new Date(data.issuedAt).toLocaleDateString()}</p>
        <p className="font-mono text-xs pt-2">{data.verificationCode}</p>
      </div>
    </div>
  );
}
