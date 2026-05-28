import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, formatAdminError } from "@/lib/api";

type AdminAgentRow = {
  id: number;
  name: string;
  agentType: string | null;
  ownerUserId: string | null;
  company: string | null;
  status: string;
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

export default function AllAgentsPage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<AdminAgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<AgentPromptDetail | null>(null);
  const [regenId, setRegenId] = useState<number | null>(null);

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
      // Refresh detail view if currently open for this agent
      if (detail?.id === id) await viewPrompt(id);
      void load();
    } catch (err) {
      toast({ title: "Regenerate failed", description: formatAdminError(err), variant: "destructive" });
    } finally {
      setRegenId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">All Agents</h1>
        <p className="text-muted-foreground mt-1">Platform-wide list of every agent. Preview or regenerate the generated system prompt.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{loading ? "Loading…" : `${rows.length} agent${rows.length === 1 ? "" : "s"}`}</CardTitle>
        </CardHeader>
        <CardContent>
          {!loading && rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No agents yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground border-b border-border">
                <tr>
                  <th className="py-2 pr-3">ID</th>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Company</th>
                  <th className="py-2 pr-3">Owner</th>
                  <th className="py-2 pr-3">Tpl Ver</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Created</th>
                  <th className="py-2 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/50">
                    <td className="py-2 pr-3 font-mono">{r.id}</td>
                    <td className="py-2 pr-3">{r.name}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{r.company ?? "—"}</td>
                    <td className="py-2 pr-3 text-muted-foreground truncate max-w-[160px]">{r.ownerUserId ?? "—"}</td>
                    <td className="py-2 pr-3">
                      {r.promptTemplateVersion != null ? `v${r.promptTemplateVersion}` : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge variant={r.status === "active" ? "default" : "outline"}>{r.status}</Badge>
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">{new Date(r.createdAt).toLocaleDateString()}</td>
                    <td className="py-2 space-x-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => viewPrompt(r.id)}>Preview</Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!r.hasWizardInputs || regenId === r.id}
                        onClick={() => regenerate(r.id)}
                        title={r.hasWizardInputs ? "" : "No wizard inputs stored for this agent"}
                      >
                        {regenId === r.id ? "Regenerating…" : "Regenerate"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {detail && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>#{detail.id} — {detail.name} {detail.promptTemplateVersion != null && <Badge className="ml-2">v{detail.promptTemplateVersion}</Badge>}</span>
              <Button size="sm" variant="ghost" onClick={() => setDetail(null)}>Close</Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <section>
              <h3 className="text-sm font-semibold mb-2">Generated Prompt (used at call time)</h3>
              {detail.generatedPrompt ? (
                <pre className="text-xs whitespace-pre-wrap bg-muted p-3 rounded max-h-72 overflow-y-auto">{detail.generatedPrompt}</pre>
              ) : (
                <p className="text-xs text-muted-foreground">No generated prompt — falls back to the dashboard call-flow prompt below.</p>
              )}
            </section>
            <section>
              <h3 className="text-sm font-semibold mb-2">Dashboard System Prompt (user-facing call flow)</h3>
              <pre className="text-xs whitespace-pre-wrap bg-muted/50 p-3 rounded max-h-48 overflow-y-auto">{detail.systemPrompt || "—"}</pre>
            </section>
            {detail.wizardInputs && (
              <section>
                <h3 className="text-sm font-semibold mb-2">Wizard Inputs</h3>
                <pre className="text-xs whitespace-pre-wrap bg-muted/50 p-3 rounded max-h-48 overflow-y-auto">{JSON.stringify(detail.wizardInputs, null, 2)}</pre>
              </section>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
