import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useFamilyStore, AgentStatus } from "@/lib/family-store";
import { ChevronRight, Bot, Pencil, Send, CheckCircle, Shield, Database } from "lucide-react";

const STATUS_PIPELINE: AgentStatus[] = ["draft", "training", "testing", "approved", "published"];
const STATUS_LABEL: Record<AgentStatus, string> = {
  draft: "Draft", training: "Training", testing: "Testing", approved: "Approved", published: "Published",
};
const STATUS_DOT: Record<AgentStatus, string> = {
  draft: "bg-muted-foreground", training: "bg-yellow-400", testing: "bg-blue-400",
  approved: "bg-green-400", published: "bg-emerald-500",
};

type ChatMsg = { role: "user" | "agent"; text: string };

const MOCK_REPLIES: Record<string, string> = {
  default: "Thank you for your question. Based on our policy details, I can assure you that we have comprehensive coverage options tailored to your needs. Would you like me to walk you through the key benefits?",
  premium: "I understand your concern about the premium. Your No-Claim Bonus of up to 50% is protecting your current rate. We also have loyalty discounts available — let me check what applies to your policy specifically.",
  claim:   "Filing a claim is straightforward. Call our 24x7 helpline immediately after any incident. We have thousands of cashless network partners and aim to settle claims within 7 working days.",
  renew:   "Renewing before your policy expires avoids any inspection requirement and keeps your NCB intact. I can guide you through the renewal process right now.",
  cover:   "Our comprehensive plan covers own damage, third-party liability, personal accident, and optional add-ons like zero depreciation and roadside assistance. Would you like details?",
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
  const { agents, documents, saveAgents, isLoaded } = useFamilyStore();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<"overview" | "chat" | "settings">("overview");

  const agent = agents.find(a => a.id === params.id);

  const [editPrompt, setEditPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");

  const [chatInput, setChatInput] = useState("");
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([
    { role: "agent", text: "Hello! I'm ready to assist your customers. Try asking me anything about insurance products." },
  ]);
  const [chatTyping, setChatTyping] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMsgs, chatTyping]);

  if (!isLoaded) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!agent) {
    return (
      <div className="space-y-4">
        <Link href="/family/agents">
          <Button variant="ghost" size="sm" className="gap-1">← Back to Agents</Button>
        </Link>
        <p className="text-muted-foreground">Agent not found.</p>
      </div>
    );
  }

  const policyDocs = agent.policyId ? documents.filter(d => d.policyId === agent.policyId) : [];
  const curIdx = STATUS_PIPELINE.indexOf(agent.status);
  const nextStatus = STATUS_PIPELINE[curIdx + 1] as AgentStatus | undefined;
  const prevStatus = STATUS_PIPELINE[curIdx - 1] as AgentStatus | undefined;

  function updateStatus(s: AgentStatus) {
    saveAgents(agents.map(a => a.id === agent!.id ? { ...a, status: s, lastUpdated: new Date().toISOString() } : a));
    toast({ title: `Status → ${STATUS_LABEL[s]}` });
  }
  function savePrompt() {
    saveAgents(agents.map(a => a.id === agent!.id ? { ...a, systemPrompt: promptDraft, lastUpdated: new Date().toISOString() } : a));
    setEditPrompt(false);
    toast({ title: "System prompt saved" });
  }
  function deleteAgent() {
    saveAgents(agents.filter(a => a.id !== agent!.id));
    navigate("/family/agents");
    toast({ title: "Agent deleted" });
  }
  function sendChat() {
    if (!chatInput.trim()) return;
    const msg = chatInput.trim(); setChatInput("");
    setChatMsgs(p => [...p, { role: "user", text: msg }]);
    setChatTyping(true);
    setTimeout(() => {
      setChatTyping(false);
      setChatMsgs(p => [...p, { role: "agent", text: getMockReply(msg) }]);
    }, 1200 + Math.random() * 600);
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/family/agents">
          <button className="hover:text-foreground transition-colors">Agents</button>
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-foreground font-medium">{agent.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{agent.name}</h1>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-sm text-muted-foreground">{agent.companyName}</span>
              {agent.policyName && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-sm text-muted-foreground">{agent.policyName}</span>
                </>
              )}
              <span className="text-muted-foreground">·</span>
              <div className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${STATUS_DOT[agent.status]}`} />
                <span className="text-sm font-medium">{STATUS_LABEL[agent.status]}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {prevStatus && (
            <Button variant="outline" size="sm" onClick={() => updateStatus(prevStatus)}>
              ← {STATUS_LABEL[prevStatus]}
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

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(["overview", "chat", "settings"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}>
            {t === "chat" ? "Test Chat" : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Status",      value: STATUS_LABEL[agent.status] },
              { label: "Total Calls", value: agent.totalCalls > 0 ? agent.totalCalls.toLocaleString() : "—" },
              { label: "Conv. Rate",  value: agent.conversionRate > 0 ? `${agent.conversionRate}%` : "—" },
            ].map(({ label, value }) => (
              <Card key={label}><CardContent className="p-4">
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </CardContent></Card>
            ))}
          </div>

          {/* Status pipeline */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Status Pipeline</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 flex-wrap">
                {STATUS_PIPELINE.map((s, i) => {
                  const isCompleted = STATUS_PIPELINE.indexOf(agent.status) >= i;
                  const isCurrent = agent.status === s;
                  return (
                    <div key={s} className="flex items-center gap-2">
                      <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                        isCurrent ? "bg-primary text-primary-foreground border-primary"
                        : isCompleted ? "bg-primary/10 text-primary border-primary/20"
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

          {/* RAG connection */}
          {agent.policyId && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Database className="h-4 w-4 text-primary" /> RAG Knowledge Base
                </CardTitle>
                <Link href={`/family/companies/${agent.companyId}/policies/${agent.policyId}`}>
                  <Button size="sm" variant="ghost" className="gap-1 text-xs">View KB <ChevronRight className="h-3 w-3" /></Button>
                </Link>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 text-sm">
                  <div>
                    <p className="font-medium">{agent.policyName}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{agent.companyName}</p>
                  </div>
                  <div className="ml-auto text-right">
                    <p className="text-xl font-bold">{policyDocs.length}</p>
                    <p className="text-xs text-muted-foreground">documents</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-bold">{policyDocs.reduce((s, d) => s + d.chunkCount, 0)}</p>
                    <p className="text-xs text-muted-foreground">chunks</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* System Prompt */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">System Prompt</CardTitle>
              <Button size="sm" variant="ghost" className="gap-1"
                onClick={() => { setPromptDraft(agent.systemPrompt); setEditPrompt(true); }}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            </CardHeader>
            <CardContent>
              {editPrompt ? (
                <div className="space-y-3">
                  <Textarea value={promptDraft} onChange={e => setPromptDraft(e.target.value)} rows={12} className="text-sm font-mono resize-none" />
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

      {tab === "chat" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Test Chat — Simulate Customer Conversation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="h-96 overflow-y-auto space-y-3 pr-1">
              {chatMsgs.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                    msg.role === "user" ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted text-foreground rounded-bl-sm"
                  }`}>{msg.text}</div>
                </div>
              ))}
              {chatTyping && (
                <div className="flex justify-start">
                  <div className="bg-muted px-4 py-3 rounded-2xl rounded-bl-sm flex gap-1 items-center">
                    {[0,1,2].map(i => (
                      <span key={i} className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: `${i*0.15}s` }} />
                    ))}
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="flex gap-2">
              <Input placeholder="Type a customer message…" value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }} />
              <Button onClick={sendChat} disabled={!chatInput.trim() || chatTyping} className="gap-1.5">
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {["What does your policy cover?", "The premium seems high", "How do I file a claim?", "I want to renew my policy"].map(s => (
                <button key={s} onClick={() => setChatInput(s)}
                  className="text-xs px-3 py-1.5 rounded-full border border-border hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors">
                  {s}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "settings" && (
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Agent Configuration</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                {[
                  { label: "Agent ID",    value: agent.id },
                  { label: "Company",     value: agent.companyName },
                  { label: "Policy",      value: agent.policyName ?? "—" },
                  { label: "Mode",        value: agent.agentMode ?? "byop" },
                  { label: "ASR",         value: `${agent.asrProvider ?? "—"} / ${agent.asrModel ?? "—"}` },
                  { label: "LLM",         value: `${agent.llmProvider ?? "—"} / ${agent.llmModel ?? "—"}` },
                  { label: "TTS",         value: `${agent.ttsProvider ?? "—"} / ${agent.ttsVoice ?? "—"}` },
                  { label: "Telephony",   value: agent.telephonyProvider ?? "—" },
                  { label: "Language",    value: agent.language ?? "—" },
                  { label: "Last Updated", value: new Date(agent.lastUpdated).toLocaleString() },
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
            <CardHeader><CardTitle className="text-base text-destructive">Danger Zone</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Deleting this agent is permanent and cannot be undone.
              </p>
              <Button variant="destructive" size="sm" onClick={deleteAgent}>Delete Agent</Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
