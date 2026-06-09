import React, { useState, useRef, useEffect } from "react";
import { useRoute, Link } from "wouter";
import { useStore, AgentStatus, KBType, KnowledgeEntry } from "@/lib/store";

const STATUS_FLOW: AgentStatus[] = ['draft', 'training', 'testing', 'approved', 'published'];

const STATUS_COLORS: Record<AgentStatus, string> = {
  draft: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  training: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  testing: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  approved: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  published: 'bg-green-500/20 text-green-400 border-green-500/30',
};

const TYPE_LABELS: Record<KBType, string> = {
  policy: "Policy", faq: "FAQ", objection: "Objection Handler", pricing: "Pricing",
};

const TYPE_COLORS: Record<KBType, string> = {
  policy: "bg-blue-500/20 text-blue-400",
  faq: "bg-green-500/20 text-green-400",
  objection: "bg-orange-500/20 text-orange-400",
  pricing: "bg-purple-500/20 text-purple-400",
};

interface ChatMessage { role: 'user' | 'agent'; text: string; }

const MOCK_RESPONSES = [
  "Thank you for that question! Based on our policy guidelines, I can confirm that comprehensive coverage includes protection against own damage, third-party liability, and personal accident cover for the owner-driver.",
  "That's a great point. Our No-Claim Bonus can reduce your premium by up to 50% after five consecutive claim-free years. Let me check your current NCB status.",
  "I completely understand your concern. Our claim settlement ratio of 98.7% is one of the highest in the industry, which means you can trust us to support you when it matters most.",
  "I appreciate you bringing that up. The premium adjustment this year reflects updated actuarial data and rising repair costs, but with your loyalty discount, the actual increase may be lower than you expect.",
  "Absolutely! Our network of 14,000+ hospitals means you'll almost certainly find a cashless hospital near you, whether you're at home or travelling.",
  "That's a common concern. I'd like to assure you that once the waiting period for your pre-existing condition has been fulfilled — which you may already be approaching — it will be fully covered under our policy.",
];

let mockIdx = 0;

export function AgentDetail() {
  const [, params] = useRoute("/agents/:id");
  const { agents, kbEntries, saveAgents, saveKbEntries, isLoaded } = useStore();
  const [activeTab, setActiveTab] = useState("overview");

  const [editingKb, setEditingKb] = useState<KnowledgeEntry | null>(null);
  const [showKbModal, setShowKbModal] = useState(false);
  const [kbForm, setKbForm] = useState({ type: 'faq' as KBType, question: '', answer: '' });
  const [expandedKb, setExpandedKb] = useState<string | null>(null);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, isTyping]);

  if (!isLoaded || !params) return null;

  const agent = agents.find(a => a.id === params.id);
  if (!agent) return (
    <div className="text-center py-20">
      <p className="text-muted-foreground">Agent not found.</p>
      <Link href="/agents" className="text-primary hover:underline mt-2 inline-block">← Back to agents</Link>
    </div>
  );

  const agentKb = kbEntries.filter(e => e.agentId === agent.id);

  const handleStatusChange = (newStatus: AgentStatus) => {
    saveAgents(agents.map(a => a.id === agent.id ? { ...a, status: newStatus, lastUpdated: new Date().toISOString() } : a));
  };

  const currentIndex = STATUS_FLOW.indexOf(agent.status);
  const nextStatus = currentIndex < STATUS_FLOW.length - 1 ? STATUS_FLOW[currentIndex + 1] : null;
  const prevStatus = currentIndex > 0 ? STATUS_FLOW[currentIndex - 1] : null;

  const openAddKb = () => {
    setEditingKb(null);
    setKbForm({ type: 'faq', question: '', answer: '' });
    setShowKbModal(true);
  };

  const openEditKb = (entry: KnowledgeEntry) => {
    setEditingKb(entry);
    setKbForm({ type: entry.type, question: entry.question, answer: entry.answer });
    setShowKbModal(true);
  };

  const saveKbEntry = () => {
    if (!kbForm.question.trim() || !kbForm.answer.trim()) return;
    if (editingKb) {
      saveKbEntries(kbEntries.map(e => e.id === editingKb.id
        ? { ...e, ...kbForm, updatedAt: new Date().toISOString() }
        : e
      ));
    } else {
      const entry: KnowledgeEntry = {
        id: `kb${Date.now()}`,
        agentId: agent.id,
        agentName: agent.name,
        companyName: agent.companyName,
        type: kbForm.type,
        question: kbForm.question.trim(),
        answer: kbForm.answer.trim(),
        updatedAt: new Date().toISOString()
      };
      saveKbEntries([...kbEntries, entry]);
      saveAgents(agents.map(a => a.id === agent.id ? { ...a, kbEntries: a.kbEntries + 1 } : a));
    }
    setShowKbModal(false);
  };

  const deleteKbEntry = (id: string) => {
    if (!confirm('Delete this knowledge entry?')) return;
    saveKbEntries(kbEntries.filter(e => e.id !== id));
    saveAgents(agents.map(a => a.id === agent.id ? { ...a, kbEntries: Math.max(0, a.kbEntries - 1) } : a));
  };

  const sendChat = () => {
    const text = chatInput.trim();
    if (!text) return;
    setChatMessages(m => [...m, { role: 'user', text }]);
    setChatInput('');
    setIsTyping(true);
    setTimeout(() => {
      const response = MOCK_RESPONSES[mockIdx % MOCK_RESPONSES.length];
      mockIdx++;
      setChatMessages(m => [...m, { role: 'agent', text: response }]);
      setIsTyping(false);
    }, 1200 + Math.random() * 800);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <Link href="/agents" className="hover:text-foreground">Agents</Link>
            <span>/</span>
            <span>{agent.companyName}</span>
          </div>
          <h1 className="text-3xl font-bold">{agent.name}</h1>
          <p className="text-muted-foreground mt-1">{agent.companyName} · Updated {timeAgo(agent.lastUpdated)}</p>
        </div>
        <div className="flex items-center gap-2">
          {prevStatus && (
            <button
              onClick={() => handleStatusChange(prevStatus)}
              className="border border-border px-3 py-1.5 rounded text-sm font-medium hover:bg-muted transition-colors text-muted-foreground"
            >
              ← {prevStatus.toUpperCase()}
            </button>
          )}
          <span className={`px-3 py-1.5 rounded-full text-sm font-medium border ${STATUS_COLORS[agent.status]}`}>
            {agent.status.toUpperCase()}
          </span>
          {nextStatus && (
            <button
              onClick={() => handleStatusChange(nextStatus)}
              className="bg-primary text-primary-foreground px-3 py-1.5 rounded text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Move to {nextStatus.toUpperCase()} →
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-1 border-b border-border">
        {(['overview', 'knowledge', 'test', 'settings'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${activeTab === tab ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {tab === 'knowledge' ? `Knowledge (${agentKb.length})` : tab === 'test' ? 'Test Chat' : tab}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-card border border-border p-6 rounded-lg">
            <h3 className="font-semibold mb-3">System Prompt</h3>
            <pre className="text-sm bg-muted/40 p-4 rounded-lg whitespace-pre-wrap font-sans leading-relaxed text-foreground/90 max-h-80 overflow-y-auto">{agent.systemPrompt}</pre>
          </div>
          <div className="space-y-4">
            <div className="bg-card border border-border p-6 rounded-lg">
              <h3 className="font-semibold mb-4">Performance</h3>
              <div className="grid grid-cols-2 gap-4">
                <Metric label="Total Calls" value={agent.totalCalls.toLocaleString()} />
                <Metric label="Conversion Rate" value={agent.totalCalls > 0 ? `${agent.conversionRate}%` : '—'} highlight={agent.conversionRate > 30} />
                <Metric label="KB Entries" value={agent.kbEntries.toString()} />
                <Metric label="Voice ID" value={agent.voiceId} />
              </div>
            </div>
            <div className="bg-card border border-border p-6 rounded-lg">
              <h3 className="font-semibold mb-3">Status Pipeline</h3>
              <div className="flex items-center gap-1">
                {STATUS_FLOW.map((s, i) => (
                  <React.Fragment key={s}>
                    <div className={`px-2 py-1 rounded text-xs font-medium ${agent.status === s ? STATUS_COLORS[s] : STATUS_FLOW.indexOf(agent.status) > i ? 'bg-muted/60 text-foreground/60' : 'bg-muted/20 text-muted-foreground'}`}>
                      {s}
                    </div>
                    {i < STATUS_FLOW.length - 1 && <span className="text-muted-foreground text-xs">→</span>}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'knowledge' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">{agentKb.length} training entries for this agent.</p>
            <button onClick={openAddKb} className="bg-primary text-primary-foreground px-3 py-1.5 rounded text-sm font-medium hover:bg-primary/90">
              + Add Entry
            </button>
          </div>

          {agentKb.length === 0 && (
            <div className="bg-card border border-border rounded-lg p-12 text-center text-muted-foreground">
              <p className="font-medium">No knowledge entries yet</p>
              <p className="text-sm mt-1">Add FAQ answers, policy details, and objection handlers.</p>
            </div>
          )}

          <div className="space-y-2">
            {agentKb.map(entry => (
              <div key={entry.id} className="bg-card border border-border rounded-lg overflow-hidden">
                <div
                  className="flex items-start gap-3 px-5 py-3.5 cursor-pointer hover:bg-muted/20 transition-colors"
                  onClick={() => setExpandedKb(expandedKb === entry.id ? null : entry.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[entry.type]}`}>
                        {TYPE_LABELS[entry.type]}
                      </span>
                    </div>
                    <p className="font-medium text-sm">{entry.question}</p>
                    {expandedKb !== entry.id && <p className="text-xs text-muted-foreground mt-0.5 truncate">{entry.answer}</p>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={e => { e.stopPropagation(); openEditKb(entry); }} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted">Edit</button>
                    <button onClick={e => { e.stopPropagation(); deleteKbEntry(entry.id); }} className="text-xs text-destructive px-2 py-1 rounded hover:bg-destructive/10">Delete</button>
                    <span className="text-muted-foreground text-xs pt-1">{expandedKb === entry.id ? '▲' : '▼'}</span>
                  </div>
                </div>
                {expandedKb === entry.id && (
                  <div className="border-t border-border px-5 py-3 bg-muted/10">
                    <p className="text-sm leading-relaxed">{entry.answer}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'test' && (
        <div className="bg-card border border-border rounded-xl overflow-hidden flex flex-col h-[520px]">
          <div className="px-5 py-3.5 border-b border-border bg-muted/20 flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-sm font-medium">Test Chat — {agent.name}</span>
            <span className="text-xs text-muted-foreground ml-auto">{agent.companyName}</span>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {chatMessages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3">
                <div className="text-4xl">💬</div>
                <p className="font-medium text-sm">Start a test conversation</p>
                <p className="text-xs text-center max-w-xs">Type a message below to see how {agent.name} responds to customer queries.</p>
                <div className="flex flex-wrap gap-2 justify-center mt-2">
                  {["What does my policy cover?", "Why did my premium increase?", "How do I file a claim?"].map(s => (
                    <button
                      key={s}
                      onClick={() => { setChatInput(s); }}
                      className="px-3 py-1.5 bg-muted rounded-full text-xs hover:bg-muted/80 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {chatMessages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${m.role === 'user' ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-muted/60 text-foreground rounded-bl-sm'}`}>
                  {m.text}
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-muted/60 px-4 py-2.5 rounded-2xl rounded-bl-sm">
                  <span className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '300ms' }} />
                  </span>
                </div>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          <div className="border-t border-border p-4 flex gap-3">
            <input
              type="text"
              className="flex-1 bg-input border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Type a test message..."
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendChat()}
            />
            <button
              onClick={sendChat}
              disabled={!chatInput.trim() || isTyping}
              className="bg-primary text-primary-foreground px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Send
            </button>
          </div>
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="space-y-4 max-w-xl">
          <div className="bg-card border border-border rounded-lg p-6 space-y-4">
            <h3 className="font-semibold">Agent Configuration</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Agent ID</p>
                <p className="font-mono mt-0.5">{agent.id}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Company ID</p>
                <p className="font-mono mt-0.5">{agent.companyId}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Voice Model</p>
                <p className="mt-0.5">{agent.voiceId}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Created</p>
                <p className="mt-0.5">{new Date(agent.lastUpdated).toLocaleDateString()}</p>
              </div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-lg p-6">
            <h3 className="font-semibold mb-3 text-destructive">Danger Zone</h3>
            <p className="text-sm text-muted-foreground mb-4">Permanently delete this agent and all associated knowledge base entries. This action cannot be undone.</p>
            <button className="border border-destructive text-destructive px-4 py-2 rounded text-sm font-medium hover:bg-destructive/10 transition-colors">
              Delete Agent
            </button>
          </div>
        </div>
      )}

      {showKbModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-xl w-full max-w-2xl shadow-2xl">
            <div className="px-6 py-4 border-b border-border flex justify-between items-center">
              <h2 className="font-semibold">{editingKb ? 'Edit Entry' : 'Add Knowledge Entry'}</h2>
              <button onClick={() => setShowKbModal(false)} className="text-muted-foreground hover:text-foreground text-xl">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Type</label>
                <select className="w-full bg-input border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" value={kbForm.type} onChange={e => setKbForm(f => ({ ...f, type: e.target.value as KBType }))}>
                  {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Question / Trigger</label>
                <input type="text" className="w-full bg-input border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" placeholder="e.g. Why did my premium increase?" value={kbForm.question} onChange={e => setKbForm(f => ({ ...f, question: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Answer / Script</label>
                <textarea rows={5} className="w-full bg-input border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary font-mono" value={kbForm.answer} onChange={e => setKbForm(f => ({ ...f, answer: e.target.value }))} />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setShowKbModal(false)} className="px-4 py-2 rounded text-sm font-medium bg-muted hover:bg-muted/80">Cancel</button>
                <button onClick={saveKbEntry} disabled={!kbForm.question.trim() || !kbForm.answer.trim()} className="px-4 py-2 rounded text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed">
                  {editingKb ? 'Save Changes' : 'Add Entry'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold mt-0.5 ${highlight ? 'text-green-400' : ''}`}>{value}</p>
    </div>
  );
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  return "just now";
}
