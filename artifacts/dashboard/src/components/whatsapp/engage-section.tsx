/**
 * WhatsApp engagement tools, shown once a channel is connected:
 *  - AI chatbot: an agent persona answers customer texts in-thread.
 *  - Brochure: upload a PDF/image; auto-sent when customers ask for it.
 *  - Templates: create/sync Meta message templates (own channels).
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Bot, FileText, LayoutTemplate, Plus, RefreshCw, Trash2, Upload } from "lucide-react";

const API = "/api";

export type WaEngageChannel = {
  id: string;
  mode: string;
  status: string;
  chatbotEnabled?: boolean;
  chatbotAgentId?: number | null;
  brochureAssetId?: string | null;
  brochureAutoSend?: boolean;
};

type WaAsset = { id: string; filename: string; mime: string; sizeBytes: number; url: string; createdAt: string };
type WaTemplate = {
  id: string | null; name: string | null; category: string | null;
  language: string | null; status: string; hint?: string;
};

function prettySize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function templateStatusBadge(status: string) {
  const s = status.toUpperCase();
  const cls = s === "APPROVED" || s === "ACTIVE"
    ? "bg-emerald-500/15 text-emerald-400"
    : s.includes("REJECT") || s.includes("FAIL")
      ? "bg-red-500/15 text-red-400"
      : "bg-amber-500/15 text-amber-400";
  return <Badge className={`${cls} border-transparent text-[10px]`}>{status}</Badge>;
}

export function EngageSection({
  channel,
  agents,
  onPatch,
  patching,
}: {
  channel: WaEngageChannel;
  agents: { id: number; name: string }[];
  onPatch: (body: Record<string, unknown>) => void;
  patching: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [tplName, setTplName] = useState("");
  const [tplCategory, setTplCategory] = useState("UTILITY");
  const [tplLanguage, setTplLanguage] = useState("en");
  const [tplHeader, setTplHeader] = useState("");
  const [tplBody, setTplBody] = useState("");
  const [tplFooter, setTplFooter] = useState("");

  /* ── assets ── */
  const { data: assetData } = useQuery({
    queryKey: ["whatsapp-assets"],
    queryFn: () => customFetch<{ assets: WaAsset[] }>(`${API}/whatsapp/assets`),
  });
  const assets = assetData?.assets ?? [];

  const uploadAsset = useMutation({
    mutationFn: (body: { filename: string; mime: string; dataBase64: string }) =>
      customFetch<{ asset: WaAsset }>(`${API}/whatsapp/assets`, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["whatsapp-assets"] });
      // First upload becomes the active brochure automatically.
      if (!channel.brochureAssetId) onPatch({ brochureAssetId: r.asset.id });
      toast({ title: "File uploaded", description: `${r.asset.filename} is ready to send.` });
    },
    onError: (err: Error) => toast({ title: "Upload failed", description: err.message, variant: "destructive" }),
    onSettled: () => setUploading(false),
  });

  const deleteAsset = useMutation({
    mutationFn: (id: string) => customFetch(`${API}/whatsapp/assets/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["whatsapp-assets"] });
      void qc.invalidateQueries({ queryKey: ["whatsapp-channel"] });
      toast({ title: "File deleted" });
    },
    onError: (err: Error) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  const onPickFile = (f: File | undefined) => {
    if (!f) return;
    const okTypes = ["application/pdf", "image/jpeg", "image/png"];
    if (!okTypes.includes(f.type)) {
      toast({ title: "Unsupported file", description: "Upload a PDF, JPG or PNG.", variant: "destructive" });
      return;
    }
    if (f.size > 8 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max 8 MB.", variant: "destructive" });
      return;
    }
    setUploading(true);
    const reader = new FileReader();
    reader.onload = () => uploadAsset.mutate({ filename: f.name, mime: f.type, dataBase64: String(reader.result) });
    reader.onerror = () => {
      setUploading(false);
      toast({ title: "Could not read file", variant: "destructive" });
    };
    reader.readAsDataURL(f);
  };

  /* ── templates ── */
  const isOwn = channel.mode === "own";
  const { data: tplData, isLoading: tplLoading, refetch: refetchTpl } = useQuery({
    queryKey: ["whatsapp-templates"],
    queryFn: () => customFetch<{ mode: string; templates: WaTemplate[] }>(`${API}/whatsapp/templates`),
  });
  const templates = tplData?.templates ?? [];

  const createTpl = useMutation({
    mutationFn: () =>
      customFetch<{ ok: boolean }>(`${API}/whatsapp/templates`, {
        method: "POST",
        body: JSON.stringify({
          name: tplName,
          category: tplCategory,
          language: tplLanguage,
          headerText: tplHeader.trim() || undefined,
          bodyText: tplBody,
          footerText: tplFooter.trim() || undefined,
        }),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => {
      setTplOpen(false);
      setTplName(""); setTplHeader(""); setTplBody(""); setTplFooter("");
      void refetchTpl();
      toast({ title: "Template submitted", description: "Meta reviews new templates — usually minutes, sometimes up to 24h." });
    },
    onError: (err: Error) => toast({ title: "Submission failed", description: err.message, variant: "destructive" }),
  });

  const syncTpl = useMutation({
    mutationFn: () => customFetch<{ ok: boolean }>(`${API}/whatsapp/templates/sync`, { method: "POST" }),
    onSuccess: () => {
      void refetchTpl();
      toast({ title: "Sync requested", description: "Statuses refresh from Meta shortly." });
    },
    onError: (err: Error) => toast({ title: "Sync failed", description: err.message, variant: "destructive" }),
  });

  const chatbotEnabled = !!channel.chatbotEnabled;
  const brochureAutoSend = channel.brochureAutoSend !== false;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* AI chatbot */}
      <div className="rounded-lg border border-border/60 bg-card/30 p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-violet-400" />
            <h3 className="text-sm font-semibold">AI chatbot replies</h3>
          </div>
          <Switch
            checked={chatbotEnabled}
            disabled={patching || (!chatbotEnabled && agents.length === 0)}
            onCheckedChange={(v) => {
              if (v && !channel.chatbotAgentId && agents.length > 0) {
                onPatch({ chatbotEnabled: true, chatbotAgentId: agents[0]!.id });
              } else {
                onPatch({ chatbotEnabled: v });
              }
            }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          When customers text your WhatsApp number, the selected agent answers in-thread — same persona and
          knowledge as on calls, adapted to chat. “Call me” still triggers a phone call.
        </p>
        <div>
          <Label className="text-xs">Answering agent</Label>
          <select
            className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={channel.chatbotAgentId ?? ""}
            disabled={patching || agents.length === 0}
            onChange={(e) => onPatch({ chatbotAgentId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">— pick an agent —</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          {agents.length === 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground">Create an AI agent first — the chatbot borrows its persona.</p>
          )}
        </div>
      </div>

      {/* Brochure */}
      <div className="rounded-lg border border-border/60 bg-card/30 p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-sky-400" />
            <h3 className="text-sm font-semibold">Brochure auto-send</h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Auto-send</span>
            <Switch
              checked={brochureAutoSend}
              disabled={patching}
              onCheckedChange={(v) => onPatch({ brochureAutoSend: v })}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          When a customer messages “brochure”, “catalog” or “price list”, the selected file is sent back instantly.
        </p>
        <div className="space-y-2">
          {assets.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-md border border-border/50 px-3 py-2">
              <input
                type="radio"
                name="active-brochure"
                checked={channel.brochureAssetId === a.id}
                disabled={patching}
                onChange={() => onPatch({ brochureAssetId: a.id })}
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{a.filename}</p>
                <p className="text-[10px] text-muted-foreground">{prettySize(a.sizeBytes)}{channel.brochureAssetId === a.id ? " · active" : ""}</p>
              </div>
              <Button
                size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-red-400"
                disabled={deleteAsset.isPending}
                onClick={() => deleteAsset.mutate(a.id)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
          <input
            ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png" className="hidden"
            onChange={(e) => { onPickFile(e.target.files?.[0]); e.target.value = ""; }}
          />
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={uploading} onClick={() => fileRef.current?.click()}>
            <Upload className="w-3.5 h-3.5 mr-1.5" />
            {uploading ? "Uploading…" : "Upload PDF / image"}
          </Button>
          <p className="text-[10px] text-muted-foreground">PDF, JPG or PNG · max 8 MB · up to 5 files</p>
        </div>
      </div>

      {/* Templates */}
      <div className="rounded-lg border border-border/60 bg-card/30 p-5 space-y-3 lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <LayoutTemplate className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold">Message templates</h3>
            {!isOwn && <Badge variant="outline" className="text-[10px]">platform-managed</Badge>}
          </div>
          {isOwn && (
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" className="h-8 text-xs" disabled={syncTpl.isPending} onClick={() => syncTpl.mutate()}>
                <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncTpl.isPending ? "animate-spin" : ""}`} /> Sync from Meta
              </Button>
              <Button size="sm" className="h-8 text-xs" onClick={() => setTplOpen(true)}>
                <Plus className="w-3.5 h-3.5 mr-1.5" /> New template
              </Button>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {isOwn
            ? "Templates let you START conversations (reminders, follow-ups) outside the 24-hour reply window. Meta approves each one."
            : "On the shared SnapServe number, templates are managed by the platform. Connect your own number to create custom templates."}
        </p>
        {tplLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : templates.length === 0 ? (
          <p className="text-xs text-muted-foreground">No templates yet.</p>
        ) : (
          <div className="divide-y divide-border/40 rounded-md border border-border/50">
            {templates.map((t, i) => (
              <div key={t.id ?? `${t.name}-${i}`} className="flex items-center gap-3 px-3 py-2">
                <code className="text-xs font-medium flex-1 truncate">{t.name ?? "—"}</code>
                <span className="text-[10px] text-muted-foreground uppercase">{t.category ?? "—"}</span>
                <span className="text-[10px] text-muted-foreground">{t.language ?? "—"}</span>
                {templateStatusBadge(t.status)}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* create-template dialog */}
      <Dialog open={tplOpen} onOpenChange={setTplOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New message template</DialogTitle>
            <DialogDescription className="text-xs">
              Submitted to Meta for review via VoBiz. Use {"{{1}}"}, {"{{2}}"} … as placeholders in the body.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Name *</Label>
                <Input className="mt-1 h-9" placeholder="order_update" value={tplName}
                  onChange={(e) => setTplName(e.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, "_"))} />
              </div>
              <div>
                <Label className="text-xs">Category</Label>
                <select className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={tplCategory} onChange={(e) => setTplCategory(e.target.value)}>
                  <option value="UTILITY">Utility (transactional)</option>
                  <option value="MARKETING">Marketing</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Language</Label>
                <Input className="mt-1 h-9" placeholder="en" value={tplLanguage} onChange={(e) => setTplLanguage(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Header (optional, 60 chars)</Label>
                <Input className="mt-1 h-9" maxLength={60} value={tplHeader} onChange={(e) => setTplHeader(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Body * (1024 chars)</Label>
              <textarea
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[96px]"
                maxLength={1024}
                placeholder={"Hi {{1}}, your appointment is confirmed for {{2}}."}
                value={tplBody}
                onChange={(e) => setTplBody(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Footer (optional, 60 chars)</Label>
              <Input className="mt-1 h-9" maxLength={60} value={tplFooter} onChange={(e) => setTplFooter(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTplOpen(false)}>Cancel</Button>
            <Button disabled={!tplName.trim() || !tplBody.trim() || createTpl.isPending} onClick={() => createTpl.mutate()}>
              {createTpl.isPending ? "Submitting…" : "Submit for review"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
