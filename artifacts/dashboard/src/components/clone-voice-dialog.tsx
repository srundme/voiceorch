import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square, Upload, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

/** Languages Cartesia instant clone commonly accepts (base codes). */
export const CARTESIA_CLONE_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "ta", label: "Tamil" },
  { value: "te", label: "Telugu" },
  { value: "kn", label: "Kannada" },
  { value: "ml", label: "Malayalam" },
  { value: "mr", label: "Marathi" },
  { value: "gu", label: "Gujarati" },
  { value: "bn", label: "Bengali" },
  { value: "pa", label: "Punjabi" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "pt", label: "Portuguese" },
  { value: "it", label: "Italian" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "zh", label: "Chinese" },
  { value: "ar", label: "Arabic" },
  { value: "id", label: "Indonesian" },
  { value: "th", label: "Thai" },
  { value: "vi", label: "Vietnamese" },
  { value: "tr", label: "Turkish" },
  { value: "ru", label: "Russian" },
  { value: "nl", label: "Dutch" },
  { value: "pl", label: "Polish" },
] as const;

export interface ClonedVoiceResult {
  id: string;
  name: string;
  language: string;
  description?: string;
  dbId?: number;
  createdAt?: string;
}

const MAX_RECORD_SECS = 10;
const MIN_RECORD_SECS = 3;

function defaultLanguageFromAgent(agentLanguage?: string | null): string {
  const base = baseLanguage(agentLanguage);
  if (CARTESIA_CLONE_LANGUAGES.some((l) => l.value === base)) return base;
  return "en";
}

export function CloneVoiceDialog({
  open,
  onOpenChange,
  onCloned,
  defaultLanguage,
  defaultName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloned: (voice: ClonedVoiceResult) => void;
  defaultLanguage?: string | null;
  defaultName?: string;
}) {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState(defaultName ?? "");
  const [language, setLanguage] = useState(defaultLanguageFromAgent(defaultLanguage));
  const [clip, setClip] = useState<File | null>(null);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const clearClip = useCallback(() => {
    setClip(null);
    if (clipUrl) URL.revokeObjectURL(clipUrl);
    setClipUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [clipUrl]);

  const resetForm = useCallback(() => {
    stopRecordingInternal();
    clearClip();
    setName(defaultName ?? "");
    setLanguage(defaultLanguageFromAgent(defaultLanguage));
    setRecordSecs(0);
    setSubmitting(false);
  }, [clearClip, defaultLanguage, defaultName]);

  useEffect(() => {
    if (open) {
      setName(defaultName ?? "");
      setLanguage(defaultLanguageFromAgent(defaultLanguage));
    } else {
      resetForm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset on open/close
  }, [open]);

  useEffect(() => () => {
    stopRecordingInternal();
    if (clipUrl) URL.revokeObjectURL(clipUrl);
  }, [clipUrl]);

  function stopRecordingInternal() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    } catch { /* ignore */ }
    mediaRecorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setRecording(false);
  }

  function setClipFile(file: File) {
    if (clipUrl) URL.revokeObjectURL(clipUrl);
    setClip(file);
    setClipUrl(URL.createObjectURL(file));
  }

  async function startRecording() {
    clearClip();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : undefined;
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const file = new File([blob], `clone-${Date.now()}.webm`, { type: blob.type });
        setClipFile(file);
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };
      mediaRecorderRef.current = recorder;
      recorder.start(200);
      setRecording(true);
      setRecordSecs(0);
      timerRef.current = setInterval(() => {
        setRecordSecs((s) => {
          const next = s + 1;
          if (next >= MAX_RECORD_SECS) {
            stopRecording();
          }
          return next;
        });
      }, 1000);
    } catch {
      toast({
        title: "Microphone unavailable",
        description: "Allow mic access or upload an audio file instead.",
        variant: "destructive",
      });
    }
  }

  function stopRecording() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
    } catch { /* ignore */ }
    mediaRecorderRef.current = null;
    setRecording(false);
  }

  async function handleSubmit() {
    if (!name.trim()) {
      toast({ title: "Name required", description: "Give your cloned voice a name.", variant: "destructive" });
      return;
    }
    if (!clip) {
      toast({ title: "Audio required", description: "Record or upload a 3–10 second clip.", variant: "destructive" });
      return;
    }
    if (recording) {
      toast({ title: "Still recording", description: "Stop the recording first.", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("clip", clip);
      form.append("name", name.trim());
      form.append("language", language);
      const token = await getToken();
      const res = await fetch(`${API}/voices/clone`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      });
      if (!res.ok) {
        let msg = `Clone failed (${res.status})`;
        try {
          const body = await res.json() as { error?: string };
          if (body?.error) msg = body.error;
        } catch { /* ignore */ }
        throw new Error(msg);
      }
      const data = await res.json() as { voice: ClonedVoiceResult };
      toast({ title: "Voice cloned", description: `"${data.voice.name}" is ready to use.` });
      onCloned(data.voice);
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Clone failed", description: formatApiError(err), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!submitting) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Clone my voice</DialogTitle>
          <DialogDescription>
            Record or upload a clear 3–10 second clip. Speak in the language you want the agent to use.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="clone-name">Voice name</Label>
            <Input
              id="clone-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My voice"
              maxLength={80}
              disabled={submitting}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Language</Label>
            <Select value={language} onValueChange={setLanguage} disabled={submitting}>
              <SelectTrigger>
                <SelectValue placeholder="Select language" />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {CARTESIA_CLONE_LANGUAGES.map((l) => (
                  <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Audio clip</Label>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Quiet room, speak clearly, avoid long pauses. Ideal length: {MIN_RECORD_SECS}–{MAX_RECORD_SECS} seconds.
            </p>
            <div className="flex flex-wrap gap-2">
              {!recording ? (
                <Button type="button" variant="outline" size="sm" onClick={() => void startRecording()} disabled={submitting}>
                  <Mic className="h-3.5 w-3.5 mr-1.5" />
                  Record
                </Button>
              ) : (
                <Button type="button" variant="destructive" size="sm" onClick={stopRecording}>
                  <Square className="h-3.5 w-3.5 mr-1.5" />
                  Stop ({recordSecs}s)
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={submitting || recording}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-3.5 w-3.5 mr-1.5" />
                Upload
              </Button>
              {clip && (
                <Button type="button" variant="ghost" size="sm" onClick={clearClip} disabled={submitting || recording}>
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Clear
                </Button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.wav,.mp3,.m4a,.webm,.ogg,.flac"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setClipFile(f);
                }}
              />
            </div>
            {recording && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                Recording… auto-stops at {MAX_RECORD_SECS}s.
              </p>
            )}
            {clip && clipUrl && (
              <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 space-y-1.5">
                <p className="text-[11px] text-muted-foreground truncate">{clip.name}</p>
                <audio src={clipUrl} controls className="w-full h-8" />
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={submitting || recording || !clip}>
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Cloning…
              </>
            ) : (
              "Clone voice"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
