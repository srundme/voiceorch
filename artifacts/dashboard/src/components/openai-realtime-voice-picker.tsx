import { useEffect, useRef, useState } from "react";
import { Loader2, Play, Square } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEFAULT_OPENAI_REALTIME_VOICE, OPENAI_REALTIME_VOICES } from "@/lib/agent-providers";

const API = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

function voiceLabel(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function OpenAIRealtimeVoicePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (voiceName: string) => void;
}) {
  const [voices, setVoices] = useState<readonly string[]>(OPENAI_REALTIME_VOICES);
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const current = value || DEFAULT_OPENAI_REALTIME_VOICE;

  useEffect(() => {
    void customFetch<{ voices?: Array<{ name: string }> }>(`${API}/openai-realtime/voices`)
      .then((data) => {
        if (data?.voices?.length) setVoices(data.voices.map((v) => v.name));
      })
      .catch(() => { /* keep static fallback */ });
  }, []);

  function stop() {
    audioRef.current?.pause();
    audioRef.current = null;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }

  useEffect(() => stop, []);

  async function togglePreview() {
    if (state !== "idle") {
      stop();
      setState("idle");
      return;
    }
    setState("loading");
    setPreviewError(null);
    try {
      const blob = await customFetch<Blob>(`${API}/openai-realtime/voices/preview`, {
        method: "POST",
        body: JSON.stringify({ voiceName: current }),
        responseType: "blob",
        timeoutMs: 30_000,
      });
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        stop();
        setState("idle");
      };
      audio.onerror = () => {
        stop();
        setState("idle");
        setPreviewError("Could not play preview audio.");
      };
      await audio.play();
      setState("playing");
    } catch (err) {
      stop();
      setState("idle");
      setPreviewError(err instanceof Error ? err.message : "Preview failed");
    }
  }

  return (
    <div className="space-y-3">
      <Select value={current} onValueChange={(v) => { stop(); setState("idle"); onChange(v); }}>
        <SelectTrigger>
          <SelectValue placeholder="Select GPT Realtime voice" />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {voices.map((name) => (
            <SelectItem key={name} value={name}>{voiceLabel(name)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex flex-wrap gap-2">
        {voices.map((name) => (
          <Button
            key={name}
            type="button"
            size="sm"
            variant={current === name ? "default" : "outline"}
            onClick={() => { stop(); setState("idle"); onChange(name); }}
          >
            {voiceLabel(name)}
          </Button>
        ))}
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={() => void togglePreview()}>
        {state === "loading"
          ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          : state === "playing"
          ? <Square className="h-3.5 w-3.5 mr-1.5" />
          : <Play className="h-3.5 w-3.5 mr-1.5" />}
        {state === "loading" ? "Generating preview…" : state === "playing" ? "Stop preview" : "Preview voice"}
      </Button>
      {previewError && (
        <p className="text-[11px] text-destructive">{previewError}</p>
      )}
      <p className="text-[11px] text-muted-foreground">
        Preset voices spoken by gpt-realtime. Custom voice cloning is not available on GPT Realtime; use the Classic stack for cloned voices.
      </p>
    </div>
  );
}
