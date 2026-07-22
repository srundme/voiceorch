import { useEffect, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GEMINI_LIVE_VOICES } from "@/lib/agent-providers";

export function GeminiLiveVoicePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (voiceName: string) => void;
}) {
  const [voices, setVoices] = useState(GEMINI_LIVE_VOICES);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    void fetch("/api/gemini-live/voices")
      .then((r) => (r.ok ? (r.json() as Promise<{ voices?: Array<{ name: string; style: string }> }>) : null))
      .then((data) => {
        if (data?.voices?.length) setVoices(data.voices as unknown as typeof GEMINI_LIVE_VOICE_PRESETS);
      })
      .catch(() => { /* keep static fallback */ });
  }, []);

  useEffect(() => () => {
    audioRef.current?.pause();
    audioRef.current = null;
  }, []);

  async function togglePreview(voiceName: string) {
    if (previewing === voiceName) {
      audioRef.current?.pause();
      audioRef.current = null;
      setPreviewing(null);
      return;
    }
    audioRef.current?.pause();
    setPreviewing(voiceName);
    setPreviewError(null);
    try {
      const res = await fetch("/api/gemini-live/voices/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceName }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `Preview failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setPreviewing(null);
        audioRef.current = null;
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        setPreviewing(null);
        setPreviewError("Could not play preview audio.");
      };
      await audio.play();
    } catch (err) {
      setPreviewing(null);
      setPreviewError(err instanceof Error ? err.message : "Preview failed");
    }
  }

  return (
    <div className="space-y-3">
      <Select value={value || "Kore"} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Select Gemini Live voice" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {voices.map((v) => (
            <SelectItem key={v.name} value={v.name}>
              {v.name} — {v.style}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex flex-wrap gap-2">
        {voices.map((v) => (
          <Button
            key={v.name}
            type="button"
            size="sm"
            variant={value === v.name ? "default" : "outline"}
            onClick={() => onChange(v.name)}
          >
            {v.name}
          </Button>
        ))}
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={!value}
        onClick={() => void togglePreview(value || "Kore")}
      >
        {previewing ? <Square className="h-3.5 w-3.5 mr-1.5" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
        {previewing ? "Stop preview" : "Preview voice"}
      </Button>
      {previewError && (
        <p className="text-[11px] text-destructive">{previewError}</p>
      )}
      <p className="text-[11px] text-muted-foreground">
        30 preset Gemini voices — custom voice cloning is not available on Live; use Classic stack + Cartesia/ElevenLabs for custom voices.
      </p>
    </div>
  );
}
