import { useState, useMemo, useRef } from "react";
import { useAdminCartesiaVoices, useSaveListedVoices, type AdminVoice } from "@/hooks/use-admin-api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Mic2, Save, RefreshCw, Loader2, Search, Info, Play, Square, AlertTriangle, KeyRound } from "lucide-react";
import { Link } from "wouter";

export default function Voices() {
  const { data, isLoading, refetch, isRefetching, isError, error } = useAdminCartesiaVoices();
  const { mutate: saveVoices, isPending } = useSaveListedVoices();
  const { toast } = useToast();

  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);
  const [search, setSearch] = useState("");
  const [langFilter, setLangFilter] = useState("all");
  const [genderFilter, setGenderFilter] = useState("all");
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  async function previewVoice(voice: AdminVoice, e: React.MouseEvent) {
    e.stopPropagation();

    // Stop any currently playing audio
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.src = "";
      currentAudioRef.current = null;
    }

    // If clicking the same voice that's playing, just stop
    if (previewingId === voice.id) {
      setPreviewingId(null);
      return;
    }

    setPreviewingId(voice.id);

    try {
      const token = localStorage.getItem("adminToken") ?? "";
      const res = await fetch("/api/admin/voices/preview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Token": token,
        },
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
    } catch (err: any) {
      setPreviewingId(null);
      currentAudioRef.current = null;
      toast({ title: err.message ?? "Preview failed", variant: "destructive" });
    }
  }

  const voices: AdminVoice[] = data?.voices ?? [];

  // Initialise selection from fetched data once available
  const effectiveSelected = useMemo<Set<string>>(() => {
    if (selectedIds !== null) return selectedIds;
    return new Set(voices.filter(v => v.isListed).map(v => v.id));
  }, [selectedIds, voices]);

  const languages = useMemo(() => {
    const langs = Array.from(new Set(voices.map(v => v.language))).sort();
    return langs;
  }, [voices]);

  const genders = useMemo(() => {
    const gs = Array.from(new Set(voices.map(v => v.gender ?? "Neutral"))).sort();
    return gs;
  }, [voices]);

  const filtered = useMemo(() => {
    return voices.filter(v => {
      const matchesSearch =
        !search ||
        v.name.toLowerCase().includes(search.toLowerCase()) ||
        (v.description ?? "").toLowerCase().includes(search.toLowerCase());
      const matchesLang = langFilter === "all" || v.language === langFilter;
      const matchesGender = genderFilter === "all" || (v.gender ?? "Neutral") === genderFilter;
      return matchesSearch && matchesLang && matchesGender;
    });
  }, [voices, search, langFilter, genderFilter]);

  function toggleVoice(id: string) {
    setSelectedIds(prev => {
      const base = prev ?? new Set(voices.filter(v => v.isListed).map(v => v.id));
      const next = new Set(base);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAll() {
    const allFilteredIds = filtered.map(v => v.id);
    const allSelected = allFilteredIds.every(id => effectiveSelected.has(id));
    setSelectedIds(prev => {
      const base = prev ?? new Set(voices.filter(v => v.isListed).map(v => v.id));
      const next = new Set(base);
      if (allSelected) {
        for (const id of allFilteredIds) next.delete(id);
      } else {
        for (const id of allFilteredIds) next.add(id);
      }
      return next;
    });
  }

  function handleSave() {
    const selected = voices.filter(v => effectiveSelected.has(v.id));
    saveVoices(selected, {
      onSuccess: (data) => {
        toast({ title: `Saved — ${(data as any).saved} voice(s) listed for users` });
        setSelectedIds(null);
        refetch();
      },
      onError: () => toast({ title: "Save failed", variant: "destructive" }),
    });
  }

  const listedCount = effectiveSelected.size;
  const allFilteredSelected = filtered.length > 0 && filtered.every(v => effectiveSelected.has(v.id));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Voice Whitelist</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Select which Cartesia voices are available to users in the agent wizard and settings.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setSelectedIds(null); refetch(); }}
            disabled={isRefetching}
            className="gap-2"
          >
            {isRefetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isPending || isLoading || isError}
            className="gap-2"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Selection
          </Button>
        </div>
      </div>

      <div className="rounded-md border border-primary/20 bg-primary/5 p-4 flex items-start gap-3">
        <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <div className="text-sm text-muted-foreground">
          <strong className="text-foreground">How it works:</strong> Checked voices will be shown to users in the agent wizard and assistant settings. If no voices are listed, the dashboard falls back to showing all Cartesia voices (Arushi first).
        </div>
      </div>

      {isError && (() => {
        const msg = (error as Error)?.message ?? "";
        const isKeyMissing = msg.includes("Cartesia key not configured");
        return (
          <div className={`rounded-md border p-4 flex items-start gap-3 ${isKeyMissing ? "border-amber-500/30 bg-amber-500/5" : "border-destructive/30 bg-destructive/5"}`}>
            {isKeyMissing ? (
              <KeyRound className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            )}
            <div className="text-sm">
              {isKeyMissing ? (
                <>
                  <strong className="text-amber-600 dark:text-amber-400">Cartesia key not configured</strong>
                  <span className="text-muted-foreground"> — add it on the </span>
                  <Link href="/managed-keys" className="underline text-amber-600 dark:text-amber-400 hover:opacity-80">Managed Keys</Link>
                  <span className="text-muted-foreground"> page to load voices.</span>
                </>
              ) : (
                <>
                  <strong className="text-destructive">Could not load voices</strong>
                  <span className="text-muted-foreground"> — check that the API server is reachable and try again.</span>
                </>
              )}
            </div>
          </div>
        );
      })()}

      <Card>
        <CardHeader className="border-b border-border pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-medium uppercase tracking-wider flex items-center gap-2">
                <Mic2 className="h-4 w-4 text-primary" /> Cartesia Voices
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                {isLoading ? "Loading…" : isError ? "Unavailable" : `${voices.length} total voices · `}
                {!isLoading && !isError && (
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {listedCount} listed for users
                  </Badge>
                )}
              </CardDescription>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-3">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search by name or description…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 h-8 text-xs bg-muted/30"
              />
            </div>
            <Select value={langFilter} onValueChange={setLangFilter}>
              <SelectTrigger className="w-36 h-8 text-xs bg-muted/30">
                <SelectValue placeholder="Language" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All languages</SelectItem>
                {languages.map(l => (
                  <SelectItem key={l} value={l}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={genderFilter} onValueChange={setGenderFilter}>
              <SelectTrigger className="w-32 h-8 text-xs bg-muted/30">
                <SelectValue placeholder="Gender" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All genders</SelectItem>
                {genders.map(g => (
                  <SelectItem key={g} value={g}>{g}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm p-6">
              <Loader2 className="h-4 w-4 animate-spin" /> Fetching voices from Cartesia…
            </div>
          ) : isError ? (
            <div className="p-6 text-sm text-muted-foreground">Voices could not be loaded. See the message above for details.</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No voices match your filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="w-10 px-4 py-2.5 text-left">
                      <Checkbox
                        checked={allFilteredSelected}
                        onCheckedChange={toggleAll}
                        aria-label="Toggle all visible"
                      />
                    </th>
                    <th className="px-4 py-2.5 text-left font-semibold uppercase tracking-wider text-muted-foreground">Name</th>
                    <th className="px-4 py-2.5 text-left font-semibold uppercase tracking-wider text-muted-foreground">Language</th>
                    <th className="px-4 py-2.5 text-left font-semibold uppercase tracking-wider text-muted-foreground">Gender</th>
                    <th className="px-4 py-2.5 text-left font-semibold uppercase tracking-wider text-muted-foreground">Description</th>
                    <th className="px-4 py-2.5 text-left font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                    <th className="w-12 px-4 py-2.5 text-left font-semibold uppercase tracking-wider text-muted-foreground">Preview</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(voice => {
                    const isChecked = effectiveSelected.has(voice.id);
                    return (
                      <tr
                        key={voice.id}
                        className={`border-b border-border/50 transition-colors cursor-pointer hover:bg-muted/20 ${isChecked ? "bg-primary/5" : ""}`}
                        onClick={() => toggleVoice(voice.id)}
                      >
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={() => toggleVoice(voice.id)}
                            aria-label={`List ${voice.name}`}
                          />
                        </td>
                        <td className="px-4 py-3 font-medium text-foreground">{voice.name}</td>
                        <td className="px-4 py-3 font-mono text-muted-foreground">{voice.language}</td>
                        <td className="px-4 py-3 text-muted-foreground">{voice.gender ?? "Neutral"}</td>
                        <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">{voice.description || "—"}</td>
                        <td className="px-4 py-3">
                          {isChecked ? (
                            <Badge className="text-[10px] px-1.5 py-0.5">Listed</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 text-muted-foreground">Hidden</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-primary"
                            aria-label={previewingId === voice.id ? `Stop ${voice.name}` : `Preview ${voice.name}`}
                            disabled={previewingId !== null && previewingId !== voice.id}
                            onClick={e => previewVoice(voice, e)}
                          >
                            {previewingId === voice.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Play className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {isError
            ? "Voice data unavailable"
            : `Showing ${filtered.length} of ${voices.length} voices · ${listedCount} selected for users`}
        </span>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={isPending || isLoading || isError}
          className="gap-2"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Selection
        </Button>
      </div>
    </div>
  );
}
