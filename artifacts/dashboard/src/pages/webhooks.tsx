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
    "call.started": "bg-muted text-foreground border-border",
    "call.ended":   "bg-muted text-zinc-400 border-border",
    "call.failed":  "bg-muted text-foreground border-border",
  };
  return (
    <Badge className={`text-[10px] font-mono ${colors[event] ?? "bg-muted text-muted-foreground"}`}>
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
        <Label className="text-xs text-muted-foreground">Endpoint URL *</Label>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-server.com/webhook"
          className="mt-1.5 h-8 text-sm bg-muted border-border"
        />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">Events to subscribe</Label>
        <div className="mt-2 flex flex-wrap gap-2">
          {ALL_EVENTS.map((ev) => (
            <button
              key={ev}
              onClick={() => toggle(ev)}
              className={`px-2.5 py-1 rounded-md text-xs font-mono border transition-colors ${
                events.includes(ev)
                  ? "bg-muted text-foreground border-[#ACADB1]/60"
                  : "bg-muted text-muted-foreground border-border hover:border-[#ACADB1]"
              }`}
            >
              {ev}
            </button>
          ))}
        </div>
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">Description (optional)</Label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Slack notifications"
          className="mt-1.5 h-8 text-sm bg-muted border-border"
        />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">Signing secret (optional — auto-generated if blank)</Label>
        <Input
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="Leave blank to auto-generate"
          className="mt-1.5 h-8 text-sm bg-muted border-border font-mono"
        />
      </div>
      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={onCancel} className="text-muted-foreground">Cancel</Button>
        <Button
          size="sm"
          disabled={!url || events.length === 0 || loading}
          onClick={() => onSubmit({ url, events, description: description || undefined, secret: secret || undefined })}
          className="bg-primary hover:opacity-90 text-primary-foreground"
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
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-base font-semibold text-foreground">Webhooks</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Receive real-time HTTP POST notifications when call events occur.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setCreateOpen(true)}
          className="h-7 px-3 text-xs bg-primary hover:opacity-90 text-primary-foreground"
        >
          <Plus className="w-3 h-3 mr-1.5" />
          Add endpoint
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-6 py-8 md:px-8">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-20 rounded-lg bg-card border border-border animate-pulse" />
            ))}
          </div>
        ) : endpoints.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <Webhook className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">No webhook endpoints yet</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs">
              Add an endpoint to receive POST notifications when calls start, end, or fail.
            </p>
            <Button
              size="sm"
              onClick={() => setCreateOpen(true)}
              className="mt-4 h-7 px-3 text-xs bg-primary hover:opacity-90 text-primary-foreground"
            >
              <Plus className="w-3 h-3 mr-1.5" />
              Add your first endpoint
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {endpoints.map((ep) => (
              <div key={ep.id} className="p-4 rounded-lg bg-card border border-border hover:border-border transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <button
                        onClick={() => copyUrl(ep)}
                        className="flex items-center gap-1.5 text-sm text-foreground font-mono hover:text-foreground transition-colors truncate max-w-md"
                      >
                        {ep.url}
                        {copied === ep.id
                          ? <CheckCircle2 className="w-3 h-3 shrink-0 text-foreground" />
                          : <Copy className="w-3 h-3 shrink-0 text-muted-foreground" />
                        }
                      </button>
                    </div>
                    {ep.description && (
                      <p className="text-xs text-muted-foreground mb-2">{ep.description}</p>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {ep.events.map((ev) => <EventBadge key={ev} event={ev} />)}
                    </div>
                    {ep.secretHint && (
                      <p className="text-[11px] text-muted-foreground mt-1.5 font-mono">
                        Secret: {ep.secretHint}
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground mt-1">
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
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-card border-border">
                        <DropdownMenuItem onClick={() => setEditTarget(ep)} className="text-xs">
                          <Pencil className="w-3 h-3 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setDeleteTarget(ep)} className="text-xs text-foreground focus:text-foreground">
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
          <div className="mt-6 p-4 rounded-lg bg-muted border border-border text-xs text-muted-foreground">
            <p className="font-medium text-muted-foreground mb-1">Payload format</p>
            <pre className="font-mono text-muted-foreground leading-relaxed whitespace-pre-wrap">{`POST https://your-endpoint.com/webhook
Content-Type: application/json
X-SnapServe-Signature: hmac-sha256 of body

{
  "event": "call.ended",
  "timestamp": "2026-01-15T10:30:00Z",
  "data": { "callId": 42, "agentId": 7, ... }
}`}</pre>
          </div>
        )}
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-card border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Add webhook endpoint</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
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
        <DialogContent className="bg-card border-border max-w-md">
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
        <DialogContent className="bg-card border-border max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Delete webhook endpoint?</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              No more events will be sent to <span className="font-mono text-muted-foreground">{deleteTarget?.url}</span>. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(null)} className="text-muted-foreground">Cancel</Button>
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
