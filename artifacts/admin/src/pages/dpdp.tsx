import { useState } from "react";
import { useDpdpErasure } from "@/hooks/use-admin-api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ShieldX, Info, Loader2 } from "lucide-react";

export default function DpdpPage() {
  const { mutate: erase, isPending } = useDpdpErasure();
  const { toast } = useToast();

  const [phoneNumber, setPhoneNumber] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const trimmed = phoneNumber.trim();

  const handleErase = () => {
    setConfirmOpen(false);
    erase(trimmed, {
      onSuccess: ({ anonymizedCalls }) => {
        toast({
          title: "Erasure processed",
          description: `Anonymized ${anonymizedCalls} call${anonymizedCalls !== 1 ? "s" : ""} for ${trimmed}.`,
        });
        setPhoneNumber("");
      },
      onError: (err) => {
        toast({ title: "Erasure failed", description: (err as Error).message, variant: "destructive" });
      },
    });
  };

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold">DPDP Data Erasure</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Right to be forgotten under the Digital Personal Data Protection Act 2023.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldX className="h-5 w-5 text-destructive" />
            Erase a recipient's call data
          </CardTitle>
          <CardDescription>
            Anonymizes all stored call logs, transcripts, and recordings tied to a phone number, and
            records an audit row. This is permanent and cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              This action is admin-triggered only and never affects live or future calls — it only
              anonymizes data already on record.
            </span>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dpdp-phone" className="text-sm">Phone number</Label>
            <Input
              id="dpdp-phone"
              placeholder="e.g. +919876543210"
              value={phoneNumber}
              onChange={e => setPhoneNumber(e.target.value)}
              disabled={isPending}
            />
          </div>

          <Button
            variant="destructive"
            disabled={!trimmed || isPending}
            onClick={() => setConfirmOpen(true)}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldX className="h-4 w-4" />}
            {isPending ? "Processing…" : "Erase data"}
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Erase all data for {trimmed}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently anonymizes every stored call log, transcript, and recording for this
              phone number and records a DPDP erasure audit entry. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleErase}
            >
              Erase data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
