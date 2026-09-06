import { useCallback, useEffect, useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { ChevronDown, Loader2, Play, Square, Trash2 } from "lucide-react";
import { formatApiError } from "@/lib/format-api-error";
import { cn } from "@/lib/utils";
import { CloneVoiceDialog, type ClonedVoiceResult } from "@/components/clone-voice-dialog";
import { RegisterSarvamVoiceDialog } from "@/components/register-sarvam-voice-dialog";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api`;

const METADATA_PILL_CLASS =
  "h-5 px-1.5 inline-flex items-center justify-center gap-1 rounded-full text-[10px] font-medium leading-none";

/** Cartesia mark — equalizer bars (not the generic sparkle). */
function CartesiaLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <path d="M2.5 9.5v-3M5 12V4M8 14V2M11 12V4M13.5 9.5v-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Sarvam mark — rounded speech node (distinct from Cartesia bars). */
function SarvamLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <circle cx="8" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5.5 11.2 4 14l3.2-1.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.2 7h3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function useVoiceClones(onReveal?: () => void) {
  const [myClones, setMyClones] = useState<ClonedVoiceResult[]>([]);
  const [clonesLoading, setClonesLoading] = useState(true);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [sarvamCloneOpen, setSarvamCloneOpen] = useState(false);
  const [clonesOpen, setClonesOpen] = useState(false);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const { toast } = useToast();
  const { getToken } = useAuth();

  const loadMyClones = useCallback(async () => {
    setClonesLoading(true);
    try {
      const data = await customFetch<{ voices: ClonedVoiceResult[] }>(`${API}/voices/mine`);
      setMyClones(data.voices ?? []);
    } catch {
      setMyClones([]);
    } finally {
      setClonesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMyClones();
  }, [loadMyClones]);

  function afterClone(voice: ClonedVoiceResult) {
    setMyClones((prev) => [voice, ...prev.filter((v) => v.id !== voice.id)]);
    setClonesOpen(true);
    onReveal?.();
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

  async function deleteClone(voice: ClonedVoiceResult) {
    setDeletingId(voice.id);
    try {
      const token = await getToken();
      const res = await fetch(`${API}/voices/mine/${encodeURIComponent(voice.id)}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Delete failed (${res.status})`);
      }
      setMyClones((prev) => prev.filter((v) => v.id !== voice.id));
      toast({ title: "Clone deleted", description: `"${voice.name}" was removed.` });
    } catch (err) {
      toast({ title: "Delete failed", description: formatApiError(err), variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  }

  const buttons = (
    <>
      <Button onClick={() => setCloneOpen(true)} className="gap-1.5 h-9 min-h-9 text-xs sm:text-[13px]">
        <CartesiaLogo className="h-3.5 w-3.5" />
        Clone (Cartesia)
      </Button>
      <Button
        onClick={() => setSarvamCloneOpen(true)}
        className="gap-1.5 h-9 min-h-9 text-xs sm:text-[13px]"
      >
        <SarvamLogo className="h-3.5 w-3.5" />
        Add Sarvam clone
      </Button>
    </>
  );

  const dialogs = (
    <>
      <CloneVoiceDialog
        open={cloneOpen}
        onOpenChange={setCloneOpen}
        onCloned={afterClone}
      />
      <RegisterSarvamVoiceDialog
        open={sarvamCloneOpen}
        onOpenChange={setSarvamCloneOpen}
        onRegistered={afterClone}
      />
    </>
  );

  const panel = (
    <div className="w-full">
      {clonesLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border/60 bg-card/40 p-4 h-[120px] animate-pulse" />
          ))}
        </div>
      ) : myClones.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
          No clones yet. Instant-clone with Cartesia, or add a Sarvam Creative Studio speaker id.
        </div>
      ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-3">
              {myClones.map((voice) => {
                const isPreviewing = previewingId === voice.id;
                const providerLabel = voice.provider === "sarvam" ? "Sarvam" : "Cartesia";
                return (
                  <Card key={`${voice.provider ?? "cartesia"}:${voice.id}`} className="flex flex-col border border-border/60 bg-card/60">
                    <CardContent className="p-4 flex flex-col gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{voice.name}</p>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          <Badge variant="outline" className={cn(METADATA_PILL_CLASS, "uppercase")}>
                            {voice.language.toUpperCase()}
                          </Badge>
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5 gap-1">
                            {voice.provider === "sarvam"
                              ? <SarvamLogo className="h-2.5 w-2.5" />
                              : <CartesiaLogo className="h-2.5 w-2.5" />}
                            {providerLabel}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/40">
                        <button
                          onClick={() => void previewVoice(voice)}
                          disabled={previewingId !== null && !isPreviewing}
                          className={cn(
                            "h-8 px-3 flex items-center gap-1.5 rounded-md border text-xs font-medium transition-colors disabled:opacity-40",
                            isPreviewing
                              ? "border-primary/40 bg-primary/10 text-primary"
                              : "border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {isPreviewing ? (
                            <><Square className="h-3 w-3 fill-current" /> Stop</>
                          ) : (
                            <><Play className="h-3 w-3" /> Preview</>
                          )}
                        </button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 text-destructive hover:text-destructive"
                          disabled={deletingId === voice.id}
                          onClick={() => void deleteClone(voice)}
                        >
                          {deletingId === voice.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
    </div>
  );

  return { buttons, dialogs, panel };
}
