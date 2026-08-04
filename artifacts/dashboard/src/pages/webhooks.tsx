import { useState } from "react";
import { Link } from "wouter";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Webhook,
  MoreHorizontal,
  Trash2,
  Pencil,
  Copy,
  CheckCircle2,
  ExternalLink,
  AlertTriangle,
  ArrowRight,
  BookOpen,
} from "lucide-react";
import { format } from "date-fns";

/** Events that are actually delivered today */
const LIVE_EVENTS = [
  {
    id: "call.completed",
    label: "Call completed",
    hint: "Call finished normally — includes transcript, summary, cost",
  },
  {
    id: "call.failed",
    label: "Call failed",
    hint: "Call ended in a failed status",
  },
] as const;

function EventBadge({ event }: { event: string }) {
  const label =
    event === "call.ended"
      ? "call.ended (legacy → completed)"
      : event === "call.started"
        ? "call.started (not fired yet)"
        : event;
  return (
    <Badge variant="outline" className="text-[10px] font-mono font-normal">
      {label}
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
  onSubmit: (data: { url: string; events: string[]; description?: string }) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const legacy = (initial?.events ?? []).filter(
    (e) => String(e) === "call.ended" || String(e) === "call.started",
  );
  const initialEvents =
    initial?.events?.filter(
      (e) => String(e) === "call.completed" || String(e) === "call.failed",
    ) ?? ["call.completed"];

  const [url, setUrl] = useState(initial?.url ?? "");
  const [events, setEvents] = useState<string[]>(
    initialEvents.length ? initialEvents : ["call.completed"],
  );
  const [description, setDescription] = useState(initial?.description ?? "");

  const toggle = (ev: string) => {
    setEvents((prev) =>
      prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev],
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs text-muted-foreground">Your HTTPS endpoint *</Label>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-app.com/hooks/snapserve"
          className="mt-1.5 h-9 text-sm"
        />
        <p className="text-[11px] text-muted-foreground mt-1.5">
          SnapServe will <strong>POST</strong> JSON here. This is <em>your</em> server URL — not a
          SnapServe URL.
        </p>
      </div>

      <div>
        <Label className="text-xs text-muted-foreground">Events</Label>
        <div className="mt-2 space-y-2">
          {LIVE_EVENTS.map((ev) => {
            const on = events.includes(ev.id);
            return (
              <button
                key={ev.id}
                type="button"
                onClick={() => toggle(ev.id)}
                className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
                  on
                    ? "border-primary/50 bg-primary/5"
                    : "border-border bg-muted/30 hover:border-muted-foreground/40"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <code className="text-xs font-mono">{ev.id}</code>
                  <span
                    className={`text-[10px] uppercase tracking-wide ${
                      on ? "text-primary" : "text-muted-foreground"
                    }`}
                  >
                    {on ? "On" : "Off"}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">{ev.label}</p>
                <p className="text-[11px] text-muted-foreground/80">{ev.hint}</p>
              </button>
            );
          })}
        </div>
        {legacy.length > 0 ? (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2">
            This endpoint still lists legacy events ({legacy.join(", ")}). Saving will replace them
            with the selection above. <code>call.ended</code> continues to receive{" "}
            <code>call.completed</code> deliveries until you update.
          </p>
        ) : null}
      </div>

      <div>
        <Label className="text-xs text-muted-foreground">Description (optional)</Label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Production CRM sync"
          className="mt-1.5 h-9 text-sm"
        />
      </div>

      <DialogFooter className="gap-2 sm:gap-0">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!url.trim() || events.length === 0 || loading}
          onClick={() =>
            onSubmit({
              url: url.trim(),
              events,
              description: description.trim() || undefined,
            })
          }
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
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getListWebhookEndpointsQueryKey() });

  const copyText = async (key: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleCreate = async (data: {
    url: string;
    events: string[];
    description?: string;
  }) => {
    const created = (await createMutation.mutateAsync({
      data: {
        url: data.url,
        events: data.events as WebhookEndpoint["events"],
        description: data.description,
        enabled: true,
      },
    })) as WebhookEndpoint & { secret?: string | null };
    await invalidate();
    setCreateOpen(false);
    if (created.secret) {
      setNewSecret(created.secret);
    } else {
      toast({
        title: "Webhook created",
        description: "Secret was not returned — recreate if you need the signing key.",
      });
    }
  };

  const handleUpdate = async (data: {
    url: string;
    events: string[];
    description?: string;
  }) => {
    if (!editTarget) return;
    await updateMutation.mutateAsync({
      id: editTarget.id,
      data: {
        url: data.url,
        events: data.events,
        description: data.description,
      },
    });
    await invalidate();
    setEditTarget(null);
    toast({ title: "Webhook updated" });
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await deleteMutation.mutateAsync({ id: deleteTarget.id });
    await invalidate();
    setDeleteTarget(null);
    toast({ title: "Webhook deleted" });
  };

  const handleToggle = async (ep: WebhookEndpoint, enabled: boolean) => {
    await updateMutation.mutateAsync({ id: ep.id, data: { enabled } });
    await invalidate();
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar — parent StripeTabPage owns the Developers title */}
      <div className="shrink-0 border-b border-border px-5 py-4 sm:px-6 flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Push call results (transcript, summary, cost) to your app when a call finishes. This is not for receiving CRM leads.
        </p>
        <Button size="sm" className="h-8 text-xs gap-1.5 shrink-0" onClick={() => setCreateOpen(true)}>
          <Plus className="w-3.5 h-3.5" />
          Add endpoint
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-6 space-y-6">
          {/* Clarity: two different “webhook” concepts */}
          <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
            <p className="text-sm font-medium text-foreground">Which webhooks do you need?</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Webhook className="h-3.5 w-3.5" />
                  This page — outbound call events
                </p>
                <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
                  You give SnapServe a URL. After each call we POST{" "}
                  <code className="text-[10px]">call.completed</code> with transcript &amp; summary
                  so your product can update the CRM.
                </p>
              </div>
              <Link
                href="/app/connections"
                className="rounded-lg border border-border bg-card p-3 hover:border-muted-foreground/40 transition-colors group"
              >
                <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  Inbound leads — Connections
                  <ArrowRight className="h-3 w-3 opacity-50 group-hover:opacity-100" />
                </p>
                <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
                  Campaign / form lead webhooks go the other way: other tools POST into SnapServe.
                  Manage those under Connections, not here.
                </p>
              </Link>
            </div>
            <a
              href="/docs/webhooks"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              <BookOpen className="h-3.5 w-3.5" />
              Developer docs — verify signatures
              <ExternalLink className="h-3 w-3 opacity-60" />
            </a>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="h-24 rounded-xl bg-muted/40 border border-border animate-pulse" />
              ))}
            </div>
          ) : endpoints.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center rounded-xl border border-dashed border-border">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
                <Webhook className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No call webhooks yet</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                Add your app&apos;s HTTPS URL to receive call results after each conversation.
              </p>
              <Button size="sm" className="mt-4 h-8 text-xs gap-1.5" onClick={() => setCreateOpen(true)}>
                <Plus className="w-3.5 h-3.5" />
                Add endpoint
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {endpoints.map((ep) => (
                <div
                  key={ep.id}
                  className="p-4 rounded-xl bg-card border border-border hover:border-muted-foreground/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0 space-y-2">
                      <button
                        type="button"
                        onClick={() => copyText(`url-${ep.id}`, ep.url)}
                        className="flex items-center gap-1.5 text-sm text-foreground font-mono hover:text-primary transition-colors truncate max-w-full"
                      >
                        <span className="truncate">{ep.url}</span>
                        {copied === `url-${ep.id}` ? (
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                        ) : (
                          <Copy className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                        )}
                      </button>
                      {ep.description ? (
                        <p className="text-xs text-muted-foreground">{ep.description}</p>
                      ) : null}
                      <div className="flex flex-wrap gap-1.5">
                        {ep.events.map((ev) => (
                          <EventBadge key={ev} event={ev} />
                        ))}
                        {!ep.enabled ? (
                          <Badge variant="secondary" className="text-[10px]">
                            Paused
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {ep.secretHint ? (
                          <>
                            Secret ends with <code className="font-mono">{ep.secretHint}</code>
                            {" · "}
                          </>
                        ) : null}
                        Added {format(new Date(ep.createdAt), "MMM d, yyyy")}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Switch
                        checked={ep.enabled}
                        onCheckedChange={(v) => handleToggle(ep, v)}
                        className="scale-90"
                      />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditTarget(ep)} className="text-xs">
                            <Pencil className="w-3.5 h-3.5 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setDeleteTarget(ep)}
                            className="text-xs text-destructive focus:text-destructive"
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-2" />
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

          <div className="rounded-xl border border-border bg-muted/15 p-4 text-xs text-muted-foreground space-y-2">
            <p className="font-medium text-foreground text-sm">What we send</p>
            <pre className="font-mono text-[11px] leading-relaxed overflow-x-auto whitespace-pre-wrap text-foreground/80">{`POST https://your-app.com/hooks/snapserve
Content-Type: application/json
X-SnapServe-Signature: sha256=<hmac>
X-SnapServe-Timestamp: 1718612345

{
  "event": "call.completed",
  "timestamp": "2026-07-15T12:00:00.000Z",
  "data": {
    "callId": 2920,
    "agentId": 36,
    "status": "completed",
    "transcript": "…",
    "callSummary": "…",
    "costCents": 700,
    "durationSeconds": 84
  }
}`}</pre>
            <p>
              Verify with HMAC-SHA256 of <code className="text-foreground">{"{timestamp}.{rawBody}"}</code>{" "}
              using your endpoint secret. Full guide:{" "}
              <a href="/docs/webhooks" className="text-primary hover:underline">
                /docs/webhooks
              </a>
              .
            </p>
          </div>
        </div>
      </div>

      {/* Secret shown once after create */}
      <Dialog open={!!newSecret} onOpenChange={(o) => !o && setNewSecret(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Copy your signing secret
            </DialogTitle>
            <DialogDescription className="text-xs">
              This secret is shown only once. Store it in your vault — you will need it to verify{" "}
              <code>X-SnapServe-Signature</code>.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs break-all">
            {newSecret}
          </div>
          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              onClick={() => newSecret && copyText("secret", newSecret)}
              className="gap-1.5"
            >
              {copied === "secret" ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied === "secret" ? "Copied" : "Copy secret"}
            </Button>
            <Button size="sm" onClick={() => setNewSecret(null)}>
              I saved it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Add call webhook</DialogTitle>
            <DialogDescription className="text-xs">
              Point SnapServe at your HTTPS handler to receive call results.
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Edit webhook</DialogTitle>
          </DialogHeader>
          {editTarget ? (
            <WebhookForm
              initial={editTarget}
              onSubmit={handleUpdate}
              onCancel={() => setEditTarget(null)}
              loading={updateMutation.isPending}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Delete webhook?</DialogTitle>
            <DialogDescription className="text-xs">
              SnapServe will stop POSTing to{" "}
              <span className="font-mono text-foreground">{deleteTarget?.url}</span>.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={handleDelete}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
