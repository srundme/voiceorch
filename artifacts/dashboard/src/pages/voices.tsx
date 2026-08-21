import { useState, useMemo, useRef, useEffect } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Mic2, Search, Play, Square, AlertTriangle, Star, ArrowUpDown, User } from "lucide-react";
import { formatApiError } from "@/lib/format-api-error";
import { cn } from "@/lib/utils";
import { getVoiceAvatar, resolveVoiceGenderLabel } from "@/lib/voice-avatars";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;
const FAVORITES_KEY = "voiceorch:favoriteVoices";

interface Voice {
  id: string;
  name: string;
  language: string;
  description: string;
  isListed: boolean;
  gender?: string;
}

/* ── UI-only display helpers ─────────────────────────────────────────────── */

const GENDER_OPTIONS = ["Female", "Male"] as const;
function inferGender(voice: Voice): (typeof GENDER_OPTIONS)[number] {
  return resolveVoiceGenderLabel(voice.id, voice.gender, voice.description);
}

const ACCENT_BY_LANG_PREFIX: Record<string, string> = {
  "hi": "Indian",
  "ta": "Indian",
  "en-in": "Indian",
  "en-us": "American",
  "en-gb": "British",
  "en-au": "Australian",
};
function inferAccent(language: string): string {
  const key = language.toLowerCase();
  return ACCENT_BY_LANG_PREFIX[key] ?? ACCENT_BY_LANG_PREFIX[key.split("-")[0] ?? key] ?? "Neutral";
}

const METADATA_PILL_CLASS =
  "h-5 px-1.5 inline-flex items-center justify-center gap-1 rounded-full text-[10px] font-medium leading-none";

function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveFavorites(favs: Set<string>) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(favs)));
  } catch {
    /* ignore quota/storage errors — favorites are a nice-to-have */
  }
}

type SortOption = "name-asc" | "name-desc" | "language";

export default function VoicesPage() {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [search, setSearch] = useState("");
  const [langFilter, setLangFilter] = useState("all");
  const [genderFilter, setGenderFilter] = useState("all");
  const [accentFilter, setAccentFilter] = useState("all");
  const [sortBy, setSortBy] = useState<SortOption>("name-asc");
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites());
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const { toast } = useToast();
  const { getToken } = useAuth();

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

  function toggleFavorite(id: string) {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveFavorites(next);
      return next;
    });
  }

  async function previewVoice(voice: { id: string; provider?: string; language?: string }) {
    if (currentAudioRef.current) {
      currentAudioRef.current.onended = null;
      currentAudioRef.current.onerror = null;
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
      const provider = voice.provider === "sarvam" ? "sarvam" : "cartesia";
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (provider === "sarvam") {
        const token = await getToken();
        if (token) headers.Authorization = `Bearer ${token}`;
      }
      const res = await fetch(`${API}/voices/preview`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          voiceId: voice.id,
          provider,
          language: voice.language,
        }),
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
    return Array.from(new Set(voices.map((v) => v.language))).sort();
  }, [voices]);

  const accents = useMemo(() => {
    return Array.from(new Set(voices.map((v) => inferAccent(v.language)))).sort();
  }, [voices]);

  const INDIAN_LANGS = new Set(["hi", "hi-IN", "ta", "ta-IN"]);

  const filtered = useMemo(() => {
    const list = voices.filter((v) => {
      const matchesSearch =
        !search ||
        v.name.toLowerCase().includes(search.toLowerCase()) ||
        (v.description ?? "").toLowerCase().includes(search.toLowerCase());
      const isEnglishFilter = langFilter.startsWith("en") || langFilter === "en";
      const matchesLang =
        langFilter === "all" ||
        v.language === langFilter ||
        (isEnglishFilter && INDIAN_LANGS.has(v.language));
      const matchesGender = genderFilter === "all" || inferGender(v) === genderFilter;
      const matchesAccent = accentFilter === "all" || inferAccent(v.language) === accentFilter;
      return matchesSearch && matchesLang && matchesGender && matchesAccent;
    });
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sortBy === "name-asc") return a.name.localeCompare(b.name);
      if (sortBy === "name-desc") return b.name.localeCompare(a.name);
      return a.language.localeCompare(b.language) || a.name.localeCompare(b.name);
    });
    return sorted;
  }, [voices, search, langFilter, genderFilter, accentFilter, sortBy]);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
      <div className="max-w-6xl mx-auto w-full p-4 sm:p-6 space-y-6">
        <p className="text-muted-foreground text-sm">
          Whitelisted Cartesia voices. Clones are under Provider keys → My clones.
        </p>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <div className="text-sm">
              <strong className="text-destructive">Could not load voices</strong>
              <span className="text-muted-foreground"> — {error.message || "check that the API server is reachable and try again."}</span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-2">
          <h2 className="text-sm font-semibold tracking-tight">Library</h2>
        </div>

        <div className="flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by name or description…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9 text-xs bg-muted/30"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={langFilter} onValueChange={setLangFilter}>
              <SelectTrigger className="w-[9.5rem] h-9 text-xs bg-muted/30">
                <SelectValue placeholder="Language" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All languages</SelectItem>
                {languages.map((l) => (
                  <SelectItem key={l} value={l}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={genderFilter} onValueChange={setGenderFilter}>
              <SelectTrigger className="w-[8.5rem] h-9 text-xs bg-muted/30">
                <SelectValue placeholder="Gender" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All genders</SelectItem>
                {GENDER_OPTIONS.map((g) => (
                  <SelectItem key={g} value={g}>{g}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={accentFilter} onValueChange={setAccentFilter}>
              <SelectTrigger className="w-[8.5rem] h-9 text-xs bg-muted/30">
                <SelectValue placeholder="Accent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All accents</SelectItem>
                {accents.map((a) => (
                  <SelectItem key={a} value={a}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
              <SelectTrigger className="w-[10.5rem] h-9 text-xs bg-muted/30">
                <ArrowUpDown className="h-3 w-3 mr-1 text-muted-foreground shrink-0" />
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name-asc">Name (A–Z)</SelectItem>
                <SelectItem value="name-desc">Name (Z–A)</SelectItem>
                <SelectItem value="language">Language</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border/60 bg-card/40 p-4 h-[168px] animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 p-10 text-center text-sm text-muted-foreground">
            No voices match your filters.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((voice) => {
              const isPreviewing = previewingId === voice.id;
              const isFavorite = favorites.has(voice.id);
              const gender = inferGender(voice);
              const accent = inferAccent(voice.language);
              return (
                <Card
                  key={voice.id}
                  className="group relative flex flex-col h-full border border-border/60 bg-card/60 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200"
                >
                  <button
                    onClick={() => toggleFavorite(voice.id)}
                    aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
                    aria-pressed={isFavorite}
                    className="absolute top-3 right-3 z-10 h-7 w-7 flex items-center justify-center rounded-full text-muted-foreground/50 hover:text-amber-400 hover:bg-amber-400/10 transition-colors"
                  >
                    <Star className={cn("h-4 w-4", isFavorite && "fill-amber-400 text-amber-400")} />
                  </button>

                  <CardContent className="p-5 flex flex-col gap-3 h-full">
                    <div className="flex items-start gap-3 pr-6">
                      <img
                        src={getVoiceAvatar(voice.id, voice.gender, voice.description)}
                        alt=""
                        className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-border/60"
                      />
                      <div className="min-w-0 flex-1 pt-0.5">
                        <p className="text-sm font-semibold text-foreground truncate">{voice.name}</p>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          <Badge variant="outline" className={cn(METADATA_PILL_CLASS, "uppercase")}>
                            {voice.language.toUpperCase()}
                          </Badge>
                          <Badge variant="outline" className={METADATA_PILL_CLASS}>
                            <User className="h-2.5 w-2.5" />
                            {gender}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={METADATA_PILL_CLASS}
                            title={accent}
                            aria-label={accent}
                          >
                            {accent}
                          </Badge>
                        </div>
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 flex-1">
                      {voice.description || "No description provided."}
                    </p>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5 gap-1">
                        <Mic2 className="h-2.5 w-2.5" /> Cartesia
                      </Badge>
                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-[10px] px-1.5 py-0.5",
                          voice.isListed
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {voice.isListed ? "Listed" : "Available"}
                      </Badge>
                    </div>

                    <div className="pt-1 mt-auto border-t border-border/40 flex items-center justify-between">
                      <span className="text-[9px] text-muted-foreground/50 font-mono truncate">{voice.id.slice(0, 10)}…</span>
                      <button
                        onClick={() => void previewVoice(voice)}
                        disabled={previewingId !== null && !isPreviewing}
                        className={cn(
                          "h-8 px-3 flex items-center gap-1.5 rounded-md border text-xs font-medium transition-colors disabled:opacity-40",
                          isPreviewing
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground",
                        )}
                        aria-label={isPreviewing ? "Stop preview" : "Preview voice"}
                      >
                        {isPreviewing ? (
                          <><Square className="h-3 w-3 fill-current" /> Stop</>
                        ) : (
                          <><Play className="h-3 w-3" /> Preview</>
                        )}
                      </button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <div className="text-xs text-muted-foreground">
          {loading ? "" : `Showing ${filtered.length} of ${voices.length} library voices`}
        </div>
      </div>
    </div>
  );
}
