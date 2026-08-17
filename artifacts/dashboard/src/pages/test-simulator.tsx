import { useState, useRef, useEffect } from "react";
import { useListAgents, useRunToolTest } from "@workspace/api-client-react";
import type { Agent } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { FlaskConical, Copy, Check, Loader2, Play } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

type SchedulingToolType =
  | "native_check_availability"
  | "native_booking"
  | "native_list_bookings"
  | "native_cancel"
  | "native_reschedule";

interface AgentTool {
  type: string;
  name: string;
  description?: string;
}

interface RunEntry {
  id: string;
  toolName: string;
  toolType: string;
  timestamp: string;
  result: string;
}

const SCHEDULING_TYPES: SchedulingToolType[] = [
  "native_check_availability",
  "native_booking",
  "native_list_bookings",
  "native_cancel",
  "native_reschedule",
];

function toolTypeLabel(type: string): string {
  switch (type) {
    case "native_check_availability": return "Check Availability";
    case "native_booking":            return "Book Appointment";
    case "native_list_bookings":      return "List Bookings";
    case "native_cancel":             return "Cancel Booking";
    case "native_reschedule":         return "Reschedule";
    default:                          return type;
  }
}

// ── Parameter form ────────────────────────────────────────────────────────────

interface ParamFormProps {
  toolType: SchedulingToolType;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}

function ParamForm({ toolType, values, onChange }: ParamFormProps) {
  const field = (key: string, label: string, placeholder?: string, required = false) => (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <Input
        value={values[key] ?? ""}
        onChange={(e) => onChange(key, e.target.value)}
        placeholder={placeholder}
        className="h-8 text-sm font-mono"
      />
    </div>
  );

  if (toolType === "native_check_availability") {
    return (
      <div className="space-y-3">
        {field("preferred_date", "preferred_date", "e.g. next Tuesday, 2026-06-10, tomorrow morning")}
        {field("timezone", "timezone", "e.g. America/New_York, Asia/Kolkata")}
      </div>
    );
  }

  if (toolType === "native_booking") {
    const meetingType = values["meeting_type"] ?? "";
    return (
      <div className="space-y-3">
        {field("attendee_name", "attendee_name", "Full name", true)}
        {field("attendee_email", "attendee_email", "email@example.com", true)}
        {field("preferred_date", "preferred_date", "e.g. next Tuesday, 2026-06-10T14:00")}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">meeting_type</Label>
          <Select value={meetingType || "google_meet"} onValueChange={(v) => onChange("meeting_type", v)}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="google_meet">google_meet</SelectItem>
              <SelectItem value="in_person">in_person</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {meetingType === "in_person" && field("meeting_address", "meeting_address", "123 Main St, City, State", true)}
      </div>
    );
  }

  if (toolType === "native_list_bookings") {
    return (
      <div className="space-y-3">
        {field("attendee_name", "attendee_name", "Full name", true)}
        {field("timezone", "timezone", "e.g. America/New_York, Asia/Kolkata")}
      </div>
    );
  }

  if (toolType === "native_cancel") {
    return (
      <div className="space-y-3">
        {field("booking_id", "booking_id", "e.g. 42", true)}
      </div>
    );
  }

  if (toolType === "native_reschedule") {
    return (
      <div className="space-y-3">
        {field("booking_id", "booking_id", "e.g. 42", true)}
        {field("preferred_date", "preferred_date", "e.g. next Tuesday, 2026-06-15T10:00")}
        {field("timezone", "timezone", "e.g. America/New_York, Asia/Kolkata")}
      </div>
    );
  }

  return null;
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ── Run entry card ────────────────────────────────────────────────────────────

function RunCard({ entry }: { entry: RunEntry }) {
  const isError = entry.result.startsWith("error:");
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-elevated">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={`text-[10px] font-mono px-1.5 py-0 ${isError ? "border-destructive/40 text-destructive" : "border-border text-muted-foreground"}`}
          >
            {entry.toolName}
          </Badge>
          <span className="text-[11px] text-muted-foreground/60">{entry.toolType}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground/50 font-mono">{entry.timestamp}</span>
          <CopyButton text={entry.result} />
        </div>
      </div>
      <pre className="p-3 text-[12px] font-mono leading-relaxed whitespace-pre-wrap break-all overflow-x-auto max-h-48 text-foreground/90">
        {entry.result}
      </pre>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function ToolTestSimulator({
  lockedAgentId,
  embedded = false,
}: {
  lockedAgentId?: number;
  embedded?: boolean;
}) {
  const { data: agents = [], isLoading: agentsLoading } = useListAgents();
  const { mutateAsync: runToolTest, isPending } = useRunToolTest();

  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(lockedAgentId ?? null);
  const [selectedToolName, setSelectedToolName] = useState<string | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});
  const [runs, setRuns] = useState<RunEntry[]>([]);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (lockedAgentId != null) setSelectedAgentId(lockedAgentId);
  }, [lockedAgentId]);

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) ?? null;

  const schedulingTools = (selectedAgent?.tools ?? []).filter((t: AgentTool) =>
    SCHEDULING_TYPES.includes(t.type as SchedulingToolType),
  );

  const selectedTool = schedulingTools.find((t: AgentTool) => t.name === selectedToolName) ?? null;
  const selectedToolType = selectedTool?.type as SchedulingToolType | null;

  function handleAgentChange(id: string) {
    setSelectedAgentId(Number(id));
    setSelectedToolName(null);
    setParams({});
  }

  function handleToolChange(name: string) {
    setSelectedToolName(name);
    setParams({});
  }

  function handleParamChange(key: string, value: string) {
    setParams((p) => ({ ...p, [key]: value }));
  }

  async function handleRun() {
    if (!selectedAgentId || !selectedToolName || !selectedToolType) return;

    const args: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v.trim() !== "") args[k] = v.trim();
    }

    const now = new Date();
    const timestamp = now.toLocaleTimeString("en-US", { hour12: false }) + "." + String(now.getMilliseconds()).padStart(3, "0");

    let result: string;
    try {
      const resp = await runToolTest({ data: { agentId: selectedAgentId, toolName: selectedToolName, args } });
      result = resp.result;
    } catch (err: unknown) {
      const anyErr = err as { response?: { data?: { error?: string } }; message?: string };
      result = `error: ${anyErr?.response?.data?.error ?? anyErr?.message ?? "request failed"}`;
    }

    const entry: RunEntry = {
      id: `${Date.now()}-${Math.random()}`,
      toolName: selectedToolName,
      toolType: toolTypeLabel(selectedToolType),
      timestamp,
      result,
    };

    setRuns((prev) => [entry, ...prev].slice(0, 10));
    setTimeout(() => outputRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
  }

  const allAgents = agents as Agent[];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {!embedded && (
      <div className="px-6 py-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5">
          <FlaskConical className="w-4 h-4 text-muted-foreground/60" />
          <div>
            <h1 className="text-[15px] font-semibold text-foreground leading-tight">Test Simulator</h1>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Fire scheduling tool calls manually — see exactly what the LLM would receive
            </p>
          </div>
        </div>
      </div>
      )}

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
          {/* Agent + Tool selectors */}
          <div className="space-y-4">
            {lockedAgentId == null && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Agent</Label>
              {agentsLoading ? (
                <div className="h-9 rounded-md border border-border bg-elevated animate-pulse" />
              ) : (
                <Select value={selectedAgentId?.toString() ?? ""} onValueChange={handleAgentChange}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select an agent…" />
                  </SelectTrigger>
                  <SelectContent>
                    {allAgents.map((a) => (
                      <SelectItem key={a.id} value={a.id.toString()}>
                        <span className="flex items-center gap-2">
                          {a.name}
                          {schedulingTools.length === 0 && selectedAgentId === a.id && (
                            <span className="text-[10px] text-muted-foreground/60">(no scheduling tools)</span>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            )}

            {selectedAgent && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                  Tool
                  {schedulingTools.length === 0 && (
                    <span className="ml-2 text-muted-foreground/50 normal-case">— no scheduling tools on this agent</span>
                  )}
                </Label>
                <Select
                  value={selectedToolName ?? ""}
                  onValueChange={handleToolChange}
                  disabled={schedulingTools.length === 0}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder={schedulingTools.length === 0 ? "No scheduling tools" : "Select a tool…"} />
                  </SelectTrigger>
                  <SelectContent>
                    {schedulingTools.map((t: AgentTool) => (
                      <SelectItem key={t.name} value={t.name}>
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-[12px]">{t.name}</span>
                          <span className="text-muted-foreground/60 text-[11px]">{toolTypeLabel(t.type)}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Parameter form */}
          {selectedTool && selectedToolType && (
            <div className="rounded-lg border border-border bg-card p-4 space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Parameters</span>
                <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0 text-muted-foreground border-border">
                  {toolTypeLabel(selectedToolType)}
                </Badge>
              </div>
              <ParamForm toolType={selectedToolType} values={params} onChange={handleParamChange} />
              <Button
                onClick={handleRun}
                disabled={isPending}
                size="sm"
                className="gap-1.5"
              >
                {isPending ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Running…
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    Run
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Run history */}
          {runs.length > 0 && (
            <div className="space-y-3" ref={outputRef}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Run History ({runs.length})
                </span>
                <button
                  onClick={() => setRuns([])}
                  className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                >
                  Clear
                </button>
              </div>
              <div className="space-y-2">
                {runs.map((entry) => (
                  <RunCard key={entry.id} entry={entry} />
                ))}
              </div>
            </div>
          )}

          {/* Empty state when no runs yet */}
          {runs.length === 0 && selectedTool && (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <FlaskConical className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground/50">Hit <strong className="text-muted-foreground/70">Run</strong> to fire the tool and see the raw response here</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TestSimulatorPage() {
  return <ToolTestSimulator />;
}
