import { useState, useRef } from "react";
import { useListPendriveApiKeys, getListPendriveApiKeysQueryKey, useCreatePendriveApiKey, useDeletePendriveApiKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Key, Copy, Check, Trash2, Plus, AlertCircle, Webhook, Zap } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export default function ApiKeys() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: apiKeys, isLoading } = useListPendriveApiKeys({
    query: { queryKey: getListPendriveApiKeysQueryKey() }
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<{name: string, plainKey: string} | null>(null);
  const [copied, setCopied] = useState(false);

  const createMutation = useCreatePendriveApiKey({
    mutation: {
      onSuccess: (data) => {
        setCreatedKey({ name: data.name, plainKey: data.plainKey });
        setNewKeyName("");
        queryClient.invalidateQueries({ queryKey: getListPendriveApiKeysQueryKey() });
        toast({
          title: "API Key Created",
          description: "Make sure to copy it now, it won't be shown again.",
        });
      },
      onError: () => {
        toast({
          title: "Error",
          description: "Failed to create API key.",
          variant: "destructive",
        });
      }
    }
  });

  const deleteMutation = useDeletePendriveApiKey({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPendriveApiKeysQueryKey() });
        toast({
          title: "API Key Revoked",
          description: "The API key has been permanently deleted.",
        });
      },
      onError: () => {
        toast({
          title: "Error",
          description: "Failed to revoke API key.",
          variant: "destructive",
        });
      }
    }
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    createMutation.mutate({ data: { name: newKeyName } });
  };

  const handleCopy = () => {
    if (createdKey) {
      navigator.clipboard.writeText(createdKey.plainKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const closeCreateDialog = () => {
    setCreateOpen(false);
    setTimeout(() => {
      setCreatedKey(null);
      setNewKeyName("");
    }, 200);
  };

  const webhookUrl = `${window.location.origin.replace(/\/pendrive.*/, "")}/api/pendrive/webhook`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">API Keys</h1>
          <p className="text-muted-foreground mt-2">
            Manage authentication keys for your Pendrive memory layer integration.
          </p>
        </div>
        
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Create API Key
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create API Key</DialogTitle>
              <DialogDescription>
                Use this key to authenticate requests to the Pendrive API.
              </DialogDescription>
            </DialogHeader>
            
            {createdKey ? (
              <div className="space-y-4 py-4">
                <div className="bg-destructive/10 border border-destructive/20 text-destructive text-sm p-3 rounded-md flex gap-2 items-start">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <p>Please copy this key and save it somewhere safe. For security reasons, <strong>we cannot show it to you again</strong>.</p>
                </div>
                <div className="space-y-2">
                  <Label>Your New API Key</Label>
                  <div className="flex items-center gap-2">
                    <Input 
                      readOnly 
                      value={createdKey.plainKey} 
                      className="font-mono bg-muted"
                    />
                    <Button 
                      variant="secondary" 
                      size="icon" 
                      onClick={handleCopy}
                      title="Copy to clipboard"
                    >
                      {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <DialogFooter className="pt-4">
                  <Button onClick={closeCreateDialog}>I have saved this key</Button>
                </DialogFooter>
              </div>
            ) : (
              <form onSubmit={handleCreate}>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Key Name</Label>
                    <Input 
                      id="name" 
                      placeholder="e.g. Production Environment, Dev Sandbox" 
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      autoFocus
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" type="button" onClick={() => setCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={!newKeyName.trim() || createMutation.isPending}>
                    {createMutation.isPending ? "Creating..." : "Create Key"}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Webhook className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Universal Webhook</CardTitle>
          </div>
          <CardDescription>
            Point any voice platform (VAPI, Retell, Bolna) to this URL. Pendrive auto-injects memory on call start and archives transcripts on call end — zero agent config changes needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-background/60 px-3 py-2 text-xs font-mono text-foreground border border-border/50 truncate">
              POST {webhookUrl}
            </code>
            <Button variant="outline" size="sm" className="shrink-0" onClick={() => { navigator.clipboard.writeText(webhookUrl); }}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5"><Zap className="h-3.5 w-3.5 text-yellow-500" /><span>Auth: <code className="text-foreground">Authorization: Bearer pd_live_...</code></span></div>
            <div className="flex items-center gap-1.5"><Zap className="h-3.5 w-3.5 text-blue-500" /><span>call.started → returns memory block</span></div>
            <div className="flex items-center gap-1.5"><Zap className="h-3.5 w-3.5 text-green-500" /><span>call.ended → archives transcript async</span></div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Key Prefix</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last Used</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(3)].map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-20 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : apiKeys?.length ? (
              apiKeys.map((apiKey) => (
                <TableRow key={apiKey.id}>
                  <TableCell className="font-medium flex items-center gap-2">
                    <Key className="h-4 w-4 text-muted-foreground" />
                    {apiKey.name}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {apiKey.keyPrefix}****************
                  </TableCell>
                  <TableCell className="text-sm">
                    {new Date(apiKey.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {apiKey.lastUsedAt ? new Date(apiKey.lastUsedAt).toLocaleDateString() : "Never"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => {
                        if (confirm(`Are you sure you want to revoke "${apiKey.name}"? This action cannot be undone.`)) {
                          deleteMutation.mutate({ id: apiKey.id });
                        }
                      }}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Revoke
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                  No API keys generated yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
