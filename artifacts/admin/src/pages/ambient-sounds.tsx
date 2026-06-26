import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, BASE, formatAdminError } from "@/lib/api";
import {
  Upload,
  Loader2,
  Music,
  Trash2,
  Play,
  Pause,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";

type SoundRow = {
  id: string;
  name: string;
  mimeType: string;
  fileSize: number;
  durationSeconds: number | null;
  createdAt: string;
};

type UploadStatus =
  | { kind: "idle" }
  | { kind: "uploading"; filename: string }
  | { kind: "success"; name: string }
  | { kind: "error"; message: string };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(s: number | null): string {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function StatusBanner({ status }: { status: UploadStatus }) {
  if (status.kind === "idle") return null;
  if (status.kind === "uploading") {
    return (
      <div className="flex items-center gap-3 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span>
          Uploading & transcoding{" "}
          <span className="font-mono">{status.filename}</span>…
        </span>
      </div>
    );
  }
  if (status.kind === "success") {
    return (
      <div className="flex items-center gap-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm">
        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
        <span>
          <span className="font-semibold text-emerald-500">Uploaded.</span>{" "}
          <span className="text-muted-foreground">
            <strong>{status.name}</strong> is now available in the ambient noise
            dropdown.
          </span>
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
      <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
      <div className="flex-1">
        <div className="font-semibold text-destructive">Upload failed</div>
        <div className="text-muted-foreground text-xs mt-0.5">
          {status.message}
        </div>
      </div>
    </div>
  );
}

export default function AmbientSoundsPage() {
  const { toast } = useToast();
  const [sounds, setSounds] = useState<SoundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<UploadStatus>({ kind: "idle" });
  const [name, setName] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isUploading = status.kind === "uploading";

  function stopPreview() {
    if (previewRef.current) {
      previewRef.current.pause();
      previewRef.current = null;
    }
    setPlayingId(null);
  }

  function togglePreview(id: string) {
    // Clicking the currently-playing track pauses it.
    if (playingId === id) {
      stopPreview();
      return;
    }
    // Only one preview plays at a time — stop any other before starting.
    if (previewRef.current) {
      previewRef.current.pause();
      previewRef.current = null;
    }
    const token = localStorage.getItem("adminToken") ?? "";
    const audio = new Audio(
      `${BASE}/ambient-sounds/${id}/audio?token=${encodeURIComponent(token)}`,
    );
    previewRef.current = audio;
    setPlayingId(id);
    audio.onended = () => {
      if (previewRef.current === audio) stopPreview();
    };
    audio.onerror = () => {
      if (previewRef.current === audio) {
        previewRef.current = null;
        setPlayingId(null);
      }
      toast({
        title: "Playback failed",
        description:
          "Could not play this sound. The audio file may be missing from storage or in an unsupported format.",
        variant: "destructive",
      });
    };
    audio.play().catch((err: unknown) => {
      if (previewRef.current === audio) {
        previewRef.current = null;
        setPlayingId(null);
      }
      toast({
        title: "Playback failed",
        description: err instanceof Error ? err.message : "Could not start playback.",
        variant: "destructive",
      });
    });
  }

  useEffect(() => {
    return () => {
      previewRef.current?.pause();
      previewRef.current = null;
    };
  }, []);

  async function load() {
    setLoading(true);
    try {
      const data = await adminFetch<SoundRow[]>("/ambient-sounds");
      setSounds(data);
    } catch (err) {
      toast({
        title: "Failed to load ambient sounds",
        description: formatAdminError(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function uploadFile(file: File) {
    if (!name.trim()) {
      toast({
        title: "Name required",
        description: "Enter a name for the sound before uploading.",
        variant: "destructive",
      });
      return;
    }
    setStatus({ kind: "uploading", filename: file.name });
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("name", name.trim());
      const token = localStorage.getItem("adminToken") ?? "";
      const res = await fetch(`${BASE}/ambient-sounds`, {
        method: "POST",
        headers: { "X-Admin-Token": token },
        body: fd,
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        let msg = `HTTP ${res.status}`;
        try {
          const parsed = JSON.parse(txt) as { error?: string };
          if (parsed.error) msg = parsed.error;
        } catch {
          if (txt) msg += `: ${txt}`;
        }
        throw new Error(msg);
      }
      const created = (await res.json()) as SoundRow;
      setStatus({ kind: "success", name: created.name });
      setName("");
      toast({ title: "Sound uploaded", description: `"${created.name}" is now available.` });
      void load();
    } catch (err) {
      const message = formatAdminError(err);
      setStatus({ kind: "error", message });
      toast({ title: "Upload failed", description: message, variant: "destructive" });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function deleteSound(id: string, soundName: string) {
    if (!window.confirm(`Delete "${soundName}"? This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      await adminFetch(`/ambient-sounds/${id}`, { method: "DELETE" });
      toast({ title: "Deleted", description: `"${soundName}" has been removed.` });
      void load();
    } catch (err) {
      toast({
        title: "Delete failed",
        description: formatAdminError(err),
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Ambient Sounds</h1>
        <p className="text-muted-foreground mt-1">
          Upload audio files that appear in the "Ambient Noise" track dropdown
          when users configure an agent. Supports MP3, WAV, OGG, and M4A up to
          20 MB.
        </p>
      </div>

      <Card id="upload">
        <CardHeader>
          <CardTitle>Add Sound</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sound-name">Display name</Label>
              <Input
                id="sound-name"
                placeholder="e.g. Coffee Shop Ambience"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isUploading}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Audio file</Label>
              <div className="flex items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/x-m4a,audio/mp4,audio/*"
                  disabled={isUploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadFile(f);
                  }}
                  className="hidden"
                />
                <Button
                  onClick={() => fileRef.current?.click()}
                  disabled={isUploading}
                  className="gap-2"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Uploading…
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4" />
                      Choose file
                    </>
                  )}
                </Button>
                <p className="text-xs text-muted-foreground">
                  MP3, WAV, OGG, M4A · Max 20 MB
                </p>
              </div>
            </div>
          </div>
          <StatusBanner status={status} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Uploaded Sounds</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : sounds.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Music className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                No sounds uploaded yet. Add one above to populate the ambient
                noise dropdown.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {sounds.map((s) => (
                <div
                  key={s.id}
                  className={`flex items-center gap-3 rounded-md border px-3 py-2.5 ${s.durationSeconds == null ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-muted/20"}`}
                >
                  <Music className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">{s.name}</span>
                      <span className="text-xs text-muted-foreground uppercase font-mono">
                        {s.mimeType.replace("audio/", "")}
                      </span>
                      {s.durationSeconds == null && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600">
                          <AlertTriangle className="h-2.5 w-2.5" />
                          Re-upload needed
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {formatSize(s.fileSize)}
                      {s.durationSeconds != null && ` · ${formatDuration(s.durationSeconds)}`}
                      {" · "}
                      {new Date(s.createdAt).toLocaleString()}
                    </div>
                    {s.durationSeconds == null && (
                      <div className="text-[10px] text-amber-600/80 mt-0.5">
                        Audio data missing — delete this entry and upload the file again.
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => togglePreview(s.id)}
                      aria-label={playingId === s.id ? `Pause ${s.name}` : `Play ${s.name}`}
                    >
                      {playingId === s.id ? (
                        <Pause className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={deletingId === s.id}
                      onClick={() => void deleteSound(s.id, s.name)}
                      aria-label={`Delete ${s.name}`}
                    >
                      {deletingId === s.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4 text-destructive" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
