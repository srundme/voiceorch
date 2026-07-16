import { useState } from "react";
import { useAuth } from "@/lib/auth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Phone, ShieldCheck } from "lucide-react";

interface Props {
  open:        boolean;
  phoneNumber: string;
  onClose:     () => void;
  onVerified:  () => void;
}

type Step = "send" | "verify";

export function DestinationOtpDialog({ open, phoneNumber, onClose, onVerified }: Props) {
  const { getToken } = useAuth();
  const { toast }    = useToast();

  const [step,    setStep]    = useState<Step>("send");
  const [otp,     setOtp]     = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);

  async function buildHeaders(): Promise<Record<string, string>> {
    const token = await getToken();
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (token) h["Authorization"] = `Bearer ${token}`;
    return h;
  }

  async function handleSend() {
    setSending(true);
    try {
      const resp = await fetch("/api/calls/send-destination-otp", {
        method:  "POST",
        headers: await buildHeaders(),
        body:    JSON.stringify({ phoneNumber }),
      });
      const data = await resp.json() as { error?: string };
      if (!resp.ok) throw new Error(data.error ?? "Failed to send OTP");
      setStep("verify");
      toast({ title: "OTP sent", description: `A 6-digit code was sent to ${phoneNumber}.` });
    } catch (err: unknown) {
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  async function handleVerify() {
    if (!otp.trim()) return;
    setVerifying(true);
    try {
      const resp = await fetch("/api/calls/verify-destination-otp", {
        method:  "POST",
        headers: await buildHeaders(),
        body:    JSON.stringify({ phoneNumber, otp: otp.trim() }),
      });
      const data = await resp.json() as { error?: string; verified?: boolean };
      if (!resp.ok) throw new Error(data.error ?? "Verification failed");
      toast({ title: "Number verified", description: `${phoneNumber} is verified for 30 days.` });
      setOtp("");
      setStep("send");
      onVerified();
    } catch (err: unknown) {
      toast({ title: "Invalid OTP", description: (err as Error).message, variant: "destructive" });
    } finally {
      setVerifying(false);
    }
  }

  function handleClose() {
    setOtp("");
    setStep("send");
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md rounded-2xl sm:rounded-lg bottom-4 top-auto translate-y-0 data-[state=open]:slide-in-from-bottom-4 sm:bottom-auto sm:top-[50%] sm:translate-y-[-50%] sm:data-[state=open]:slide-in-from-top-[48%]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Verify Destination Number
          </DialogTitle>
          <DialogDescription>
            Without identity verification (KYC), you must confirm each destination number before calling.
            This verification is valid for 30 days.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="rounded-lg border bg-muted/40 px-4 py-3 flex items-center gap-3">
            <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="font-mono text-sm">{phoneNumber}</span>
          </div>

          {step === "send" ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                We'll send a one-time code via SMS to confirm you have access to this number.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 h-11 min-h-11" onClick={handleClose}>Cancel</Button>
                <Button className="flex-1 h-11 min-h-11" onClick={handleSend} disabled={sending}>
                  {sending
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending…</>
                    : "Send OTP"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="otp-input">Enter the 6-digit code</Label>
                <Input
                  id="otp-input"
                  value={otp}
                  onChange={e => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  onKeyDown={e => e.key === "Enter" && otp.length === 6 && handleVerify()}
                  placeholder="123456"
                  className="font-mono text-center text-lg tracking-widest h-12"
                  maxLength={6}
                  autoFocus
                  inputMode="numeric"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Didn't receive it?{" "}
                <button
                  className="underline hover:no-underline"
                  onClick={() => { setStep("send"); setOtp(""); }}
                >
                  Resend
                </button>
              </p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 h-11 min-h-11" onClick={handleClose}>Cancel</Button>
                <Button
                  className="flex-1 h-11 min-h-11"
                  onClick={handleVerify}
                  disabled={verifying || otp.length !== 6}
                >
                  {verifying
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Verifying…</>
                    : "Verify & Call"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
