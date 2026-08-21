import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, formatAdminError } from "@/lib/api";
import { Search, Copy, Check, ExternalLink, RefreshCw, Bot, User, Sparkles } from "lucide-react";

type AdminAgentRow = {
  id: number;
  name: string;
  agentType: string | null;
  ownerUserId: string | null;
  company: string | null;
  status: string;
  asrProvider: string | null;
  llmProvider: string | null;
  ttsProvider: string | null;
  voice: string | null;
  language: string | null;
  totalCalls: number;
  completedCalls: number;
  failedCalls: number;
  totalDurationSeconds: number;
  promptTemplateVersion: number | null;
  hasGeneratedPrompt: boolean;
  hasWizardInputs: boolean;
  createdAt: string;
};

type AgentPromptDetail = {
  id: number;
  name: string;
  systemPrompt: string;
  generatedPrompt: string | null;
  promptTemplateVersion: number | null;
  wizardInputs: Record<string, unknown> | null;
};

function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return "0s";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h === 0) return `${m}m ${s}s`;
  return `${h}h ${remM}m`;
}

export default function AllAgentsPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<AdminAgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<AgentPromptDetail | null>(null);
  const [regenId, setRegenId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "draft">("all");
  const [copiedId, setCopiedId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      setRows(await adminFetch<AdminAgentRow[]>("/agents"));
    } catch (err) {
      toast({ title: "Load failed", description: formatAdminError(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function viewPrompt(id: number) {
    try {
      const d = await adminFetch<AgentPromptDetail>(`/agents/${id}/prompt`);
      setDetail(d);
    } catch (err) {
      toast({ title: "Load failed", description: formatAdminError(err), variant: "destructive" });
    }
  }

  async function regenerate(id: number) {
    setRegenId(id);
    try {
      const d = await adminFetch<{ generatedPrompt: string; promptTemplateVersion: number | null }>(
        `/agents/${id}/regenerate`,
        { method: "POST" },
      );
      toast({ title: "Prompt regenerated", description: `Template v${d.promptTemplateVersion ?? "?"} applied.` });
      if (detail?.id === id) await viewPrompt(id);
      void load();
    } catch (err) {
      toast({ title: "Regenerate failed", description: formatAdminError(err), variant: "destructive" });
    } finally {
      setRegenId(null);
    }
  }

  const handleCopyId = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(String(id));
    setCopiedId(id);
    toast({ title: "Copied Agent ID", description: `Agent #${id} copied to clipboard.` });
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredRows = useMemo(() => {
    const raw = search.trim();
    if (!raw) {
      return statusFilter === "all" ? rows : rows.filter((r) => r.status === statusFilter);
    }

    // If query starts with # or is purely digits (e.g. 179 or #179), match EXACT Agent ID only
    if (/^#?\d+$/.test(raw)) {
      const targetId = parseInt(raw.replace(/^#/, ""), 10);
      return rows.filter((r) => {
        if (statusFilter !== "all" && r.status !== statusFilter) return false;
        return r.id === targetId;
      });
    }

    const q = raw.toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      const nameMatch = (r.name || "").toLowerCase().includes(q);
      const companyMatch = (r.company || "").toLowerCase().includes(q);
      const ownerMatch = (r.ownerUserId || "").toLowerCase().includes(q);
      const asrMatch = (r.asrProvider || "").toLowerCase().includes(q);
      const llmMatch = (r.llmProvider || "").toLowerCase().includes(q);
      const ttsMatch = (r.ttsProvider || "").toLowerCase().includes(q);
      return nameMatch || companyMatch || ownerMatch || asrMatch || llmMatch || ttsMatch;
    });
  }, [rows, search, statusFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">All Agents</h1>
          <p className="text-muted-foreground mt-1">Platform-wide agent directory. Search by Agent ID, Name, Owner, or Stack.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="gap-1.5 self-start sm:self-auto">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <CardTitle className="text-lg">
                {loading ? "Loading…" : `${filteredRows.length} of ${rows.length} agent${rows.length === 1 ? "" : "s"}`}
              </CardTitle>
              <CardDescription>Type an Agent ID (e.g. 104) to look up its call volume and details</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[240px] flex-1 sm:flex-initial">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by ID (e.g. 104), Name, Owner, Model…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-9 text-xs"
                />
              </div>
              <div className="flex items-center rounded-md border border-border bg-muted/40 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setStatusFilter("all")}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${statusFilter === "all" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter("active")}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${statusFilter === "active" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Active
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter("draft")}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${statusFilter === "draft" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  Draft
                </button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!loading && filteredRows.length === 0 ? (
            <div className="py-12 text-center">
              <Bot className="h-10 w-10 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm font-medium text-foreground">No matching agents found</p>
              <p className="text-xs text-muted-foreground mt-1">Try searching with a different ID or keyword.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground border-b border-border">
                  <tr>
                    <th className="py-2.5 pr-3 w-[100px]">Agent ID</th>
                    <th className="py-2.5 pr-3">Name</th>
                    <th className="py-2.5 pr-3">Owner User</th>
                    <th className="py-2.5 pr-3 text-center">Calls</th>
                    <th className="py-2.5 pr-3 text-center">Duration</th>
                    <th className="py-2.5 pr-3">AI Stack</th>
                    <th className="py-2.5 pr-3">Status</th>
                    <th className="py-2.5 pr-3">Created</th>
                    <th className="py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r) => (
                    <tr key={r.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="py-2.5 pr-3 font-mono">
                        <button
                          type="button"
                          onClick={(e) => handleCopyId(e, r.id)}
                          className="group inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-muted/50 px-2 py-0.5 text-xs font-mono font-semibold text-foreground hover:bg-muted hover:border-foreground/30 transition-colors"
                          title="Click to copy ID"
                        >
                          <span>#{r.id}</span>
                          {copiedId === r.id ? (
                            <Check className="h-3 w-3 text-emerald-500" />
                          ) : (
                            <Copy className="h-3 w-3 opacity-40 group-hover:opacity-100" />
                          )}
                        </button>
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="font-medium text-foreground">{r.name}</div>
                        {r.company && <div className="text-[11px] text-muted-foreground">{r.company}</div>}
                        {r.agentType && <span className="text-[10px] text-muted-foreground/80">{r.agentType}</span>}
                      </td>
                      <td className="py-2.5 pr-3">
                        {r.ownerUserId ? (
                          <Link
                            href={`/users/${r.ownerUserId}`}
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline max-w-[160px] truncate font-mono"
                            title={`View user ${r.ownerUserId}`}
                          >
                            <User className="h-3 w-3 shrink-0 opacity-70" />
                            <span className="truncate">{r.ownerUserId}</span>
                          </Link>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-center">
                        <div className="font-mono text-xs font-semibold text-foreground">
                          {r.totalCalls}
                        </div>
                        {r.totalCalls > 0 && (
                          <div className="text-[10px] text-muted-foreground">
                            <span className="text-emerald-600 dark:text-emerald-400">{r.completedCalls} ok</span>
                            {r.failedCalls > 0 && <span className="text-destructive ml-1">· {r.failedCalls} fail</span>}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-center font-mono text-xs text-muted-foreground">
                        {formatDuration(r.totalDurationSeconds)}
                      </td>
                      <td className="py-2.5 pr-3 text-xs">
                        <div className="text-[11px] font-medium text-foreground truncate max-w-[170px]">
                          {r.llmProvider || "Default LLM"}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate max-w-[170px]">
                          {r.asrProvider || "ASR"} · {r.voice || r.ttsProvider || "TTS"}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3">
                        <Badge variant={r.status === "active" ? "default" : "outline"} className="text-[10px] uppercase">
                          {r.status}
                        </Badge>
                      </td>
                      <td className="py-2.5 pr-3 text-muted-foreground text-xs">{new Date(r.createdAt).toLocaleDateString()}</td>
                      <td className="py-2.5 space-x-1.5 text-right whitespace-nowrap">
                        {r.ownerUserId && (
                          <Link href={`/users/${r.ownerUserId}/agents/${r.id}`}>
                            <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1">
                              <span>Edit</span>
                              <ExternalLink className="h-3 w-3 opacity-60" />
                            </Button>
                          </Link>
                        )}
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => viewPrompt(r.id)}>
                          Prompt
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={!r.hasWizardInputs || regenId === r.id}
                          onClick={() => regenerate(r.id)}
                          title={r.hasWizardInputs ? "Regenerate prompt with template" : "No wizard inputs stored for this agent"}
                        >
                          {regenId === r.id ? "Regenerating…" : "Regen"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {detail && (
        <Card className="border-primary/30 shadow-md">
          <CardHeader className="bg-muted/30 pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary" />
                <span>Agent #{detail.id} — {detail.name}</span>
                {detail.promptTemplateVersion != null && <Badge variant="outline">Template v{detail.promptTemplateVersion}</Badge>}
              </span>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setDetail(null)}>Close</Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Generated Call-Time Prompt</h3>
              {detail.generatedPrompt ? (
                <pre className="text-xs whitespace-pre-wrap bg-muted p-3.5 rounded-md border border-border max-h-72 overflow-y-auto font-mono">{detail.generatedPrompt}</pre>
              ) : (
                <p className="text-xs text-muted-foreground bg-muted/40 p-3 rounded border border-border">No generated prompt — falls back to the dashboard call-flow prompt below.</p>
              )}
            </section>
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">User System Prompt (Call Flow)</h3>
              <pre className="text-xs whitespace-pre-wrap bg-muted/40 p-3 rounded-md border border-border max-h-48 overflow-y-auto font-mono">{detail.systemPrompt || "—"}</pre>
            </section>
            {detail.wizardInputs && (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Wizard Inputs</h3>
                <pre className="text-xs whitespace-pre-wrap bg-muted/40 p-3 rounded-md border border-border max-h-48 overflow-y-auto font-mono">{JSON.stringify(detail.wizardInputs, null, 2)}</pre>
              </section>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
