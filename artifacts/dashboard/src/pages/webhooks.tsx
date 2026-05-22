import { useState } from "react";
import {
  useListWebhookEndpoints,
  useCreateWebhookEndpoint,
  useUpdateWebhookEndpoint,
  useDeleteWebhookEndpoint,
  getListWebhookEndpointsQueryKey,
} from "@workspace/api-client-react";
import type { WebhookEndpoint } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { Plus, Webhook, MoreHorizontal, Trash2, Pencil, Copy, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";

const ALL_EVENTS = ["call.started", "call.ended", "call.failed"] as const;

function EventBadge({ event }: { event: string }) {
  const colors: Record<string, string> = {
    "call.started": "bg-black/[0.04] text-black/75 border-black/[0.10]",
    "call.ended":   "bg-blue-500/15 text-blue-400 border-blue-500/30",
    "call.failed":  "bg-red-500/15 text-red-400 border-red-500/30",
  };
  return (
    <Badge className={`text-[10px] font-mono ${colors[event] ?? "bg-black/[0.08] text-black/50"}`}>
      {event}
    </Badge>
  );
}

function WebhookForm({
  initial,
  onSubmit,
  onCancel,
  loading,
}: {
  initial?: Partial<WebhookEndpoint>;
  onSubmit: (data: { url: string; events: string[]; description?: string; secret?: string }) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [url, setUrl] = useState(initial?.url ?? "");
  const [events, setEvents] = useState<string[]>(initial?.events ?? ["call.ended"]);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [secret, setSecret] = useState("");

  const toggle = (ev: string) => {
    setEvents((prev) => prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]);
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs text-black/50">Endpoint URL *</Label>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-server.com/webhook"
          className="mt-1.5 h-8 text-sm bg-black/[0.08] border-black/[0.07]"
        />
      </div>
      <div>
        <Label className="text-xs text-black/50">Events to subscribe</Label>
        <div className="mt-2 flex flex-wrap gap-2">
          {ALL_EVENTS.map((ev) => (
            <button
              key={ev}
              onClick={() => toggle(ev)}
              className={`px-2.5 py-1 rounded-md text-xs font-mono border transition-colors ${
                events.includes(ev)
                  ? "bg-black/[0.04] text-black/75 border-[#ACADB1]/60"
                  : "bg-black/[0.08] text-black/35 border-black/[0.07] hover:border-[#ACADB1]"
              }`}
            >
              {ev}
            </button>
          ))}
        </div>
      </div>
      <div>
        <Label className="text-xs text-black/50">Description (optional)</Label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Slack notifications"
          className="mt-1.5 h-8 text-sm bg-black/[0.08] border-black/[0.07]"
        />
      </div>
      <div>
        <Label className="text-xs text-black/50">Signing secret (optional — auto-generated if blank)</Label>
        <Input
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="Leave blank to auto-generate"
          className="mt-1.5 h-8 text-sm bg-black/[0.08] border-black/[0.07] font-mono"
        />
      </div>
      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={onCancel} className="text-black/50">Cancel</Button>
        <Button
          size="sm"
          disabled={!url || events.length === 0 || loading}
          onClick={() => onSubmit({ url, events, description: description || undefined, secret: secret || undefined })}
          className="bg-black/80 hover:bg-black/90 text-white/90"
        >
          {loading ? "Saving…" : "Save endpoint"}
        </Button>
      </DialogFooter>
    </div>
  );
}

export default function WebhooksPage() {
  const { data: endpoints = [], isLoading } = useListWebhookEndpoints();
  const createMutation = useCreateWebhookEndpoint();
  const updateMutation = useUpdateWebhookEndpoint();
  const deleteMutation = useDeleteWebhookEndpoint();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<WebhookEndpoint | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WebhookEndpoint | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: getListWebhookEndpointsQueryKey() });

  const handleCreate = async (data: any) => {
    await createMutation.mutateAsync(data);
    await invalidate();
    setCreateOpen(false);
    toast({ title: "Webhook endpoint created" });
  };

  const handleUpdate = async (data: any) => {
    if (!editTarget) return;
    await updateMutation.mutateAsync({ id: editTarget.id, data });
    await invalidate();
    setEditTarget(null);
    toast({ title: "Webhook endpoint updated" });
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await deleteMutation.mutateAsync({ id: deleteTarget.id });
    await invalidate();
    setDeleteTarget(null);
    toast({ title: "Webhook endpoint deleted" });
  };

  const handleToggle = async (ep: WebhookEndpoint, enabled: boolean) => {
    await updateMutation.mutateAsync({ id: ep.id, data: { enabled } });
    await invalidate();
  };

  const copyUrl = (ep: WebhookEndpoint) => {
    navigator.clipboard.writeText(ep.url);
    setCopied(ep.id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-black/[0.06] shrink-0">
        <div>
          <h1 className="text-base font-semibold text-black/85">Webhooks</h1>
          <p className="text-xs text-black/35 mt-0.5">
            Receive real-time HTTP POST notifications when call events occur.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setCreateOpen(true)}
          className="h-7 px-3 text-xs bg-black/80 hover:bg-black/90 text-white/90"
        >
          <Plus className="w-3 h-3 mr-1.5" />
          Add endpoint
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-20 rounded-lg bg-white/70 backdrop-blur-lg border border-black/[0.07] animate-pulse" />
            ))}
          </div>
        ) : endpoints.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="h-12 w-12 rounded-full bg-black/[0.08] flex items-center justify-center mb-4">
              <Webhook className="h-6 w-6 text-black/35" />
            </div>
            <p className="text-sm font-medium text-black/50">No webhook endpoints yet</p>
            <p className="text-xs text-black/35 mt-1 max-w-xs">
              Add an endpoint to receive POST notifications when calls start, end, or fail.
            </p>
            <Button
              size="sm"
              onClick={() => setCreateOpen(true)}
              className="mt-4 h-7 px-3 text-xs bg-black/80 hover:bg-black/90 text-white/90"
            >
              <Plus className="w-3 h-3 mr-1.5" />
              Add your first endpoint
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {endpoints.map((ep) => (
              <div key={ep.id} className="p-4 rounded-lg bg-white/70 backdrop-blur-lg border border-black/[0.07] hover:border-black/[0.07] transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <button
                        onClick={() => copyUrl(ep)}
                        className="flex items-center gap-1.5 text-sm text-black/85 font-mono hover:text-black/75 transition-colors truncate max-w-md"
                      >
                        {ep.url}
                        {copied === ep.id
                          ? <CheckCircle2 className="w-3 h-3 shrink-0 text-black/75" />
                          : <Copy className="w-3 h-3 shrink-0 text-black/35" />
                        }
                      </button>
                    </div>
                    {ep.description && (
                      <p className="text-xs text-black/35 mb-2">{ep.description}</p>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {ep.events.map((ev) => <EventBadge key={ev} event={ev} />)}
                    </div>
                    {ep.secretHint && (
                      <p className="text-[11px] text-black/35 mt-1.5 font-mono">
                        Secret: {ep.secretHint}
                      </p>
                    )}
                    <p className="text-[11px] text-black/35 mt-1">
                      Added {format(new Date(ep.createdAt), "MMM d, yyyy")}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      checked={ep.enabled}
                      onCheckedChange={(v) => handleToggle(ep, v)}
                      className="scale-75"
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-black/35 hover:text-black/85">
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-white/70 backdrop-blur-lg border-black/[0.07]">
                        <DropdownMenuItem onClick={() => setEditTarget(ep)} className="text-xs">
                          <Pencil className="w-3 h-3 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setDeleteTarget(ep)} className="text-xs text-red-400 focus:text-red-400">
                          <Trash2 className="w-3 h-3 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {endpoints.length > 0 && (
          <div className="mt-6 p-4 rounded-lg bg-black/[0.04] border border-black/[0.07] text-xs text-black/35">
            <p className="font-medium text-black/50 mb-1">Payload format</p>
            <pre className="font-mono text-black/35 leading-relaxed whitespace-pre-wrap">{`POST https://your-endpoint.com/webhook
Content-Type: application/json
X-VoiceOrch-Signature: hmac-sha256 of body

{
  "event": "call.ended",
  "timestamp": "2026-01-15T10:30:00Z",
  "data": { "callId": 42, "agentId": 7, ... }
}`}</pre>
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-white/70 backdrop-blur-lg border-black/[0.07] max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Add webhook endpoint</DialogTitle>
            <DialogDescription className="text-xs text-black/35">
              Configure a URL to receive event notifications.
            </DialogDescription>
          </DialogHeader>
          <WebhookForm
            onSubmit={handleCreate}
            onCancel={() => setCreateOpen(false)}
            loading={createMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="bg-white/70 backdrop-blur-lg border-black/[0.07] max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Edit webhook endpoint</DialogTitle>
          </DialogHeader>
          {editTarget && (
            <WebhookForm
              initial={editTarget}
              onSubmit={handleUpdate}
              onCancel={() => setEditTarget(null)}
              loading={updateMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="bg-white/70 backdrop-blur-lg border-black/[0.07] max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Delete webhook endpoint?</DialogTitle>
            <DialogDescription className="text-xs text-black/35">
              No more events will be sent to <span className="font-mono text-black/50">{deleteTarget?.url}</span>. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(null)} className="text-black/50">Cancel</Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={handleDelete}
              className="text-xs"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
