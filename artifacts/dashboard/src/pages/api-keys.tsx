import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Key, Plus, Trash2, Copy, Eye, EyeOff, AlertCircle, Clock, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

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
    queryFn: async () => {
      const r = await fetch("/api/user-api-keys");
      if (!r.ok) throw new Error("Failed to load API keys");
      return r.json();
    },
  });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)   return "just now";
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function ApiKeysPage() {
  const { data, isLoading } = useApiKeys();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [createOpen, setCreateOpen]   = useState(false);
  const [newKeyName, setNewKeyName]   = useState("");
  const [revealKey, setRevealKey]     = useState<string | null>(null);
  const [revokeId, setRevokeId]       = useState<number | null>(null);

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const r = await fetch("/api/user-api-keys", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Failed to create key"); }
      return r.json() as Promise<{ key: string; prefix: string; name: string }>;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["user-api-keys"] });
      setCreateOpen(false);
      setNewKeyName("");
      setRevealKey(data.key);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/user-api-keys/${id}`, { method: "DELETE" });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Failed to revoke key"); }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-api-keys"] });
      setRevokeId(null);
      toast({ title: "Key revoked", description: "The API key has been revoked and is no longer usable." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const copyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    toast({ title: "Copied!", description: "API key copied to clipboard." });
  };

  const activeKeys  = data?.keys.filter((k) => !k.revokedAt) ?? [];
  const revokedKeys = data?.keys.filter((k) => k.revokedAt)  ?? [];

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">API Keys</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Use API keys to authenticate requests from your own apps or automations.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} disabled={activeKeys.length >= 5}>
          <Plus className="w-4 h-4 mr-2" /> New Key
        </Button>
      </div>

      {activeKeys.length >= 5 && (
        <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/30 px-4 py-2 rounded-md border border-amber-200 dark:border-amber-800">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Maximum 5 active keys reached. Revoke one to create a new key.
        </div>
      )}

      {/* One-time key reveal */}
      {revealKey && (
        <Card className="border-green-500 dark:border-green-700 bg-green-50 dark:bg-green-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-green-700 dark:text-green-400 flex items-center gap-2 text-base">
              <CheckCircle2 className="w-5 h-5" /> Key created — save it now
            </CardTitle>
            <CardDescription>This key will not be shown again. Copy it to a safe place.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm bg-white dark:bg-black border rounded px-3 py-2 font-mono break-all">
                {revealKey}
              </code>
              <Button size="sm" variant="outline" onClick={() => copyKey(revealKey)}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <Button size="sm" variant="ghost" className="text-green-700 dark:text-green-400" onClick={() => setRevealKey(null)}>
              I've saved my key
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Active keys */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active Keys</CardTitle>
          <CardDescription>{activeKeys.length} of 5 slots used</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : activeKeys.length === 0 ? (
            <div className="text-center py-8">
              <Key className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-muted-foreground text-sm">No API keys yet. Create one to get started.</p>
            </div>
          ) : (
            <div className="divide-y">
              {activeKeys.map((k) => (
                <div key={k.id} className="flex items-center gap-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{k.name}</p>
                    <code className="text-xs text-muted-foreground font-mono">{k.keyPrefix}••••••••••••••••••••••••••••••••</code>
                  </div>
                  <div className="text-xs text-muted-foreground text-right shrink-0">
                    <p className="flex items-center gap-1 justify-end">
                      <Clock className="w-3 h-3" />
                      {k.lastUsedAt ? `Last used ${timeAgo(k.lastUsedAt)}` : "Never used"}
                    </p>
                    <p>Created {timeAgo(k.createdAt)}</p>
                  </div>
                  <Button
                    size="sm" variant="ghost"
                    className="text-destructive hover:text-destructive shrink-0"
                    onClick={() => setRevokeId(k.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Revoked keys */}
      {revokedKeys.length > 0 && (
        <Card className="opacity-60">
          <CardHeader>
            <CardTitle className="text-base text-muted-foreground">Revoked Keys</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {revokedKeys.map((k) => (
                <div key={k.id} className="flex items-center gap-4 py-3">
                  <div className="flex-1">
                    <p className="font-medium text-sm line-through text-muted-foreground">{k.name}</p>
                    <code className="text-xs text-muted-foreground font-mono">{k.keyPrefix}••••••••••••••••••••••••••••••••</code>
                  </div>
                  <Badge variant="secondary" className="shrink-0">Revoked {timeAgo(k.revokedAt!)}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Usage guide */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Using your API key</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Authenticate requests by passing the key in the Authorization header:</p>
          <pre className="text-xs bg-muted rounded p-3 overflow-auto">
{`curl https://api.snapserve.ai/api/agents \\
  -H "Authorization: Bearer sk_live_your_key_here"`}
          </pre>
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
            <DialogDescription>Give your key a name so you can identify it later.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Key Name</Label>
            <Input
              placeholder="e.g. Production App, Zapier Integration"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && newKeyName.trim()) createMutation.mutate(newKeyName.trim()); }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              disabled={!newKeyName.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate(newKeyName.trim())}
            >
              {createMutation.isPending ? "Creating…" : "Create Key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke dialog */}
      <AlertDialog open={revokeId !== null} onOpenChange={(o) => { if (!o) setRevokeId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API Key?</AlertDialogTitle>
            <AlertDialogDescription>
              This key will stop working immediately. Any apps or integrations using it will fail.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => revokeId !== null && revokeMutation.mutate(revokeId)}
              disabled={revokeMutation.isPending}
            >
              {revokeMutation.isPending ? "Revoking…" : "Revoke Key"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
