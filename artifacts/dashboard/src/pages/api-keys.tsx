import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Key, Plus, Trash2, Copy, Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { customFetch } from "@workspace/api-client-react";
import { SNAPSERVE_API_BASE } from "@/lib/public-urls";

interface ApiKey {
  id: number;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

function useApiKeys() {
  return useQuery<{ keys: ApiKey[] }>({
    queryKey: ["user-api-keys"],
    queryFn: () => customFetch<{ keys: ApiKey[] }>("/api/user-api-keys"),
  });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ApiKeysPage() {
  const { data, isLoading } = useApiKeys();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [revealKey,  setRevealKey]  = useState<string | null>(null);
  const [revokeId,   setRevokeId]   = useState<number | null>(null);

  const createMutation = useMutation({
    mutationFn: (name: string) =>
      customFetch<{ key: string; prefix: string; name: string }>("/api/user-api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }),
    onSuccess: (data) => { qc.invalidateQueries({ queryKey: ["user-api-keys"] }); setCreateOpen(false); setNewKeyName(""); setRevealKey(data.key); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: number) =>
      customFetch<void>(`/api/user-api-keys/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["user-api-keys"] }); setRevokeId(null); toast({ title: "Key revoked" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const copyKey = (key: string) => { navigator.clipboard.writeText(key); toast({ title: "Copied!", description: "API key copied to clipboard." }); };

  const activeKeys  = data?.keys.filter(k => !k.revokedAt) ?? [];
  const revokedKeys = data?.keys.filter(k =>  k.revokedAt) ?? [];

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      {/* Toolbar — parent StripeTabPage owns the Developers title */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground/60">Use API keys to authenticate requests from your own apps or automations.</p>
        <Button onClick={() => setCreateOpen(true)} disabled={activeKeys.length >= 5} className="h-8 text-xs gap-2 shrink-0">
          <Plus className="w-3.5 h-3.5" /> New Key
        </Button>
      </div>

      {activeKeys.length >= 5 && (
        <div className="flex items-center gap-2.5 text-sm text-muted-foreground bg-card border border-border px-4 py-3 rounded-xl">
          <AlertCircle className="w-4 h-4 shrink-0 text-muted-foreground/60" />
          Maximum 5 active keys reached. Revoke one to create a new key.
        </div>
      )}

      {/* One-time key reveal */}
      {revealKey && (
        <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-foreground/50 shrink-0" />
            <p className="text-sm font-semibold text-foreground">Key created — save it now</p>
          </div>
          <p className="text-xs text-muted-foreground/60">This key will not be shown again. Copy it to a safe place.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-elevated border border-border rounded-xl px-3 py-2.5 font-mono break-all text-foreground/80">
              {revealKey}
            </code>
            <button onClick={() => copyKey(revealKey)} className="h-9 w-9 shrink-0 flex items-center justify-center rounded-xl border border-border bg-elevated hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>
          <button onClick={() => setRevealKey(null)} className="text-xs text-muted-foreground/60 hover:text-foreground transition-colors underline underline-offset-2">
            I've saved my key
          </button>
        </div>
      )}

      {/* Active keys */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border/50">
          <p className="text-sm font-semibold text-foreground">Active Keys</p>
          <p className="text-xs text-muted-foreground/50 mt-0.5">{activeKeys.length} of 5 slots used</p>
        </div>
        <div className="px-5 py-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground/60 py-2">Loading…</p>
          ) : activeKeys.length === 0 ? (
            <div className="text-center py-8">
              <div className="h-10 w-10 rounded-xl bg-elevated border border-border flex items-center justify-center mx-auto mb-2.5">
                <Key className="w-4 h-4 text-muted-foreground/40" />
              </div>
              <p className="text-sm text-muted-foreground/60">No API keys yet. Create one to get started.</p>
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {activeKeys.map(k => (
                <div key={k.id} className="flex items-center gap-4 py-3.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{k.name}</p>
                    <code className="text-[11px] text-muted-foreground/50 font-mono">{k.keyPrefix}{"•".repeat(32)}</code>
                  </div>
                  <div className="text-[11px] text-muted-foreground/50 text-right shrink-0">
                    <p className="flex items-center gap-1 justify-end mb-0.5">
                      <Clock className="w-3 h-3" />
                      {k.lastUsedAt ? `Last used ${timeAgo(k.lastUsedAt)}` : "Never used"}
                    </p>
                    <p>Created {timeAgo(k.createdAt)}</p>
                  </div>
                  <button onClick={() => setRevokeId(k.id)} className="h-7 w-7 flex items-center justify-center rounded-lg border border-border bg-elevated hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Revoked keys */}
      {revokedKeys.length > 0 && (
        <div className="bg-card border border-border rounded-2xl overflow-hidden opacity-50">
          <div className="px-5 py-4 border-b border-border/50">
            <p className="text-sm font-semibold text-muted-foreground">Revoked Keys</p>
          </div>
          <div className="px-5 py-3 divide-y divide-border/40">
            {revokedKeys.map(k => (
              <div key={k.id} className="flex items-center gap-4 py-3">
                <div className="flex-1">
                  <p className="text-sm text-muted-foreground line-through">{k.name}</p>
                  <code className="text-[11px] text-muted-foreground/40 font-mono">{k.keyPrefix}{"•".repeat(32)}</code>
                </div>
                <span className="text-[10px] text-muted-foreground/50 px-2 py-0.5 rounded border border-border shrink-0">Revoked {timeAgo(k.revokedAt!)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Usage guide */}
      <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
        <p className="text-sm font-semibold text-foreground">Using your API key</p>
        <p className="text-xs text-muted-foreground/60">Authenticate requests by passing the key in the Authorization header:</p>
        <pre className="text-xs bg-elevated border border-border/50 rounded-xl p-4 overflow-auto font-mono text-muted-foreground/70 leading-relaxed">
{`curl ${SNAPSERVE_API_BASE}/agents \\
  -H "Authorization: Bearer sk_live_your_key_here"`}
        </pre>
        <p className="text-[11px] text-muted-foreground/50">
          Base URL is <code className="text-foreground/70">{SNAPSERVE_API_BASE}</code>. Do not use{" "}
          <code>api.snapserve.ai</code> — that host is not the SnapServe API.
        </p>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
            <DialogDescription>Give your key a name so you can identify it later.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Key Name</Label>
            <Input placeholder="e.g. Production App, Zapier Integration" value={newKeyName}
              onChange={e => setNewKeyName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && newKeyName.trim()) createMutation.mutate(newKeyName.trim()); }} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button disabled={!newKeyName.trim() || createMutation.isPending} onClick={() => createMutation.mutate(newKeyName.trim())}>
              {createMutation.isPending ? "Creating…" : "Create Key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={revokeId !== null} onOpenChange={o => { if (!o) setRevokeId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API Key?</AlertDialogTitle>
            <AlertDialogDescription>This key will stop working immediately. Any apps or integrations using it will fail. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => revokeId !== null && revokeMutation.mutate(revokeId)} disabled={revokeMutation.isPending}>
              {revokeMutation.isPending ? "Revoking…" : "Revoke Key"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
