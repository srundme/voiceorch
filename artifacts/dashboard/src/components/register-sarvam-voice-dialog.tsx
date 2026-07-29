import { useCallback, useEffect, useState } from "react";
import { Loader2, ExternalLink } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { baseLanguage } from "@/lib/agent-providers";
import { CARTESIA_CLONE_LANGUAGES, type ClonedVoiceResult } from "@/components/clone-voice-dialog";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

const SARVAM_CLONE_LANGUAGES = CARTESIA_CLONE_LANGUAGES.filter((l) =>
  ["en", "hi", "ta", "te", "kn", "ml", "mr", "gu", "bn", "pa", "or"].includes(l.value)
    || l.value === "en",
);

function defaultLanguageFromAgent(agentLanguage?: string | null): string {
  const base = baseLanguage(agentLanguage);
  if (SARVAM_CLONE_LANGUAGES.some((l) => l.value === base)) return base;
  return "hi";
}

export function RegisterSarvamVoiceDialog({
  open,
  onOpenChange,
  onRegistered,
  defaultLanguage,
  defaultName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRegistered: (voice: ClonedVoiceResult) => void;
  defaultLanguage?: string | null;
  defaultName?: string;
}) {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState(defaultName ?? "");
  const [speakerId, setSpeakerId] = useState("");
  const [language, setLanguage] = useState(defaultLanguageFromAgent(defaultLanguage));
  const [description, setDescription] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const resetForm = useCallback(() => {
    setName(defaultName ?? "");
    setSpeakerId("");
    setLanguage(defaultLanguageFromAgent(defaultLanguage));
    setDescription("");
    setConsent(false);
    setSubmitting(false);
  }, [defaultLanguage, defaultName]);

  useEffect(() => {
    if (open) {
      setName(defaultName ?? "");
      setLanguage(defaultLanguageFromAgent(defaultLanguage));
    } else {
      resetForm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset on open/close
  }, [open]);

  async function submit() {
    if (!consent) {
      toast({
        title: "Consent required",
        description: "Confirm you own or have rights to this Sarvam cloned voice.",
        variant: "destructive",
      });
      return;
    }
    if (!name.trim() || !speakerId.trim()) {
      toast({
        title: "Missing fields",
        description: "Provide a display name and the Sarvam speaker / clone id.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API}/voices/sarvam-register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          speakerId: speakerId.trim(),
          name: name.trim(),
          language,
          description: description.trim() || undefined,
          consent: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(formatApiError(data) || `Register failed (${res.status})`);
      }
      const voice = (data as { voice: ClonedVoiceResult }).voice;
      toast({ title: "Sarvam voice added", description: `${voice.name} is ready to use.` });
      onRegistered(voice);
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Could not register voice",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Sarvam cloned voice</DialogTitle>
          <DialogDescription>
            Sarvam clones are created in{" "}
            <a
              href="https://docs.sarvam.ai/creative-voice-cloning"
              target="_blank"
              rel="noreferrer"
              className="underline inline-flex items-center gap-0.5"
            >
              Creative Studio
              <ExternalLink className="h-3 w-3" />
            </a>
            . Paste the speaker id here to use it on SnapServe agents.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="sarvam-clone-name">Display name</Label>
            <Input
              id="sarvam-clone-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Brand voice"
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sarvam-clone-speaker">Speaker / clone id</Label>
            <Input
              id="sarvam-clone-speaker"
              value={speakerId}
              onChange={(e) => setSpeakerId(e.target.value)}
              placeholder="e.g. my_brand_voice"
              className="h-9 font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Language</Label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SARVAM_CLONE_LANGUAGES.map((l) => (
                  <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sarvam-clone-desc">Notes (optional)</Label>
            <Input
              id="sarvam-clone-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="From Sarvam Studio…"
              className="h-9"
            />
          </div>
          <label className="flex items-start gap-2 text-xs text-muted-foreground leading-snug">
            <Checkbox
              checked={consent}
              onCheckedChange={(v) => setConsent(v === true)}
              className="mt-0.5"
            />
            <span>
              I created this clone in Sarvam Creative Studio and have the rights to use it
              for text-to-speech on my agents.
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add voice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
