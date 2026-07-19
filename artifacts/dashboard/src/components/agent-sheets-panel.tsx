/**
 * Agent → Google Sheets bindings (Phase 01).
 * Connect account, pick/create spreadsheet + tab, attach many sheets per agent.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { BrandLogo } from "@/components/brand-logos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, Trash2, ExternalLink, FileSpreadsheet } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const API = "/api";

type SheetsConn = { id: string; email: string; createdAt: string };
type Spreadsheet = { id: string; name: string };
type Tab = { sheetId: number; title: string };
type Binding = {
  id: string;
  label: string;
  useCase: string;
  spreadsheetId: string;
  spreadsheetTitle: string | null;
  sheetName: string;
  enabled: boolean;
  connectionId: string;
  connectionEmail: string | null;
};

const USE_CASE_LABELS: Record<string, string> = {
  lookup: "Lookup (during call)",
  call_log: "Call log (after call)",
  outcome: "Outcomes / pipeline",
  custom: "Custom",
};

export function AgentSheetsPanel({ agentId }: { agentId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [connectionId, setConnectionId] = useState("");
  const [mode, setMode] = useState<"existing" | "create">("existing");
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [sheetGid, setSheetGid] = useState<number | null>(null);
  const [label, setLabel] = useState("");
  const [useCase, setUseCase] = useState("call_log");
  const [createTitle, setCreateTitle] = useState("");
  const [createTemplate, setCreateTemplate] = useState<"blank" | "call_log" | "lead_pipeline">("call_log");

  const connectionsQ = useQuery({
    queryKey: ["sheets-connections"],
    queryFn: () => customFetch<SheetsConn[]>(`${API}/sheets/google/connections`),
  });
  const bindingsQ = useQuery({
    queryKey: ["agent-sheets", agentId],
    queryFn: () => customFetch<Binding[]>(`${API}/agents/${agentId}/sheets`),
  });
  const spreadsheetsQ = useQuery({
    queryKey: ["sheets-spreadsheets", connectionId],
    queryFn: () => customFetch<Spreadsheet[]>(`${API}/sheets/google/connections/${connectionId}/spreadsheets`),
    enabled: !!connectionId && adding && mode === "existing",
  });
  const tabsQ = useQuery({
    queryKey: ["sheets-tabs", connectionId, spreadsheetId],
    queryFn: () => customFetch<Tab[]>(`${API}/sheets/google/connections/${connectionId}/spreadsheets/${spreadsheetId}/tabs`),
    enabled: !!connectionId && !!spreadsheetId && adding && mode === "existing",
  });

  useEffect(() => {
    const conns = connectionsQ.data ?? [];
    if (!connectionId && conns[0]) setConnectionId(conns[0].id);
  }, [connectionsQ.data, connectionId]);

  useEffect(() => {
    const tabs = tabsQ.data ?? [];
    if (tabs[0] && !sheetName) {
      setSheetName(tabs[0].title);
      setSheetGid(tabs[0].sheetId);
    }
  }, [tabsQ.data, sheetName]);

  const selectedSheetTitle = useMemo(
    () => (spreadsheetsQ.data ?? []).find((s) => s.id === spreadsheetId)?.name,
    [spreadsheetsQ.data, spreadsheetId],
  );

  const connectGoogle = async () => {
    try {
      const { url } = await customFetch<{ url: string }>(
        `${API}/sheets/google/connect-url?returnTo=agent&returnOrigin=${encodeURIComponent(window.location.origin)}`,
      );
      window.open(url, "_blank", "noopener,width=520,height=720");
      const onFocus = () => {
        window.removeEventListener("focus", onFocus);
        void qc.invalidateQueries({ queryKey: ["sheets-connections"] });
      };
      window.addEventListener("focus", onFocus);
    } catch (err: any) {
      toast({ title: "Could not start Google connect", description: err?.message ?? String(err), variant: "destructive" });
    }
  };

  const createMut = useMutation({
    mutationFn: async () => {
      if (!connectionId) throw new Error("Connect a Google account first");
      let sid = spreadsheetId;
      let stitle = selectedSheetTitle;
      let sname = sheetName;
      let sgid = sheetGid;

      if (mode === "create") {
        const title = createTitle.trim() || `SnapServe — Agent ${agentId}`;
        const created = await customFetch<{
          spreadsheetId: string; spreadsheetTitle: string; sheetName: string; sheetGid: number | null;
        }>(`${API}/sheets/google/connections/${connectionId}/spreadsheets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, template: createTemplate }),
        });
        sid = created.spreadsheetId;
        stitle = created.spreadsheetTitle;
        sname = created.sheetName;
        sgid = created.sheetGid;
      }

      if (!sid || !sname) throw new Error("Pick a spreadsheet and tab");
      return customFetch(`${API}/agents/${agentId}/sheets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId,
          label: label.trim() || USE_CASE_LABELS[useCase] || "Sheet",
          useCase,
          spreadsheetId: sid,
          spreadsheetTitle: stitle,
          sheetName: sname,
          sheetGid: sgid,
          matchColumn: useCase === "lookup" || useCase === "outcome" ? "Phone" : null,
        }),
      });
    },
    onSuccess: () => {
      toast({ title: "Sheet connected to agent" });
      setAdding(false);
      setSpreadsheetId("");
      setSheetName("");
      setLabel("");
      void qc.invalidateQueries({ queryKey: ["agent-sheets", agentId] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to add sheet", description: err?.message ?? String(err), variant: "destructive" });
    },
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      customFetch(`${API}/agents/${agentId}/sheets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["agent-sheets", agentId] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) =>
      customFetch(`${API}/agents/${agentId}/sheets/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Sheet unlinked" });
      void qc.invalidateQueries({ queryKey: ["agent-sheets", agentId] });
    },
  });

  const connections = connectionsQ.data ?? [];
  const bindings = bindingsQ.data ?? [];

  return (
    <div className="rounded-xl border border-border/70 bg-card/40 overflow-hidden">
      <div className="p-4 flex items-start gap-3 border-b border-border/50">
        <div className="mt-0.5 h-8 w-8 rounded-lg flex items-center justify-center shrink-0 bg-muted/40">
          <BrandLogo brand="googleSheets" size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Google Sheets</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Connect multiple sheets for different use cases — lookup, call log, outcomes.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 text-xs shrink-0"
          onClick={() => setAdding((v) => !v)}
          disabled={!agentId}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add sheet
        </Button>
      </div>

      <div className="p-4 space-y-3">
        {connections.length === 0 && (
          <div className="rounded-lg border border-dashed border-border/60 px-4 py-5 text-center space-y-2">
            <p className="text-xs text-muted-foreground">No Google account connected for Sheets yet.</p>
            <Button type="button" size="sm" className="h-8 text-xs" onClick={() => void connectGoogle()}>
              Connect Google Sheets
            </Button>
          </div>
        )}

        {bindings.map((b) => (
          <div key={b.id} className="rounded-lg border border-border/50 bg-background/40 px-3 py-2.5 flex items-center gap-3">
            <FileSpreadsheet className="h-4 w-4 text-emerald-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{b.label}</p>
              <p className="text-[11px] text-muted-foreground truncate">
                {USE_CASE_LABELS[b.useCase] ?? b.useCase} · {b.spreadsheetTitle || b.spreadsheetId} · {b.sheetName}
                {b.connectionEmail ? ` · ${b.connectionEmail}` : ""}
              </p>
            </div>
            <a
              href={`https://docs.google.com/spreadsheets/d/${b.spreadsheetId}`}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground"
              title="Open in Google Sheets"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <Switch
              checked={b.enabled}
              onCheckedChange={(v) => toggleMut.mutate({ id: b.id, enabled: v })}
            />
            <button
              type="button"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => deleteMut.mutate(b.id)}
              title="Remove"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}

        {bindings.length === 0 && connections.length > 0 && !adding && (
          <p className="text-xs text-muted-foreground">No sheets linked yet. Add one for lookup or call logging.</p>
        )}

        {adding && (
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">New binding</p>
              {connections.length > 0 && (
                <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground underline" onClick={() => void connectGoogle()}>
                  Connect another Google account
                </button>
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-[11px] text-muted-foreground">Google account</p>
                <Select value={connectionId} onValueChange={(v) => { setConnectionId(v); setSpreadsheetId(""); setSheetName(""); }}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select account" /></SelectTrigger>
                  <SelectContent>
                    {connections.map((c) => (
                      <SelectItem key={c.id} value={c.id} className="text-xs">{c.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <p className="text-[11px] text-muted-foreground">Use case</p>
                <Select value={useCase} onValueChange={setUseCase}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(USE_CASE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                className={cn("flex-1 h-8 rounded-md text-xs border", mode === "existing" ? "bg-background border-foreground/30" : "border-border/50 text-muted-foreground")}
                onClick={() => setMode("existing")}
              >
                Use existing sheet
              </button>
              <button
                type="button"
                className={cn("flex-1 h-8 rounded-md text-xs border", mode === "create" ? "bg-background border-foreground/30" : "border-border/50 text-muted-foreground")}
                onClick={() => setMode("create")}
              >
                Create new sheet
              </button>
            </div>

            {mode === "existing" ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1 sm:col-span-2">
                  <p className="text-[11px] text-muted-foreground">Spreadsheet</p>
                  <Select value={spreadsheetId || undefined} onValueChange={(v) => { setSpreadsheetId(v); setSheetName(""); setSheetGid(null); }}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder={spreadsheetsQ.isLoading ? "Loading…" : "Pick a spreadsheet"} />
                    </SelectTrigger>
                    <SelectContent>
                      {(spreadsheetsQ.data ?? []).map((s) => (
                        <SelectItem key={s.id} value={s.id} className="text-xs">{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <p className="text-[11px] text-muted-foreground">Tab</p>
                  <Select
                    value={sheetName || undefined}
                    onValueChange={(v) => {
                      setSheetName(v);
                      const tab = (tabsQ.data ?? []).find((t) => t.title === v);
                      setSheetGid(tab?.sheetId ?? null);
                    }}
                    disabled={!spreadsheetId}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder={tabsQ.isLoading ? "Loading…" : "Pick a tab"} />
                    </SelectTrigger>
                    <SelectContent>
                      {(tabsQ.data ?? []).map((t) => (
                        <SelectItem key={t.sheetId} value={t.title} className="text-xs">{t.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1 sm:col-span-2">
                  <p className="text-[11px] text-muted-foreground">New spreadsheet title</p>
                  <Input
                    className="h-8 text-xs"
                    placeholder="SnapServe — Call Log"
                    value={createTitle}
                    onChange={(e) => setCreateTitle(e.target.value)}
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <p className="text-[11px] text-muted-foreground">Template</p>
                  <Select value={createTemplate} onValueChange={(v) => setCreateTemplate(v as typeof createTemplate)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="call_log" className="text-xs">Call Log (headers ready)</SelectItem>
                      <SelectItem value="lead_pipeline" className="text-xs">Lead Pipeline</SelectItem>
                      <SelectItem value="blank" className="text-xs">Blank</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground">Label on this agent</p>
              <Input
                className="h-8 text-xs"
                placeholder={USE_CASE_LABELS[useCase] ?? "My sheet"}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 text-xs"
                disabled={createMut.isPending || !connectionId}
                onClick={() => createMut.mutate()}
              >
                {createMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                Save binding
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
