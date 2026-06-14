import { useState, useEffect } from "react";
import { useListPendriveApiKeys, getListPendriveApiKeysQueryKey, useCreatePendriveApiKey, useDeletePendriveApiKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Key, Copy, Check, Trash2, Plus, AlertCircle, Webhook, Zap, Bot, Eye, EyeOff, Cpu, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
const SESSION_KEY = "voiceorch:session";
function getSessionToken() { return localStorage.getItem(SESSION_KEY); }

async function apiFetch(path: string, options?: RequestInit) {
  const token = getSessionToken();
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "").replace(/\/pendrive.*/, "");
  return fetch(`${basePath}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers ?? {}),
    },
  });
}

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

  // Bolna integration state
  const [bolnaApiKey, setBolnaApiKey] = useState("");
  const [bolnaAgentId, setBolnaAgentId] = useState("");
  const [bolnaConfigured, setBolnaConfigured] = useState<{ agentId: string; apiKeyHint: string } | null>(null);
  const [boolnaLoading, setBolnaLoading] = useState(false);
  const [showBolnaKey, setShowBolnaKey] = useState(false);

  // LLM Proxy state
  const [proxyConfigured, setProxyConfigured] = useState<{ targetBaseUrl: string; targetModel: string | null; apiKeyHint: string } | null>(null);
  const [proxyBaseUrl, setProxyBaseUrl] = useState("");
  const [proxyApiKey, setProxyApiKey] = useState("");
  const [proxyModel, setProxyModel] = useState("");
  const [proxyLoading, setProxyLoading] = useState(false);
  const [showProxyKey, setShowProxyKey] = useState(false);
  const [showProxyInstructions, setShowProxyInstructions] = useState(false);

  useEffect(() => {
    apiFetch("/api/pendrive/bolna-config")
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.configured) {
          setBolnaConfigured({ agentId: data.agentId, apiKeyHint: data.apiKeyHint });
        }
      })
      .catch(() => {});

    apiFetch("/api/pendrive/llm-proxy/config")
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.configured) {
          setProxyConfigured({ targetBaseUrl: data.targetBaseUrl, targetModel: data.targetModel, apiKeyHint: data.apiKeyHint });
        }
      })
      .catch(() => {});
  }, []);

  const saveBolnaConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bolnaApiKey.trim() || !bolnaAgentId.trim()) return;
    setBolnaLoading(true);
    try {
      const res = await apiFetch("/api/pendrive/bolna-config", {
        method: "POST",
        body: JSON.stringify({ apiKey: bolnaApiKey.trim(), agentId: bolnaAgentId.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setBolnaConfigured({ agentId: data.agentId, apiKeyHint: data.apiKeyHint });
        setBolnaApiKey("");
        toast({ title: "Bolna connected!", description: "Memory will auto-inject on every call." });
      } else {
        toast({ title: "Error", description: data.error ?? "Failed to save", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Network error", variant: "destructive" });
    } finally {
      setBolnaLoading(false);
    }
  };

  const removeBolnaConfig = async () => {
    await apiFetch("/api/pendrive/bolna-config", { method: "DELETE" });
    setBolnaConfigured(null);
    setBolnaAgentId("");
    setBolnaApiKey("");
    toast({ title: "Bolna disconnected" });
  };

  const saveProxyConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!proxyBaseUrl.trim() || !proxyApiKey.trim()) return;
    setProxyLoading(true);
    try {
      const res = await apiFetch("/api/pendrive/llm-proxy/config", {
        method: "PUT",
        body: JSON.stringify({ targetBaseUrl: proxyBaseUrl.trim(), targetApiKey: proxyApiKey.trim(), targetModel: proxyModel.trim() || null }),
      });
      const data = await res.json();
      if (res.ok) {
        setProxyConfigured({ targetBaseUrl: data.targetBaseUrl, targetModel: data.targetModel, apiKeyHint: data.apiKeyHint });
        setProxyApiKey("");
        toast({ title: "LLM Proxy configured!", description: "Caller memory will be injected on every LLM turn." });
      } else {
        toast({ title: "Error", description: data.error ?? "Failed to save", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Network error", variant: "destructive" });
    } finally {
      setProxyLoading(false);
    }
  };

  const removeProxyConfig = async () => {
    await apiFetch("/api/pendrive/llm-proxy/config", { method: "DELETE" });
    setProxyConfigured(null);
    setProxyBaseUrl("");
    setProxyApiKey("");
    setProxyModel("");
    toast({ title: "LLM Proxy removed" });
  };

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
        toast({ title: "Error", description: "Failed to create API key.", variant: "destructive" });
      }
    }
  });

  const deleteMutation = useDeletePendriveApiKey({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPendriveApiKeysQueryKey() });
        toast({ title: "API Key Revoked", description: "The API key has been permanently deleted." });
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to revoke API key.", variant: "destructive" });
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
    setTimeout(() => { setCreatedKey(null); setNewKeyName(""); }, 200);
  };

  const webhookUrl  = `${window.location.origin.replace(/\/pendrive.*/, "")}/api/pendrive/webhook`;
  const proxyUrl    = `${window.location.origin.replace(/\/pendrive.*/, "")}/api/pendrive/llm-proxy`;

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied!", description: text.length > 60 ? text.slice(0, 60) + "…" : text });
  };

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
                    <Input readOnly value={createdKey.plainKey} className="font-mono bg-muted" />
                    <Button variant="secondary" size="icon" onClick={handleCopy} title="Copy to clipboard">
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
                  <Button variant="outline" type="button" onClick={() => setCreateOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={!newKeyName.trim() || createMutation.isPending}>
                    {createMutation.isPending ? "Creating..." : "Create Key"}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {/* ── Universal Webhook ───────────────────────────────────────────── */}
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Webhook className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Universal Webhook</CardTitle>
          </div>
          <CardDescription>
            Point any voice platform (VAPI, Retell, Bolna) to this URL. Pendrive auto-archives transcripts on call end — zero agent config changes needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1.5 font-medium">Generic / VAPI / Retell / Bolna</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-background/60 px-3 py-2 text-xs font-mono text-foreground border border-border/50 truncate">
                POST {webhookUrl}
              </code>
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => copyText(webhookUrl)}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5"><Zap className="h-3.5 w-3.5 text-green-500" /><span>call.ended → archives transcript + extracts facts</span></div>
            <div className="flex items-center gap-1.5"><Zap className="h-3.5 w-3.5 text-blue-500" /><span>call.started → returns memory block for VAPI/Retell</span></div>
          </div>
        </CardContent>
      </Card>

      {/* ── LLM Proxy ───────────────────────────────────────────────────── */}
      <Card className="border-violet-500/20 bg-violet-500/5">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-violet-400" />
              <CardTitle className="text-base">LLM Proxy</CardTitle>
              {proxyConfigured
                ? <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Active</Badge>
                : <Badge variant="outline" className="text-muted-foreground">Not configured</Badge>
              }
            </div>
            {proxyConfigured && (
              <Button variant="ghost" size="sm" onClick={removeProxyConfig} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove
              </Button>
            )}
          </div>
          <CardDescription>
            <strong>The real solution.</strong> Point your agent's LLM at Pendrive instead of OpenAI/Groq directly. Every LLM turn gets caller memory injected automatically — no system prompt hacks, works with any voice platform, any agent.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Proxy URL row */}
          <div>
            <p className="text-xs text-muted-foreground mb-1.5 font-medium">Your proxy base URL (paste this as the LLM base_url in your agent)</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-background/60 px-3 py-2 text-xs font-mono text-foreground border border-border/50 truncate">
                {proxyUrl}
              </code>
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => copyText(proxyUrl)}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {proxyConfigured ? (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-3 rounded bg-background/60 border border-border/50 px-3 py-2">
                <span className="text-muted-foreground w-28 shrink-0">Target LLM</span>
                <code className="text-foreground font-mono text-xs">{proxyConfigured.targetBaseUrl}</code>
              </div>
              {proxyConfigured.targetModel && (
                <div className="flex items-center gap-3 rounded bg-background/60 border border-border/50 px-3 py-2">
                  <span className="text-muted-foreground w-28 shrink-0">Model override</span>
                  <code className="text-foreground font-mono text-xs">{proxyConfigured.targetModel}</code>
                </div>
              )}
              <div className="flex items-center gap-3 rounded bg-background/60 border border-border/50 px-3 py-2">
                <span className="text-muted-foreground w-28 shrink-0">API Key</span>
                <code className="text-foreground font-mono text-xs">{proxyConfigured.apiKeyHint}</code>
              </div>
            </div>
          ) : (
            <form onSubmit={saveProxyConfig} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Target LLM Base URL</Label>
                  <Input
                    placeholder="https://api.openai.com/v1"
                    value={proxyBaseUrl}
                    onChange={e => setProxyBaseUrl(e.target.value)}
                    className="font-mono text-xs h-8"
                  />
                  <p className="text-xs text-muted-foreground">OpenAI: <code>https://api.openai.com/v1</code> · Groq: <code>https://api.groq.com/openai/v1</code></p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Target LLM API Key</Label>
                  <div className="relative">
                    <Input
                      type={showProxyKey ? "text" : "password"}
                      placeholder="sk-..."
                      value={proxyApiKey}
                      onChange={e => setProxyApiKey(e.target.value)}
                      className="font-mono text-xs h-8 pr-8"
                    />
                    <button type="button" className="absolute right-2 top-1.5 text-muted-foreground hover:text-foreground" onClick={() => setShowProxyKey(v => !v)}>
                      {showProxyKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Model Override <span className="text-muted-foreground">(optional)</span></Label>
                  <Input
                    placeholder="gpt-4o-mini"
                    value={proxyModel}
                    onChange={e => setProxyModel(e.target.value)}
                    className="font-mono text-xs h-8"
                  />
                  <p className="text-xs text-muted-foreground">Leave blank to use model from agent config</p>
                </div>
              </div>
              <Button type="submit" size="sm" disabled={!proxyBaseUrl.trim() || !proxyApiKey.trim() || proxyLoading}>
                {proxyLoading ? "Saving..." : "Save Config"}
              </Button>
            </form>
          )}

          {/* Collapsible setup instructions */}
          <div className="border border-border/40 rounded-md">
            <button
              type="button"
              className="w-full flex items-center justify-between px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowProxyInstructions(v => !v)}
            >
              <span className="font-medium">Setup instructions for Bolna (and other platforms)</span>
              {showProxyInstructions ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            {showProxyInstructions && (
              <div className="px-3 pb-3 space-y-3 border-t border-border/40 pt-3">
                <ol className="space-y-3 text-xs text-muted-foreground list-decimal list-inside">
                  <li>
                    <strong className="text-foreground">Configure Target LLM above</strong> — enter your real LLM provider URL and API key.
                  </li>
                  <li>
                    <strong className="text-foreground">In your agent (Bolna, VAPI, etc.)</strong>, set the LLM config:
                    <div className="mt-1.5 space-y-1">
                      <div className="flex items-center gap-2">
                        <code className="flex-1 rounded bg-background/80 px-2 py-1 font-mono border border-border/50">base_url = {proxyUrl}</code>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" onClick={() => copyText(proxyUrl)}><Copy className="h-3 w-3" /></Button>
                      </div>
                      <code className="block rounded bg-background/80 px-2 py-1 font-mono border border-border/50">api_key  = pd_live_...  ← your Pendrive key</code>
                    </div>
                  </li>
                  <li>
                    <strong className="text-foreground">Add phone tag to your system prompt</strong> — Pendrive uses it to look up the caller's memory:
                    <div className="mt-1.5 flex items-center gap-2">
                      <code className="flex-1 rounded bg-background/80 px-2 py-1 font-mono text-violet-300 border border-border/50">{"<!-- pendrive:phone:%(to_number)s -->"}</code>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" onClick={() => copyText("<!-- pendrive:phone:%(to_number)s -->")}><Copy className="h-3 w-3" /></Button>
                    </div>
                    <p className="mt-1">Bolna replaces <code>%(to_number)s</code> with the caller's number. Pendrive strips the tag before forwarding to the LLM.</p>
                  </li>
                  <li>
                    <strong className="text-foreground">That's it.</strong> Every LLM turn gets caller memory injected automatically — the agent just "knows" who's calling.
                  </li>
                </ol>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1 border-t border-border/40">
                  <ExternalLink className="h-3 w-3" />
                  <span>Works with any OpenAI-compatible platform: Bolna, VAPI, Retell, Bland, custom agents.</span>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5"><Zap className="h-3.5 w-3.5 text-violet-400" /><span>memory injected per LLM turn, not per session</span></div>
            <div className="flex items-center gap-1.5"><Zap className="h-3.5 w-3.5 text-blue-400" /><span>works across all callers simultaneously</span></div>
            <div className="flex items-center gap-1.5"><Zap className="h-3.5 w-3.5 text-green-400" /><span>streaming fully supported</span></div>
          </div>
        </CardContent>
      </Card>

      {/* ── Bolna Auto-Inject (legacy system prompt approach) ───────────── */}
      <Card className="border-orange-500/20 bg-orange-500/5">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-orange-500" />
              <CardTitle className="text-base">Bolna Auto-Inject</CardTitle>
              <Badge variant="outline" className="text-muted-foreground text-xs">Webhook approach</Badge>
              {bolnaConfigured
                ? <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Connected</Badge>
                : <Badge variant="outline" className="text-muted-foreground">Not configured</Badge>
              }
            </div>
            {bolnaConfigured && (
              <Button variant="ghost" size="sm" onClick={removeBolnaConfig} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5 mr-1" /> Disconnect
              </Button>
            )}
          </div>
          <CardDescription>
            Pendrive patches the Bolna agent's system prompt with caller memory on call end (ready for next call). Use the LLM Proxy above for real-time injection on every turn.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {bolnaConfigured ? (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-3 rounded bg-background/60 border border-border/50 px-3 py-2">
                <span className="text-muted-foreground w-20 shrink-0">Agent ID</span>
                <code className="text-foreground font-mono">{bolnaConfigured.agentId}</code>
              </div>
              <div className="flex items-center gap-3 rounded bg-background/60 border border-border/50 px-3 py-2">
                <span className="text-muted-foreground w-20 shrink-0">API Key</span>
                <code className="text-foreground font-mono">{bolnaConfigured.apiKeyHint}</code>
              </div>
              <p className="text-xs text-muted-foreground pt-1">
                ✅ On <code>call.ended</code>, caller memory is written into the Bolna agent system prompt for the next call.
              </p>
            </div>
          ) : (
            <form onSubmit={saveBolnaConfig} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Bolna Agent ID</Label>
                  <Input
                    placeholder="agent_abc123..."
                    value={bolnaAgentId}
                    onChange={e => setBolnaAgentId(e.target.value)}
                    className="font-mono text-xs h-8"
                  />
                  <p className="text-xs text-muted-foreground">From Bolna → Agent → Agent ID button</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Bolna API Key</Label>
                  <div className="relative">
                    <Input
                      type={showBolnaKey ? "text" : "password"}
                      placeholder="Your Bolna API key"
                      value={bolnaApiKey}
                      onChange={e => setBolnaApiKey(e.target.value)}
                      className="font-mono text-xs h-8 pr-8"
                    />
                    <button type="button" className="absolute right-2 top-1.5 text-muted-foreground hover:text-foreground" onClick={() => setShowBolnaKey(v => !v)}>
                      {showBolnaKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">Bolna → Settings → API Key</p>
                </div>
              </div>
              <Button type="submit" size="sm" disabled={!bolnaApiKey.trim() || !bolnaAgentId.trim() || boolnaLoading}>
                {boolnaLoading ? "Connecting..." : "Connect Bolna Agent"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {/* ── API Keys table ───────────────────────────────────────────────── */}
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
