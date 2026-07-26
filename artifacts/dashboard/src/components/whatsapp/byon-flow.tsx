/**
 * BYON panel — WhatsApp-enable an existing SnapServe voice number.
 *
 * The tricky part: Meta/VoBiz verify number ownership with an OTP call or SMS
 * to the number itself — which the owner can't answer (it's a virtual DID that
 * routes to their AI agent). While "capture" is armed, the platform answers
 * that call with a recorder + transcription and surfaces the spoken code here.
 */
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Copy, PhoneCall, Radio } from "lucide-react";

const API = "/api";

type ByonVerification = {
  id: string;
  phoneNumberId: number | null;
  phoneE164: string;
  status: string; // armed | code_captured | confirmed | expired | failed
  method: string;
  otpCode: string | null;
  hasRecording: boolean;
  transcript: string | null;
  vobizRequested: boolean;
  armed: boolean;
  armedUntil: string;
  updatedAt: string;
};

export function ByonPanel({
  voiceNumberId,
  onSelectNumber,
  metaPhoneNumberId,
  onMetaPhoneNumberId,
}: {
  voiceNumberId: number | null;
  onSelectNumber: (id: number | null) => void;
  metaPhoneNumberId: string;
  onMetaPhoneNumberId: (v: string) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: numbersData, isLoading: numbersLoading } = useQuery({
    queryKey: ["byon-numbers"],
    queryFn: () => customFetch<{ numbers: { id: number; number: string }[] }>(`${API}/whatsapp/byon/numbers`),
  });
  const numbers = numbersData?.numbers ?? [];

  // Auto-select the only number.
  useEffect(() => {
    if (voiceNumberId == null && numbers.length === 1) onSelectNumber(numbers[0]!.id);
  }, [numbers, voiceNumberId, onSelectNumber]);

  const { data: stateData } = useQuery({
    queryKey: ["byon-state", voiceNumberId],
    queryFn: () =>
      customFetch<{ verification: ByonVerification | null }>(
        `${API}/whatsapp/byon/state?phoneNumberId=${voiceNumberId}`,
      ),
    enabled: voiceNumberId != null,
    refetchInterval: (q) => (q.state.data?.verification?.armed ? 4000 : false),
  });
  const verification = stateData?.verification ?? null;

  const invalidateState = () => void qc.invalidateQueries({ queryKey: ["byon-state", voiceNumberId] });

  const arm = useMutation({
    mutationFn: () =>
      customFetch<{ verification: ByonVerification }>(`${API}/whatsapp/byon/arm`, {
        method: "POST",
        body: JSON.stringify({ phoneNumberId: voiceNumberId }),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => {
      invalidateState();
      toast({
        title: "Listening for the verification call",
        description: "Trigger the OTP now (in Meta Business Manager, choose Voice Call). The code appears here automatically.",
      });
    },
    onError: (err: Error) => toast({ title: "Could not arm capture", description: err.message, variant: "destructive" }),
  });

  const vobizVerify = useMutation({
    mutationFn: () =>
      customFetch<{ verification: ByonVerification }>(`${API}/whatsapp/byon/vobiz-verify`, {
        method: "POST",
        body: JSON.stringify({ phoneNumberId: voiceNumberId, method: "voice" }),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => {
      invalidateState();
      toast({ title: "VoBiz OTP call requested", description: "We'll auto-capture and confirm the code — watch the status below." });
    },
    onError: (err: Error) => toast({ title: "OTP request failed", description: err.message, variant: "destructive" }),
  });

  const vobizConfirm = useMutation({
    mutationFn: () =>
      customFetch<{ ok: boolean }>(`${API}/whatsapp/byon/vobiz-confirm`, {
        method: "POST",
        body: JSON.stringify({ phoneNumberId: voiceNumberId }),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => {
      invalidateState();
      toast({ title: "Number verified with VoBiz" });
    },
    onError: (err: Error) => toast({ title: "Confirm failed", description: err.message, variant: "destructive" }),
  });

  const copyCode = () => {
    if (verification?.otpCode) {
      void navigator.clipboard.writeText(verification.otpCode);
      toast({ title: "Code copied" });
    }
  };

  if (numbersLoading) {
    return <p className="mt-2 text-[11px] text-muted-foreground">Loading your voice numbers…</p>;
  }
  if (numbers.length === 0) {
    return (
      <p className="mt-2 text-[11px] text-muted-foreground">
        You don't have any active voice numbers yet. Buy one on the Phone Numbers page first, or pick another option.
      </p>
    );
  }

  return (
    <div className="mt-2 space-y-3" onClick={(e) => e.preventDefault()}>
      {/* pick the number */}
      <div>
        <Label className="text-xs">Voice number to WhatsApp-enable</Label>
        <select
          className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={voiceNumberId ?? ""}
          onChange={(e) => onSelectNumber(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Select a number…</option>
          {numbers.map((n) => (
            <option key={n.id} value={n.id}>{n.number}</option>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-muted-foreground">
          ₹0 extra — the number stays fully usable for voice calls.
        </p>
      </div>

      {voiceNumberId != null && (
        <>
          {/* OTP capture panel */}
          <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium flex items-center gap-1.5">
                <Radio className={`w-3.5 h-3.5 ${verification?.armed ? "text-emerald-400 animate-pulse" : "text-muted-foreground"}`} />
                Verification-code capture
                {verification?.armed && <span className="text-[10px] text-emerald-400">listening…</span>}
              </p>
              <div className="flex gap-1.5">
                <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={arm.isPending} onClick={() => arm.mutate()}>
                  {verification?.armed ? "Re-arm" : "Start capture"}
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={vobizVerify.isPending} onClick={() => vobizVerify.mutate()}>
                  <PhoneCall className="w-3 h-3 mr-1" /> VoBiz OTP call
                </Button>
              </div>
            </div>

            {verification?.otpCode ? (
              <div className="flex items-center gap-2">
                <code className="text-lg font-mono font-semibold tracking-[0.3em] bg-background rounded px-3 py-1 border border-emerald-500/40">
                  {verification.otpCode}
                </code>
                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={copyCode}>
                  <Copy className="w-3.5 h-3.5" />
                </Button>
                {verification.status === "confirmed" ? (
                  <span className="text-[11px] text-emerald-400">Verified with VoBiz ✓</span>
                ) : verification.vobizRequested ? (
                  <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={vobizConfirm.isPending} onClick={() => vobizConfirm.mutate()}>
                    Confirm with VoBiz
                  </Button>
                ) : (
                  <span className="text-[11px] text-muted-foreground">Type this code into Meta Business Manager</span>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                1. Click <strong>Start capture</strong>. 2. Trigger the OTP — in Meta Business Manager add this number to
                your WABA and choose <strong>Voice call</strong> verification (or use <strong>VoBiz OTP call</strong>).
                3. The call is answered &amp; transcribed automatically; the 6-digit code shows up here within ~1 minute.
              </p>
            )}

            {verification?.hasRecording && !verification?.otpCode && (
              <div className="space-y-1">
                <p className="text-[11px] text-muted-foreground">Transcription didn't find a code — listen yourself:</p>
                <audio controls className="w-full h-8" src={`${API}/whatsapp/byon/recording?phoneNumberId=${voiceNumberId}`} />
                {verification.transcript && (
                  <p className="text-[11px] text-muted-foreground italic">Heard: “{verification.transcript}”</p>
                )}
              </div>
            )}
          </div>

          {/* Meta phone number id */}
          <div>
            <Label className="text-xs">Meta Phone Number ID *</Label>
            <Input
              className="mt-1 h-9"
              placeholder="From Meta Business Manager → WhatsApp → API setup"
              value={metaPhoneNumberId}
              onChange={(e) => onMetaPhoneNumberId(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              After the number is verified in your WABA, Meta shows its Phone Number ID — paste it here, then hit Connect.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
