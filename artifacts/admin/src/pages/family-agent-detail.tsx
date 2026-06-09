import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useFamilyStore, AgentStatus, KBType, KnowledgeEntry } from "@/lib/family-store";
import {
  ArrowLeft, Bot, ChevronRight, Pencil, Trash2, Plus,
  Send, CheckCircle, ChevronDown, ChevronUp, Shield,
} from "lucide-react";

const STATUS_PIPELINE: AgentStatus[] = ["draft", "training", "testing", "approved", "published"];
const STATUS_LABEL: Record<AgentStatus, string> = {
  draft: "Draft", training: "Training", testing: "Testing", approved: "Approved", published: "Published",
};
const STATUS_DOT: Record<AgentStatus, string> = {
  draft: "bg-muted-foreground", training: "bg-yellow-400", testing: "bg-blue-400",
  approved: "bg-green-400", published: "bg-emerald-500",
};

const KB_TYPE_LABELS: Record<KBType, string> = {
  faq: "FAQ", policy: "Policy", objection: "Objection Handler", pricing: "Pricing",
};

type ChatMsg = { role: "user" | "agent"; text: string };

const MOCK_REPLIES: Record<string, string> = {
  default: "Thank you for your question. Based on our policy details, I can assure you that we have comprehensive coverage options tailored to your needs. Would you like me to walk you through the key benefits?",
  premium: "I understand your concern about the premium. Your No-Claim Bonus of up to 50% is protecting your current rate. We also have loyalty discounts available — let me check what applies to your policy specifically.",
  claim: "Filing a claim is straightforward. Call our 24x7 helpline immediately after any incident. We have over 6,000 cashless network partners and aim to settle claims within 7 working days.",
  renew: "Renewing before your policy expires avoids any inspection requirement and keeps your NCB intact. I can process the renewal right now — it takes just 2 minutes.",
  cover: "Our comprehensive plan covers own damage, third-party liability, personal accident, and optional add-ons like zero depreciation and roadside assistance. Would you like details on any specific coverage?",
};

function getMockReply(input: string): string {
  const lower = input.toLowerCase();
  if (lower.includes("premium") || lower.includes("price") || lower.includes("cost")) return MOCK_REPLIES.premium;
  if (lower.includes("claim")) return MOCK_REPLIES.claim;
  if (lower.includes("renew")) return MOCK_REPLIES.renew;
  if (lower.includes("cover") || lower.includes("policy")) return MOCK_REPLIES.cover;
  return MOCK_REPLIES.default;
}

export default function FamilyAgentDetailPage({ params }: { params: { id: string } }) {
  const { agents, kbEntries, saveAgents, saveKbEntries, isLoaded } = useFamilyStore();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<"overview" | "knowledge" | "chat" | "settings">("overview");

  const agent = agents.find((a) => a.id === params.id);

  const agentKb = kbEntries.filter((e) => e.agentId === params.id);

  const [editPrompt, setEditPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");

  const [showKbModal, setShowKbModal] = useState(false);
  const [editingKb, setEditingKb] = useState<KnowledgeEntry | null>(null);
  const [kbType, setKbType] = useState<KBType>("faq");
  const [kbQ, setKbQ] = useState("");
  const [kbA, setKbA] = useState("");
  const [expandedKb, setExpandedKb] = useState<string | null>(null);
  const [kbSearch, setKbSearch] = useState("");
  const [kbTypeFilter, setKbTypeFilter] = useState<string>("all");

  const [chatInput, setChatInput] = useState("");
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([
    { role: "agent", text: "Hello! I'm ready to assist your customers. Try asking me anything about the insurance products." },
  ]);
  const [chatTyping, setChatTyping] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMsgs, chatTyping]);

  if (!isLoaded) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!agent) {
    return (
      <div className="space-y-4">
        <Link href="/family-agents">
          <Button variant="ghost" size="sm" className="gap-1"><ArrowLeft className="h-4 w-4" /> Back</Button>
        </Link>
        <p className="text-muted-foreground">Agent not found.</p>
      </div>
    );
  }

  function updateStatus(newStatus: AgentStatus) {
    const updated = agents.map((a) =>
      a.id === agent!.id ? { ...a, status: newStatus, lastUpdated: new Date().toISOString() } : a
    );
    saveAgents(updated);
    toast({ title: `Status updated to ${STATUS_LABEL[newStatus]}` });
  }

  function savePrompt() {
    const updated = agents.map((a) =>
      a.id === agent!.id ? { ...a, systemPrompt: promptDraft, lastUpdated: new Date().toISOString() } : a
    );
    saveAgents(updated);
    setEditPrompt(false);
    toast({ title: "System prompt saved" });
  }

  function openKbCreate() {
    setEditingKb(null);
    setKbType("faq");
    setKbQ("");
    setKbA("");
    setShowKbModal(true);
  }

  function openKbEdit(entry: KnowledgeEntry) {
    setEditingKb(entry);
    setKbType(entry.type);
    setKbQ(entry.question);
    setKbA(entry.answer);
    setShowKbModal(true);
  }

  function saveKbEntry() {
    if (!kbQ.trim() || !kbA.trim()) return;
    if (editingKb) {
      const updated = kbEntries.map((e) =>
        e.id === editingKb.id
          ? { ...e, type: kbType, question: kbQ.trim(), answer: kbA.trim(), updatedAt: new Date().toISOString() }
          : e
      );
      saveKbEntries(updated);
      const agentUpdated = agents.map((a) =>
        a.id === agent!.id ? { ...a, lastUpdated: new Date().toISOString() } : a
      );
      saveAgents(agentUpdated);
    } else {
      const entry: KnowledgeEntry = {
        id: `kb${Date.now()}`,
        agentId: agent!.id,
        agentName: agent!.name,
        companyName: agent!.companyName,
        type: kbType,
        question: kbQ.trim(),
        answer: kbA.trim(),
        updatedAt: new Date().toISOString(),
      };
      const newKb = [...kbEntries, entry];
      saveKbEntries(newKb);
      const agentUpdated = agents.map((a) =>
        a.id === agent!.id ? { ...a, kbEntries: a.id === agent!.id ? newKb.filter((e) => e.agentId === agent!.id).length : a.kbEntries, lastUpdated: new Date().toISOString() } : a
      );
      saveAgents(agentUpdated);
    }
    setShowKbModal(false);
    toast({ title: editingKb ? "Entry updated" : "Entry added" });
  }

  function deleteKbEntry(id: string) {
    const newKb = kbEntries.filter((e) => e.id !== id);
    saveKbEntries(newKb);
    const agentUpdated = agents.map((a) =>
      a.id === agent!.id ? { ...a, kbEntries: newKb.filter((e) => e.agentId === agent!.id).length, lastUpdated: new Date().toISOString() } : a
    );
    saveAgents(agentUpdated);
    toast({ title: "Entry deleted" });
  }

  function deleteAgent() {
    saveAgents(agents.filter((a) => a.id !== agent!.id));
    saveKbEntries(kbEntries.filter((e) => e.agentId !== agent!.id));
    navigate("/family-agents");
    toast({ title: "Agent deleted" });
  }

  function sendChat() {
    if (!chatInput.trim()) return;
    const userMsg = chatInput.trim();
    setChatInput("");
    setChatMsgs((prev) => [...prev, { role: "user", text: userMsg }]);
    setChatTyping(true);
    setTimeout(() => {
      setChatTyping(false);
      setChatMsgs((prev) => [...prev, { role: "agent", text: getMockReply(userMsg) }]);
    }, 1200 + Math.random() * 600);
  }

  const filteredKb = agentKb.filter((e) => {
    const matchSearch = e.question.toLowerCase().includes(kbSearch.toLowerCase()) || e.answer.toLowerCase().includes(kbSearch.toLowerCase());
    const matchType = kbTypeFilter === "all" || e.type === kbTypeFilter;
    return matchSearch && matchType;
  });

  const curIdx = STATUS_PIPELINE.indexOf(agent.status);
  const nextStatus = STATUS_PIPELINE[curIdx + 1] as AgentStatus | undefined;
  const prevStatus = STATUS_PIPELINE[curIdx - 1] as AgentStatus | undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/family-agents">
          <button className="hover:text-foreground transition-colors">Family Agents</button>
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-foreground font-medium">{agent.name}</span>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{agent.name}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-sm text-muted-foreground">{agent.companyName}</span>
              <span className="text-muted-foreground">·</span>
              <div className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${STATUS_DOT[agent.status]}`} />
                <span className="text-sm font-medium">{STATUS_LABEL[agent.status]}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {prevStatus && (
            <Button variant="outline" size="sm" onClick={() => updateStatus(prevStatus)}>
              ← Move to {STATUS_LABEL[prevStatus]}
            </Button>
          )}
          {nextStatus && (
            <Button size="sm" onClick={() => updateStatus(nextStatus)} className="gap-1">
              <CheckCircle className="h-3.5 w-3.5" />
              {nextStatus === "published" ? "Publish to Mobile" : `Move to ${STATUS_LABEL[nextStatus]}`}
            </Button>
          )}
          {agent.status === "published" && (
            <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/30 gap-1">
              <Shield className="h-3 w-3" /> Live on Mobile App
            </Badge>
          )}
        </div>
      </div>

      <div className="flex gap-1 border-b border-border">
        {(["overview", "knowledge", "chat", "settings"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "chat" ? "Test Chat" : t === "knowledge" ? "Knowledge Base" : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "KB Entries", value: agentKb.length },
              { label: "Total Calls", value: agent.totalCalls > 0 ? agent.totalCalls.toLocaleString() : "—" },
              { label: "Conversion Rate", value: agent.conversionRate > 0 ? `${agent.conversionRate}%` : "—" },
            ].map(({ label, value }) => (
              <Card key={label}>
                <CardContent className="p-4">
                  <p className="text-2xl font-bold">{value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">Status Pipeline</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                {STATUS_PIPELINE.map((s, i) => {
                  const isCompleted = STATUS_PIPELINE.indexOf(agent.status) >= i;
                  const isCurrent = agent.status === s;
                  return (
                    <div key={s} className="flex items-center gap-2">
                      <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                        isCurrent
                          ? "bg-primary text-primary-foreground border-primary"
                          : isCompleted
                          ? "bg-primary/10 text-primary border-primary/20"
                          : "bg-muted/30 text-muted-foreground border-border"
                      }`}>
                        {isCompleted && !isCurrent && <CheckCircle className="h-3 w-3" />}
                        {STATUS_LABEL[s]}
                      </div>
                      {i < STATUS_PIPELINE.length - 1 && (
                        <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${isCompleted ? "text-primary/50" : "text-muted-foreground/30"}`} />
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">System Prompt</CardTitle>
              <Button
                size="sm"
                variant="ghost"
                className="gap-1"
                onClick={() => { setPromptDraft(agent.systemPrompt); setEditPrompt(true); }}
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            </CardHeader>
            <CardContent>
              {editPrompt ? (
                <div className="space-y-3">
                  <Textarea
                    value={promptDraft}
                    onChange={(e) => setPromptDraft(e.target.value)}
                    rows={12}
                    className="text-sm font-mono resize-none"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={savePrompt}>Save</Button>
                    <Button size="sm" variant="outline" onClick={() => setEditPrompt(false)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <pre className="text-sm whitespace-pre-wrap text-muted-foreground leading-relaxed">
                  {agent.systemPrompt || "No system prompt set. Click Edit to add one."}
                </pre>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "knowledge" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <Input
                placeholder="Search questions or answers…"
                value={kbSearch}
                onChange={(e) => setKbSearch(e.target.value)}
                className="pl-3"
              />
            </div>
            <Select value={kbTypeFilter} onValueChange={setKbTypeFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="faq">FAQ</SelectItem>
                <SelectItem value="policy">Policy</SelectItem>
                <SelectItem value="objection">Objection Handler</SelectItem>
                <SelectItem value="pricing">Pricing</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" onClick={openKbCreate} className="gap-1">
              <Plus className="h-4 w-4" /> Add Entry
            </Button>
            <span className="text-sm text-muted-foreground ml-auto">{filteredKb.length} entries</span>
          </div>

          {filteredKb.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <p className="text-sm text-muted-foreground">No knowledge base entries yet. Add your first entry to train this agent.</p>
                <Button size="sm" className="mt-3 gap-1" onClick={openKbCreate}>
                  <Plus className="h-4 w-4" /> Add First Entry
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {filteredKb.map((entry) => (
                <Card key={entry.id} className="overflow-hidden">
                  <div
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/20 transition-colors"
                    onClick={() => setExpandedKb(expandedKb === entry.id ? null : entry.id)}
                  >
                    <Badge variant="outline" className="shrink-0 text-xs">{KB_TYPE_LABELS[entry.type]}</Badge>
                    <p className="flex-1 text-sm font-medium truncate">{entry.question}</p>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={(e) => { e.stopPropagation(); openKbEdit(entry); }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                        onClick={(e) => { e.stopPropagation(); deleteKbEntry(entry.id); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                      {expandedKb === entry.id
                        ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </div>
                  {expandedKb === entry.id && (
                    <div className="px-4 pb-4 border-t border-border/50 bg-muted/10">
                      <p className="text-sm text-muted-foreground mt-3 leading-relaxed">{entry.answer}</p>
                      <p className="text-xs text-muted-foreground/60 mt-2">
                        Updated {new Date(entry.updatedAt).toLocaleDateString()}
                      </p>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "chat" && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Test Chat — Simulate Customer Conversation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="h-96 overflow-y-auto space-y-3 pr-1">
                {chatMsgs.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-muted text-foreground rounded-bl-sm"
                    }`}>
                      {msg.text}
                    </div>
                  </div>
                ))}
                {chatTyping && (
                  <div className="flex justify-start">
                    <div className="bg-muted px-4 py-3 rounded-2xl rounded-bl-sm flex gap-1 items-center">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce"
                          style={{ animationDelay: `${i * 0.15}s` }}
                        />
                      ))}
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Type a customer message…"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                />
                <Button onClick={sendChat} disabled={!chatInput.trim() || chatTyping} className="gap-1.5">
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {["What does your policy cover?", "The premium seems high", "How do I file a claim?", "What if my policy lapses?"].map((s) => (
                  <button
                    key={s}
                    onClick={() => { setChatInput(s); }}
                    className="text-xs px-3 py-1.5 rounded-full border border-border hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "settings" && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Agent Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                {[
                  { label: "Agent ID", value: agent.id },
                  { label: "Company", value: agent.companyName },
                  { label: "Voice", value: agent.voiceId },
                  { label: "Last Updated", value: new Date(agent.lastUpdated).toLocaleString() },
                  { label: "KB Entries", value: String(agentKb.length) },
                  { label: "Status", value: STATUS_LABEL[agent.status] },
                ].map(({ label, value }) => (
                  <div key={label} className="flex flex-col gap-0.5">
                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</span>
                    <span className="font-mono text-sm">{value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Deleting this agent will permanently remove it along with all {agentKb.length} knowledge base entries. This cannot be undone.
              </p>
              <Button variant="destructive" size="sm" onClick={deleteAgent} className="gap-1.5">
                <Trash2 className="h-4 w-4" /> Delete Agent
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={showKbModal} onOpenChange={setShowKbModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingKb ? "Edit Knowledge Entry" : "Add Knowledge Entry"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={kbType} onValueChange={(v) => setKbType(v as KBType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="faq">FAQ</SelectItem>
                  <SelectItem value="policy">Policy</SelectItem>
                  <SelectItem value="objection">Objection Handler</SelectItem>
                  <SelectItem value="pricing">Pricing</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Question / Trigger</Label>
              <Input
                placeholder="e.g. What does the plan cover?"
                value={kbQ}
                onChange={(e) => setKbQ(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Answer / Response</Label>
              <Textarea
                placeholder="What the agent should say…"
                value={kbA}
                onChange={(e) => setKbA(e.target.value)}
                rows={5}
                className="resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowKbModal(false)}>Cancel</Button>
            <Button onClick={saveKbEntry} disabled={!kbQ.trim() || !kbA.trim()}>
              {editingKb ? "Save Changes" : "Add Entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
