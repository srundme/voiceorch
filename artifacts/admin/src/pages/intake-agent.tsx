/**
 * Candidate Intake Agent — the demo control panel.
 *
 * Only five things are adjustable here (name, LLM, TTS provider, voice, speed)
 * plus the inbound number. Everything else about the agent is fixed server-side
 * so a demo cannot be broken by a stray setting.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, formatAdminError } from "@/lib/api";
import { ExternalLink, FileJson, Loader2, Phone, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { Link } from "wouter";

type ModelChoice = { value: string; label: string };

type TtsProvider = {
  value: string;
  label: string;
  model: string;
  voices: ModelChoice[];
  allowCustomVoice: boolean;
};

type PhoneNumber = {
  id: number;
  number: string;
  userId: string;
  ownerEmail?: string | null;
  provider: string;
  assignedAgentId: number | null;
  assignedAgentName: string | null;
};

type Options = {
  llm: Record<string, ModelChoice[]>;
  tts: TtsProvider[];
  speed: { min: number; max: number; step: number; default: number };
  defaults: Controls;
  locked: {
    asrProvider: string;
    asrModel: string;
    language: string;
    telephonyProvider: string;
    wordsForInterruption: number;
    callFeel?: string;
    backchannel?: string;
  };
  phoneNumbers: PhoneNumber[];
};

type Controls = {
  name: string;
  llmProvider: string;
  llmModel: string;
  ttsProvider: string;
  ttsVoice: string;
  ttsSpeed: number;
};

type IntakeAgent = Controls & {
  id: number;
  userId: string | null;
  ownerEmail: string | null;
  ttsVoiceLabel: string;
  ttsModel: string | null;
  asrProvider: string;
  asrLanguage: string | null;
  inboundNumber: { id: number; number: string } | null;
  createdAt: string;
};

type RecentCall = {
  id: number;
  status: string;
  fromNumber: string | null;
  toNumber: string | null;
  durationSeconds: number | null;
  executionId: string | null;
  createdAt: string | null;
};

type Session = {
  token: string;
  formUrl: string;
  status: string;
  callId: number | null;
  candidateName: string | null;
  phone: string | null;
  dispositionIds: string[];
  englishRating: string | null;
  missingCount: number;
  proposedCompany: string | null;
  revision: number;
  updatedAt: string;
};

type AdminUser = { clerkId: string; email: string | null };

const SESSION_POLL_MS = 3000;

export default function IntakeAgentPage() {
  const { toast } = useToast();
  const [options, setOptions] = useState<Options | null>(null);
  const [agents, setAgents] = useState<IntakeAgent[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Controls | null>(null);
  const [numberId, setNumberId] = useState<string>("none");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [calls, setCalls] = useState<RecentCall[]>([]);
  const [downloadingLog, setDownloadingLog] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newOwner, setNewOwner] = useState<string>("");
  const [forgetPhone, setForgetPhone] = useState("");
  const [forgetting, setForgetting] = useState<string | null>(null);

  const selected = useMemo(
    () => agents.find((a) => a.id === selectedId) ?? null,
    [agents, selectedId],
  );

  const load = useCallback(async () => {
    try {
      const [opts, list, userList] = await Promise.all([
        adminFetch<Options>("/intake-agents/options"),
        adminFetch<IntakeAgent[]>("/intake-agents"),
        adminFetch<AdminUser[]>("/users").catch(() => [] as AdminUser[]),
      ]);
      setOptions(opts);
      setAgents(list);
      setUsers(userList);
      setSelectedId((prev) => prev ?? list[0]?.id ?? null);
    } catch (err) {
      toast({ title: "Could not load intake agents", description: formatAdminError(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // Reset the editor whenever a different agent is picked.
  useEffect(() => {
    if (!selected) {
      setDraft(null);
      setNumberId("none");
      return;
    }
    setDraft({
      name: selected.name,
      llmProvider: selected.llmProvider,
      llmModel: selected.llmModel ?? "",
      ttsProvider: selected.ttsProvider,
      ttsVoice: selected.ttsVoice ?? "",
      ttsSpeed: selected.ttsSpeed,
    });
    setNumberId(selected.inboundNumber ? String(selected.inboundNumber.id) : "none");
  }, [selected]);

  // Live form list for the selected agent — this is what the demo audience watches.
  useEffect(() => {
    if (selectedId == null) {
      setSessions([]);
      setCalls([]);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const [formRows, callRows] = await Promise.all([
          adminFetch<Session[]>(`/intake-agents/${selectedId}/sessions`),
          adminFetch<RecentCall[]>(`/intake-agents/${selectedId}/calls`),
        ]);
        if (!cancelled) {
          setSessions(formRows);
          setCalls(callRows);
        }
      } catch {
        /* transient; the next tick retries */
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), SESSION_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selectedId]);

  const ttsSpec = useMemo(
    () => options?.tts.find((p) => p.value === draft?.ttsProvider) ?? null,
    [options, draft?.ttsProvider],
  );
  const ttsVoiceChoices = useMemo(() => {
    const voices = ttsSpec?.voices ?? [];
    if (!draft?.ttsVoice || voices.some((v) => v.value === draft.ttsVoice)) return voices;
    return [{ value: draft.ttsVoice, label: selected?.ttsVoiceLabel || draft.ttsVoice }, ...voices];
  }, [ttsSpec, draft?.ttsVoice, selected?.ttsVoiceLabel]);
  const llmModels = useMemo(
    () => (draft ? options?.llm[draft.llmProvider] ?? [] : []),
    [options, draft?.llmProvider],
  );

  /** Numbers free to take, or already on this agent. Same-account first. */
  const assignableNumbers = useMemo(() => {
    if (!options || !selected) return [];
    const rows = options.phoneNumbers.filter(
      (n) => n.assignedAgentId == null || n.assignedAgentId === selectedId,
    );
    return rows.slice().sort((a, b) => {
      const aMine = a.userId === selected.userId ? 0 : 1;
      const bMine = b.userId === selected.userId ? 0 : 1;
      if (aMine !== bMine) return aMine - bMine;
      return a.number.localeCompare(b.number);
    });
  }, [options, selected, selectedId]);

  const dirty = useMemo(() => {
    if (!selected || !draft) return false;
    return (
      draft.name !== selected.name
      || draft.llmProvider !== selected.llmProvider
      || draft.llmModel !== (selected.llmModel ?? "")
      || draft.ttsProvider !== selected.ttsProvider
      || draft.ttsVoice !== (selected.ttsVoice ?? "")
      || draft.ttsSpeed !== selected.ttsSpeed
      || numberId !== (selected.inboundNumber ? String(selected.inboundNumber.id) : "none")
    );
  }, [selected, draft, numberId]);

  const patchDraft = (patch: Partial<Controls>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  /** Switching TTS provider must also move the voice, or the call goes silent. */
  const changeTtsProvider = (provider: string) => {
    const spec = options?.tts.find((p) => p.value === provider);
    patchDraft({ ttsProvider: provider, ttsVoice: spec?.voices[0]?.value ?? "" });
  };

  const changeLlmProvider = (provider: string) => {
    const models = options?.llm[provider] ?? [];
    patchDraft({ llmProvider: provider, llmModel: models[0]?.value ?? "" });
  };

  const handleSave = async () => {
    if (!selected || !draft) return;
    setSaving(true);
    try {
      await adminFetch<IntakeAgent>(`/intake-agents/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify(draft),
      });
      const wanted = numberId === "none" ? null : Number(numberId);
      const current = selected.inboundNumber?.id ?? null;
      if (wanted !== current) {
        await adminFetch(`/intake-agents/${selected.id}/phone`, {
          method: "POST",
          body: JSON.stringify({ phoneNumberId: wanted }),
        });
      }
      toast({ title: "Saved", description: `${draft.name} is live on the next call.` });
      await load();
    } catch (err) {
      toast({ title: "Save failed", description: formatAdminError(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    if (!options) return;
    if (!newOwner) {
      toast({ title: "Pick an owner account", description: "The agent and its intake forms belong to one account.", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const created = await adminFetch<IntakeAgent>("/intake-agents", {
        method: "POST",
        body: JSON.stringify({ ...options.defaults, userId: newOwner }),
      });
      toast({ title: "Intake agent created", description: `${created.name} — assign an inbound number to take calls.` });
      await load();
      setSelectedId(created.id);
    } catch (err) {
      toast({ title: "Create failed", description: formatAdminError(err), variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const handleForgetCaller = async (phone: string) => {
    if (!selected) return;
    const trimmed = phone.trim();
    if (trimmed.replace(/\D/g, "").length < 7) {
      toast({ title: "Need a caller number", description: "Paste the number you are testing from.", variant: "destructive" });
      return;
    }
    setForgetting(trimmed);
    try {
      const result = await adminFetch<{ intakes: number; callbacks: number; memoryKeys: string[] }>(
        `/intake-agents/${selected.id}/forget-caller`,
        { method: "POST", body: JSON.stringify({ phone: trimmed }) },
      );
      toast({
        title: "Caller forgotten",
        description: `Removed ${result.intakes} form${result.intakes === 1 ? "" : "s"}, cancelled ${result.callbacks} callback${result.callbacks === 1 ? "" : "s"}. Next call is a first call.`,
      });
      setForgetPhone("");
      const [formRows, callRows] = await Promise.all([
        adminFetch<Session[]>(`/intake-agents/${selected.id}/sessions`),
        adminFetch<RecentCall[]>(`/intake-agents/${selected.id}/calls`),
      ]);
      setSessions(formRows);
      setCalls(callRows);
    } catch (err) {
      toast({ title: "Could not forget caller", description: formatAdminError(err), variant: "destructive" });
    } finally {
      setForgetting(null);
    }
  };

  const downloadCallJson = async (callId: number) => {
    setDownloadingLog(callId);
    try {
      const events = await adminFetch<unknown[]>(`/intake-agents/calls/${callId}/logs`);
      const blob = new Blob([JSON.stringify(events, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `call-${callId}-logs.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({ title: "Could not download JSON log", description: formatAdminError(err), variant: "destructive" });
    } finally {
      setDownloadingLog(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading intake agents…
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Candidate Intake Agent</h1>
          <p className="text-sm text-muted-foreground">
            Inbound recruiter agent that fills the live intake form and reads out the matching job.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
          <Select value={newOwner} onValueChange={setNewOwner}>
            <SelectTrigger className="w-[240px]">
              <SelectValue placeholder="Owner account for new agent" />
            </SelectTrigger>
            <SelectContent>
              {users.map((u) => (
                <SelectItem key={u.clerkId} value={u.clerkId}>
                  {u.email ?? u.clerkId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => void handleCreate()} disabled={creating}>
            {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            New agent
          </Button>
        </div>
      </div>

      {agents.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No intake agent yet. Pick an owner account above and create one — it comes preconfigured
            with the recruiter script, the intake tools and Sarvam English speech-to-text.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          {/* Agent list */}
          <Card className="h-fit">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Agents</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 p-2">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => setSelectedId(agent.id)}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm transition ${
                    agent.id === selectedId ? "bg-accent font-medium" : "hover:bg-accent/50"
                  }`}
                >
                  <div className="truncate">{agent.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {agent.inboundNumber ? agent.inboundNumber.number : "No inbound number"}
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>

          <div className="space-y-6">
            {draft && selected && options && (
              <>
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <CardTitle>Controls</CardTitle>
                        <CardDescription>
                          Saved changes apply to the next call. Nothing else about this agent is editable.
                        </CardDescription>
                      </div>
                      <Button onClick={() => void handleSave()} disabled={!dirty || saving}>
                        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        Save
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-2">
                      <Label htmlFor="intake-name">Agent name</Label>
                      <Input
                        id="intake-name"
                        value={draft.name}
                        maxLength={60}
                        onChange={(e) => patchDraft({ name: e.target.value })}
                        placeholder="Recruiter Intake"
                      />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>LLM provider</Label>
                        <Select value={draft.llmProvider} onValueChange={changeLlmProvider}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Object.keys(options.llm).map((p) => (
                              <SelectItem key={p} value={p}>
                                {p === "groq" ? "Groq" : "Sarvam AI"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Model</Label>
                        <Select value={draft.llmModel} onValueChange={(v) => patchDraft({ llmModel: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {llmModels.map((m) => (
                              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Text to speech</Label>
                        <Select value={draft.ttsProvider} onValueChange={changeTtsProvider}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {options.tts.map((p) => (
                              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Voice</Label>
                        <Select value={draft.ttsVoice} onValueChange={(v) => patchDraft({ ttsVoice: v })}>
                          <SelectTrigger><SelectValue placeholder="Pick a voice" /></SelectTrigger>
                          <SelectContent>
                            {(ttsVoiceChoices).map((v) => (
                              <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {ttsSpec?.allowCustomVoice && (
                      <div className="space-y-2">
                        <Label htmlFor="intake-voice-id">Or paste a Cartesia voice ID</Label>
                        <Input
                          id="intake-voice-id"
                          value={draft.ttsVoice}
                          onChange={(e) => patchDraft({ ttsVoice: e.target.value.trim() })}
                          placeholder="a8adc74b-c9c1-45e0-aae7-9a60ba64bbee"
                          className="font-mono text-xs"
                        />
                      </div>
                    )}

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label>Voice speed</Label>
                        <span className="text-sm tabular-nums text-muted-foreground">
                          {draft.ttsSpeed.toFixed(2)}×
                        </span>
                      </div>
                      <Slider
                        value={[draft.ttsSpeed]}
                        min={options.speed.min}
                        max={options.speed.max}
                        step={options.speed.step}
                        onValueChange={([v]) => patchDraft({ ttsSpeed: v ?? options.speed.default })}
                      />
                      <p className="text-xs text-muted-foreground">
                        1.00× is the voice's natural pace. Below 0.9× reads slowly for candidates with
                        weaker English; above 1.1× starts clipping short words on a phone line.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>Inbound number</Label>
                      <Select value={numberId} onValueChange={setNumberId}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No inbound number</SelectItem>
                          {assignableNumbers.map((n) => (
                            <SelectItem key={n.id} value={String(n.id)}>
                              {n.number}
                              {n.ownerEmail || n.userId
                                ? ` · ${n.ownerEmail ?? n.userId}`
                                : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Any purchased voice number can be used. Pick the DID you will actually call.
                        Numbers owned by {selected.ownerEmail ?? selected.userId} are listed first.
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Fixed for every intake call</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-2">
                    <Badge variant="secondary">STT: {options.locked.asrProvider} {options.locked.asrModel}</Badge>
                    <Badge variant="secondary">Language: English ({options.locked.language})</Badge>
                    <Badge variant="secondary">Telephony: {options.locked.telephonyProvider}</Badge>
                    <Badge variant="secondary">Turn-taking: Patient</Badge>
                    <Badge variant="secondary">Backchannel: Okay</Badge>
                    <Badge variant="secondary">Barge-in: {options.locked.wordsForInterruption} words</Badge>
                    <Badge variant="secondary">Recruiter script + intake tools</Badge>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Forget caller</CardTitle>
                    <CardDescription>
                      Wipes this number’s intake form, caller memory, and pending callbacks so the next ring is a first call.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap items-end gap-2">
                    <div className="min-w-[220px] flex-1 space-y-1">
                      <Label htmlFor="forget-phone">Caller number</Label>
                      <Input
                        id="forget-phone"
                        value={forgetPhone}
                        onChange={(e) => setForgetPhone(e.target.value)}
                        placeholder="The phone you are calling from"
                      />
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => void handleForgetCaller(forgetPhone)}
                      disabled={!!forgetting}
                    >
                      {forgetting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                      Forget
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Call logs</CardTitle>
                    <CardDescription>
                      Same records as dashboard Call logs. Open the page or download the JSON.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {calls.length === 0 ? (
                      <div className="py-6 text-sm text-muted-foreground">
                        No calls on this agent yet. After you hang up, this list refreshes automatically.
                      </div>
                    ) : (
                      calls.map((c) => (
                        <div
                          key={c.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                        >
                          <div className="min-w-0">
                            <div className="font-medium">Call #{c.id}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {c.status}
                              {c.durationSeconds != null ? ` · ${c.durationSeconds}s` : ""}
                              {c.fromNumber ? ` · ${c.fromNumber}` : ""}
                              {c.executionId ? ` · ${c.executionId}` : ""}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {c.fromNumber ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void handleForgetCaller(c.fromNumber!)}
                                disabled={!!forgetting}
                              >
                                {forgetting === c.fromNumber ? <Loader2 className="h-3 w-3 animate-spin" /> : "Forget"}
                              </Button>
                            ) : null}
                            <Button variant="outline" size="sm" asChild>
                              <Link href={`/voice/calls/${c.id}`}>Call log</Link>
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void downloadCallJson(c.id)}
                              disabled={downloadingLog === c.id}
                            >
                              {downloadingLog === c.id
                                ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                : <FileJson className="mr-1 h-3 w-3" />}
                              JSON
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Live intake forms</CardTitle>
                    <CardDescription>
                      Opens a form when a call connects. Refreshes every few seconds.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {sessions.length === 0 ? (
                      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                        <Phone className="h-4 w-4" />
                        {selected.inboundNumber
                          ? `Waiting for a call on ${selected.inboundNumber.number}…`
                          : "Assign an inbound number to start taking calls."}
                      </div>
                    ) : (
                      sessions.map((s) => (
                        <div
                          key={s.token}
                          className="flex items-center justify-between gap-4 rounded-md border px-3 py-2 text-sm"
                        >
                          <a
                            href={s.formUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="min-w-0 flex-1 transition hover:underline"
                          >
                            <div className="truncate font-medium">
                              {s.candidateName ?? s.phone ?? "Unnamed candidate"}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {s.status === "completed"
                                ? s.proposedCompany
                                  ? `Matched — ${s.proposedCompany}`
                                  : "Completed — no match"
                                : `${s.missingCount} field${s.missingCount === 1 ? "" : "s"} left`}
                              {s.dispositionIds.length > 0 ? ` · ${s.dispositionIds.join(", ")}` : ""}
                              {s.englishRating ? ` · English: ${s.englishRating}` : ""}
                            </div>
                          </a>
                          <div className="flex shrink-0 items-center gap-2">
                            {s.phone ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void handleForgetCaller(s.phone!)}
                                disabled={!!forgetting}
                              >
                                {forgetting === s.phone ? <Loader2 className="h-3 w-3 animate-spin" /> : "Forget"}
                              </Button>
                            ) : null}
                            <Badge variant={s.status === "completed" ? "default" : "secondary"}>
                              {s.status === "completed" ? "Done" : "Live"}
                            </Badge>
                            <a href={s.formUrl} target="_blank" rel="noreferrer">
                              <ExternalLink className="h-4 w-4 text-muted-foreground" />
                            </a>
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
