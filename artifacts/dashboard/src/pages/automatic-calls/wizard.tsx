/**
 * Automatic Calls wizard — connect (if needed) → sheet → map → agent → modes → create + start.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch, useListAgents, useListPhoneNumbers } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/brand-logos";

const API = "/api";

type SheetsConn = { id: string; email: string };
type Spreadsheet = { id: string; name: string };
type Tab = { sheetId: number; title: string };

type Step = "connect" | "sheet" | "map" | "agent" | "modes";

export default function AutomaticCallsWizardPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();

  const connectionsQ = useQuery({
    queryKey: ["sheets-connections"],
    queryFn: () => customFetch<SheetsConn[]>(`${API}/sheets/google/connections`),
  });
  const { data: agents } = useListAgents();
  const { data: phoneNumbers } = useListPhoneNumbers();

  const connections = connectionsQ.data ?? [];
  const connected = connections.length > 0;

  const [step, setStep] = useState<Step>("connect");
  const [name, setName] = useState("Sheet auto dial");
  const [connectionId, setConnectionId] = useState("");
  const [mode, setMode] = useState<"existing" | "create">("existing");
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [spreadsheetTitle, setSpreadsheetTitle] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [sheetGid, setSheetGid] = useState<number | null>(null);
  const [createTitle, setCreateTitle] = useState("");
  const [phoneCol, setPhoneCol] = useState("Phone");
  const [nameCol, setNameCol] = useState("Name");
  const [emailCol, setEmailCol] = useState("Email");
  const [agentId, setAgentId] = useState<number | null>(null);
  const [fromNumber, setFromNumber] = useState<string | null>(null);
  const [startMode, setStartMode] = useState<"new_only" | "backfill_then_watch">("new_only");
  const [writebackMode, setWritebackMode] = useState<"same_sheet" | "call_log" | "both">("same_sheet");
  const [createCallLogSheet, setCreateCallLogSheet] = useState(false);

  useEffect(() => {
    if (connected && step === "connect") setStep("sheet");
  }, [connected, step]);

  useEffect(() => {
    if (!connectionId && connections[0]) setConnectionId(connections[0].id);
  }, [connections, connectionId]);

  const spreadsheetsQ = useQuery({
    queryKey: ["sheets-spreadsheets", connectionId],
    queryFn: () => customFetch<Spreadsheet[]>(`${API}/sheets/google/connections/${connectionId}/spreadsheets`),
    enabled: !!connectionId && mode === "existing" && step === "sheet",
  });

  const tabsQ = useQuery({
    queryKey: ["sheets-tabs", connectionId, spreadsheetId],
    queryFn: () => customFetch<Tab[]>(`${API}/sheets/google/connections/${connectionId}/spreadsheets/${spreadsheetId}/tabs`),
    enabled: !!connectionId && !!spreadsheetId && mode === "existing",
  });

  const headersQ = useQuery({
    queryKey: ["sheets-headers", connectionId, spreadsheetId, sheetName],
    queryFn: () =>
      customFetch<{ headers: string[]; rowCount: number }>(
        `${API}/sheets/google/connections/${connectionId}/spreadsheets/${spreadsheetId}/headers?sheetName=${encodeURIComponent(sheetName)}`,
      ),
    enabled: !!connectionId && !!spreadsheetId && !!sheetName && step === "map",
  });

  useEffect(() => {
    const tabs = tabsQ.data ?? [];
    if (tabs[0] && !sheetName) {
      setSheetName(tabs[0].title);
      setSheetGid(tabs[0].sheetId);
    }
  }, [tabsQ.data, sheetName]);

  useEffect(() => {
    const headers = headersQ.data?.headers ?? [];
    if (headers.length === 0) return;
    const find = (re: RegExp) => headers.find((h) => re.test(h)) ?? "";
    if (!headers.includes(phoneCol)) {
      const p = find(/phone|mobile|whatsapp|contact/i) || headers[0] || "Phone";
      setPhoneCol(p);
    }
    if (!headers.includes(nameCol)) {
      const n = find(/^name$|customer|caller|contact.?name/i) || "Name";
      if (headers.includes(n) || n === "Name") setNameCol(n);
    }
    if (!headers.includes(emailCol)) {
      const e = find(/email/i) || "Email";
      if (headers.includes(e) || e === "Email") setEmailCol(e);
    }
  }, [headersQ.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const steps: Step[] = useMemo(
    () => (connected ? ["sheet", "map", "agent", "modes"] : ["connect", "sheet", "map", "agent", "modes"]),
    [connected],
  );

  const stepIdx = steps.indexOf(step);

  const connectGoogle = async () => {
    try {
      const { url } = await customFetch<{ url: string }>(
        `${API}/sheets/google/connect-url?returnTo=automatic-calls&returnOrigin=${encodeURIComponent(window.location.origin)}`,
      );
      window.open(url, "_blank", "noopener,width=520,height=720");
      const onFocus = () => {
        window.removeEventListener("focus", onFocus);
        void qc.invalidateQueries({ queryKey: ["sheets-connections"] });
      };
      window.addEventListener("focus", onFocus);
    } catch (err: any) {
      toast({ title: "Could not start Google connect", description: err?.message, variant: "destructive" });
    }
  };

  const createMut = useMutation({
    mutationFn: async () => {
      if (!connectionId || !agentId || !phoneCol) throw new Error("Missing required fields");

      let sid = spreadsheetId;
      let stitle = spreadsheetTitle;
      let sname = sheetName;
      let sgid = sheetGid;

      if (mode === "create") {
        const created = await customFetch<{
          spreadsheetId: string; spreadsheetTitle: string; sheetName: string; sheetGid: number | null;
        }>(`${API}/sheets/google/connections/${connectionId}/spreadsheets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: createTitle.trim() || name.trim() || "SnapServe Leads",
            template: "lead_pipeline",
          }),
        });
        sid = created.spreadsheetId;
        stitle = created.spreadsheetTitle;
        sname = created.sheetName;
        sgid = created.sheetGid;
      }

      if (!sid || !sname) throw new Error("Pick a spreadsheet and tab");

      const pipeline = await customFetch<{ id: string }>(`${API}/automatic-calls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || "Automatic Calls",
          connectionId,
          agentId,
          spreadsheetId: sid,
          spreadsheetTitle: stitle,
          sheetName: sname,
          sheetGid: sgid,
          columnMap: {
            phone: phoneCol,
            ...(nameCol && nameCol !== "__none" ? { name: nameCol } : {}),
            ...(emailCol && emailCol !== "__none" ? { email: emailCol } : {}),
          },
          startMode,
          writebackMode,
          fromNumber,
          createCallLogSheet: writebackMode !== "same_sheet" ? createCallLogSheet : false,
        }),
      });

      await customFetch(`${API}/automatic-calls/${pipeline.id}/start`, { method: "POST" });
      return pipeline;
    },
    onSuccess: (pipeline) => {
      toast({ title: "Automatic Calls started" });
      void qc.invalidateQueries({ queryKey: ["automatic-calls"] });
      setLocation(`/app/automatic-calls/${pipeline.id}`);
    },
    onError: (err: any) => {
      toast({ title: "Failed to start", description: err?.message ?? String(err), variant: "destructive" });
    },
  });

  const canNext = (): boolean => {
    if (step === "connect") return connected;
    if (step === "sheet") {
      if (mode === "create") return !!connectionId;
      return !!connectionId && !!spreadsheetId && !!sheetName;
    }
    if (step === "map") return !!phoneCol.trim();
    if (step === "agent") return !!agentId;
    if (step === "modes") return true;
    return false;
  };

  const goNext = () => {
    const i = steps.indexOf(step);
    if (i < steps.length - 1) setStep(steps[i + 1]!);
  };
  const goBack = () => {
    const i = steps.indexOf(step);
    if (i > 0) setStep(steps[i - 1]!);
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild className="h-8 px-2">
          <Link href="/app/automatic-calls"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">Create Automatic Calls</h1>
          <p className="text-xs text-muted-foreground">Sheet → dial with lookup vars → write results back</p>
        </div>
      </div>

      <div className="flex gap-1.5">
        {steps.map((s, i) => (
          <div
            key={s}
            className={cn(
              "h-1 flex-1 rounded-full",
              i <= stepIdx ? "bg-foreground/80" : "bg-muted",
            )}
          />
        ))}
      </div>

      <div className="rounded-xl border border-border/60 bg-card/40 p-5 space-y-4">
        {step === "connect" && (
          <div className="space-y-3 text-center py-4">
            <div className="mx-auto h-10 w-10 rounded-lg bg-muted/50 flex items-center justify-center">
              <BrandLogo brand="googleSheets" size={20} />
            </div>
            <p className="text-sm font-medium">Connect Google Sheets</p>
            <p className="text-xs text-muted-foreground">Required once. We use it to read leads and write call results.</p>
            <Button type="button" onClick={() => void connectGoogle()}>Connect Google Sheets</Button>
          </div>
        )}

        {step === "sheet" && (
          <div className="space-y-4">
            {connected && (
              <p className="text-[11px] text-muted-foreground">
                Connected as {connections.find((c) => c.id === connectionId)?.email ?? "Google"}
              </p>
            )}
            <div>
              <label className="text-xs font-medium">Pipeline name</label>
              <Input className="mt-1 h-9" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            {connections.length > 1 && (
              <div>
                <label className="text-xs font-medium">Google account</label>
                <Select value={connectionId} onValueChange={setConnectionId}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {connections.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={mode === "existing" ? "default" : "outline"} className="h-8 text-xs" onClick={() => setMode("existing")}>
                Use existing sheet
              </Button>
              <Button type="button" size="sm" variant={mode === "create" ? "default" : "outline"} className="h-8 text-xs" onClick={() => setMode("create")}>
                Create new sheet
              </Button>
            </div>
            {mode === "existing" ? (
              <>
                <div>
                  <label className="text-xs font-medium">Spreadsheet</label>
                  <Select
                    value={spreadsheetId}
                    onValueChange={(v) => {
                      setSpreadsheetId(v);
                      setSpreadsheetTitle(spreadsheetsQ.data?.find((s) => s.id === v)?.name ?? "");
                      setSheetName("");
                    }}
                  >
                    <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Pick a spreadsheet" /></SelectTrigger>
                    <SelectContent>
                      {(spreadsheetsQ.data ?? []).map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {spreadsheetId && (
                  <div>
                    <label className="text-xs font-medium">Tab</label>
                    <Select
                      value={sheetName}
                      onValueChange={(v) => {
                        setSheetName(v);
                        setSheetGid(tabsQ.data?.find((t) => t.title === v)?.sheetId ?? null);
                      }}
                    >
                      <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Pick a tab" /></SelectTrigger>
                      <SelectContent>
                        {(tabsQ.data ?? []).map((t) => (
                          <SelectItem key={t.sheetId} value={t.title}>{t.title}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
            ) : (
              <div>
                <label className="text-xs font-medium">New spreadsheet title</label>
                <Input
                  className="mt-1 h-9"
                  placeholder="My leads"
                  value={createTitle}
                  onChange={(e) => setCreateTitle(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground mt-1">Creates a Leads tab with Phone, Name, Email, Status…</p>
              </div>
            )}
          </div>
        )}

        {step === "map" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Map sheet columns. Phone is required. Long names and cells with two numbers are supported.
            </p>
            {headersQ.isLoading && <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Reading headers…</p>}
            {(["phone", "name", "email"] as const).map((field) => {
              const value = field === "phone" ? phoneCol : field === "name" ? nameCol : emailCol;
              const set = field === "phone" ? setPhoneCol : field === "name" ? setNameCol : setEmailCol;
              const headers = headersQ.data?.headers ?? [];
              return (
                <div key={field}>
                  <label className="text-xs font-medium capitalize">{field}{field === "phone" ? " *" : ""}</label>
                  {headers.length > 0 ? (
                    <Select value={value} onValueChange={set}>
                      <SelectTrigger className="mt-1 h-9"><SelectValue placeholder={`Select ${field} column`} /></SelectTrigger>
                      <SelectContent>
                        {field !== "phone" && <SelectItem value="__none">— none —</SelectItem>}
                        {headers.map((h) => (
                          <SelectItem key={h} value={h}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input className="mt-1 h-9" value={value} onChange={(e) => set(e.target.value)} placeholder={field === "phone" ? "Phone" : field === "name" ? "Name" : "Email"} />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {step === "agent" && (
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">Agent *</label>
              <Select value={agentId ? String(agentId) : ""} onValueChange={(v) => setAgentId(Number(v))}>
                <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Select agent" /></SelectTrigger>
                <SelectContent>
                  {(agents ?? []).map((a: { id: number; name: string }) => (
                    <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium">From number</label>
              <Select value={fromNumber ?? ""} onValueChange={(v) => setFromNumber(v || null)}>
                <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  {(phoneNumbers ?? []).map((pn: { id: number; number: string }) => (
                    <SelectItem key={pn.id} value={pn.number}>{pn.number}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {step === "modes" && (
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-xs font-medium">When you start</p>
              <label className={cn("flex gap-3 rounded-lg border px-3 py-2.5 cursor-pointer", startMode === "new_only" && "border-foreground/40 bg-muted/30")}>
                <input type="radio" className="mt-1" checked={startMode === "new_only"} onChange={() => setStartMode("new_only")} />
                <span>
                  <span className="text-sm font-medium block">New rows only</span>
                  <span className="text-[11px] text-muted-foreground">Ignore existing rows; dial only leads added after Start.</span>
                </span>
              </label>
              <label className={cn("flex gap-3 rounded-lg border px-3 py-2.5 cursor-pointer", startMode === "backfill_then_watch" && "border-foreground/40 bg-muted/30")}>
                <input type="radio" className="mt-1" checked={startMode === "backfill_then_watch"} onChange={() => setStartMode("backfill_then_watch")} />
                <span>
                  <span className="text-sm font-medium block">Backfill then watch</span>
                  <span className="text-[11px] text-muted-foreground">Dial all existing uncalled rows, then keep watching for new ones.</span>
                </span>
              </label>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium">Write call results to</p>
              {([
                ["same_sheet", "Same sheet", "Update Status / Summary / Disposition on the lead row"],
                ["call_log", "Call Log", "Append one row per call to a Call Log tab/sheet"],
                ["both", "Both", "Update the lead row and append to Call Log"],
              ] as const).map(([v, title, desc]) => (
                <label key={v} className={cn("flex gap-3 rounded-lg border px-3 py-2.5 cursor-pointer", writebackMode === v && "border-foreground/40 bg-muted/30")}>
                  <input type="radio" className="mt-1" checked={writebackMode === v} onChange={() => setWritebackMode(v)} />
                  <span>
                    <span className="text-sm font-medium block">{title}</span>
                    <span className="text-[11px] text-muted-foreground">{desc}</span>
                  </span>
                </label>
              ))}
              {writebackMode !== "same_sheet" && (
                <label className="flex items-center gap-2 text-xs pt-1">
                  <input type="checkbox" checked={createCallLogSheet} onChange={(e) => setCreateCallLogSheet(e.target.checked)} />
                  Create a separate Call Log spreadsheet (otherwise uses a Call Log tab on the same file)
                </label>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-between">
        <Button type="button" variant="outline" size="sm" onClick={goBack} disabled={stepIdx <= 0}>
          Back
        </Button>
        {step !== "modes" ? (
          <Button type="button" size="sm" onClick={goNext} disabled={!canNext()}>
            Next <ArrowRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              if (nameCol === "__none") setNameCol("");
              if (emailCol === "__none") setEmailCol("");
              createMut.mutate();
            }}
            disabled={createMut.isPending || !canNext()}
          >
            {createMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Check className="h-3.5 w-3.5 mr-1" />}
            Create & Start
          </Button>
        )}
      </div>
    </div>
  );
}
