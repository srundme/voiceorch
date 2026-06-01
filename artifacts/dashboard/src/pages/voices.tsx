import { useState, useMemo, useRef, useEffect } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Mic2, Loader2, Search, Play, AlertTriangle, Info } from "lucide-react";
import { formatApiError } from "@/lib/format-api-error";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

interface Voice {
  id: string;
  name: string;
  language: string;
  description: string;
  isListed: boolean;
}

export default function VoicesPage() {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [search, setSearch] = useState("");
  const [langFilter, setLangFilter] = useState("all");
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    customFetch<{ voices: Voice[] }>(`${API}/voices/whitelisted`)
      .then((data) => {
        if (!cancelled) {
          setVoices(data.voices);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function previewVoice(voice: Voice) {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.src = "";
      currentAudioRef.current = null;
    }
    if (previewingId === voice.id) {
      setPreviewingId(null);
      return;
    }
    setPreviewingId(voice.id);
    try {
      const res = await fetch(`${API}/voices/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceId: voice.id }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(errData.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudioRef.current = audio;
      audio.onended = () => {
        setPreviewingId(null);
        currentAudioRef.current = null;
        URL.revokeObjectURL(url);
      };
      audio.onerror = () => {
        setPreviewingId(null);
        currentAudioRef.current = null;
        URL.revokeObjectURL(url);
        toast({ title: "Playback failed", variant: "destructive" });
      };
      await audio.play();
    } catch (err) {
      setPreviewingId(null);
      currentAudioRef.current = null;
      toast({ title: "Preview failed", description: formatApiError(err), variant: "destructive" });
    }
  }

  const languages = useMemo(() => {
    const langs = Array.from(new Set(voices.map((v) => v.language))).sort();
    return langs;
  }, [voices]);

  const filtered = useMemo(() => {
    return voices.filter((v) => {
      const matchesSearch =
        !search ||
        v.name.toLowerCase().includes(search.toLowerCase()) ||
        (v.description ?? "").toLowerCase().includes(search.toLowerCase());
      const matchesLang = langFilter === "all" || v.language === langFilter;
      return matchesSearch && matchesLang;
    });
  }, [voices, search, langFilter]);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
      <div className="max-w-5xl mx-auto w-full p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Voices</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              All whitelisted voices available for your agents.
            </p>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <div className="text-sm">
              <strong className="text-destructive">Could not load voices</strong>
              <span className="text-muted-foreground"> — {error.message || "check that the API server is reachable and try again."}</span>
            </div>
          </div>
        )}

        <div className="rounded-md border border-primary/20 bg-primary/5 p-4 flex items-start gap-3">
          <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div className="text-sm text-muted-foreground">
            <strong className="text-foreground">What is this?</strong> These are the Cartesia voices approved by the platform admin. Pick any of them when configuring your agent.
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by name or description…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs bg-muted/30"
            />
          </div>
          <Select value={langFilter} onValueChange={setLangFilter}>
            <SelectTrigger className="w-36 h-8 text-xs bg-muted/30">
              <SelectValue placeholder="Language" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All languages</SelectItem>
              {languages.map((l) => (
                <SelectItem key={l} value={l}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm p-6">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading whitelisted voices…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No voices match your filters.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((voice) => (
              <Card key={voice.id} className="border border-border hover:border-primary/30 transition-colors">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Mic2 className="h-3.5 w-3.5 text-muted-foreground/50" />
                        <p className="text-sm font-medium text-foreground truncate">{voice.name}</p>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">{voice.language}</p>
                    </div>
                    <button
                      onClick={() => void previewVoice(voice)}
                      disabled={previewingId !== null && previewingId !== voice.id}
                      className="h-7 w-7 shrink-0 flex items-center justify-center rounded-md border border-border bg-elevated hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                      aria-label={previewingId === voice.id ? "Stop preview" : "Preview voice"}
                    >
                      {previewingId === voice.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground line-clamp-2">{voice.description || "No description"}</p>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5">
                      Listed
                    </Badge>
                    <span className="text-[9px] text-muted-foreground/50 font-mono">{voice.id.slice(0, 8)}…</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <div className="text-xs text-muted-foreground">
          {loading ? "" : `Showing ${filtered.length} of ${voices.length} voices`}
        </div>
      </div>
    </div>
  );
}
