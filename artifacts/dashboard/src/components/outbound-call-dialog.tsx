import { useState } from "react";
import { Link, useLocation } from "wouter";
import { PhoneOutgoing, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useInitiateOutboundCall } from "@workspace/api-client-react";
import { formatApiError, isKycError, isDestinationUnverifiedError } from "@/lib/format-api-error";
import { DestinationOtpDialog } from "@/components/destination-otp-dialog";
import { RecentNumbersList } from "@/components/recent-numbers-list";
import { useRecentNumbers } from "@/hooks/use-recent-numbers";

interface OutboundCallDialogProps {
  agentId: number;
  agentName: string;
  telephonyProvider: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OutboundCallDialog({
  agentId,
  agentName,
  telephonyProvider,
  open,
  onOpenChange,
}: OutboundCallDialogProps) {
  const [toNumber, setToNumber] = useState("");
  const [otpDialogOpen, setOtpDialogOpen] = useState(false);
  const [pendingCallNumber, setPendingCallNumber] = useState("");
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { recentNumbers, recordNumber, removeNumber } = useRecentNumbers();
  const outboundCall = useInitiateOutboundCall();

  function handleMakeCall(overrideNumber?: string) {
    const dest = (overrideNumber ?? toNumber).trim();
    if (!dest) return;
    recordNumber(dest);
    outboundCall.mutate(
      { data: { agentId, toNumber: dest, webhookBaseUrl: window.location.origin } },
      {
        onSuccess: () => {
          toast({
            title: "Call initiated",
            description: `Dialing ${dest} — the agent will connect momentarily.`,
          });
          onOpenChange(false);
          setToNumber("");
        },
        onError: (err: unknown) => {
          if (isKycError(err)) {
            toast({
              title: "Verification required",
              description: "Complete identity verification before making telephony calls.",
              variant: "destructive",
            });
            navigate("/app/kyc");
          } else if (isDestinationUnverifiedError(err)) {
            setPendingCallNumber(dest);
            setOtpDialogOpen(true);
          } else {
            toast({ title: "Call failed", description: formatApiError(err), variant: "destructive" });
          }
        },
      }
    );
  }

  const provider = telephonyProvider || "telephony";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md rounded-2xl sm:rounded-lg bottom-4 top-auto translate-y-0 data-[state=open]:slide-in-from-bottom-4 sm:bottom-auto sm:top-[50%] sm:translate-y-[-50%] sm:data-[state=open]:slide-in-from-top-[48%]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PhoneOutgoing className="h-5 w-5 text-primary" />
              Make a Phone Call
            </DialogTitle>
            <DialogDescription>
              This will dial the number using your{" "}
              <span className="font-medium capitalize">{provider}</span> account. The agent{" "}
              <span className="font-medium">{agentName}</span> will handle the conversation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="outbound-to-number">Destination number (E.164 format)</Label>
              <Input
                id="outbound-to-number"
                placeholder="+1234567890"
                value={toNumber}
                onChange={(e) => setToNumber(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleMakeCall();
                }}
                className="h-12 text-base"
                inputMode="tel"
              />
              <p className="text-xs text-muted-foreground">
                Include country code, e.g.{" "}
                <code className="font-mono bg-muted px-1 rounded">+14155552671</code>
              </p>
              <RecentNumbersList
                numbers={recentNumbers}
                onSelect={setToNumber}
                onRemove={removeNumber}
              />
            </div>
            <div className="rounded-md bg-muted/50 border p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Before making a call, ensure:</p>
              <p>
                • Your <span className="font-medium capitalize">{provider}</span> provider key is
                configured on the{" "}
                <Link href="/providers" className="underline">
                  Providers page
                </Link>
              </p>
              {provider === "twilio" && (
                <p>
                  • Extra Config includes{" "}
                  <code className="font-mono bg-muted px-1">accountSid</code> and{" "}
                  <code className="font-mono bg-muted px-1">fromNumber</code>
                </p>
              )}
              {provider === "plivo" && (
                <p>
                  • Extra Config includes{" "}
                  <code className="font-mono bg-muted px-1">authId</code> and{" "}
                  <code className="font-mono bg-muted px-1">fromNumber</code>
                </p>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" className="h-11 min-h-11" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => handleMakeCall()}
              disabled={!toNumber.trim() || outboundCall.isPending}
              className="gap-2 h-11 min-h-11"
            >
              {outboundCall.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PhoneOutgoing className="h-4 w-4" />
              )}
              {outboundCall.isPending ? "Dialing…" : "Call Now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DestinationOtpDialog
        open={otpDialogOpen}
        phoneNumber={pendingCallNumber}
        onClose={() => setOtpDialogOpen(false)}
        onVerified={() => {
          setOtpDialogOpen(false);
          handleMakeCall(pendingCallNumber);
        }}
      />
    </>
  );
}
