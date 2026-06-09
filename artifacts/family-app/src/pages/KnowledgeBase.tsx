import React, { useState } from "react";
import { useStore, KBType, KnowledgeEntry } from "@/lib/store";

const TYPE_LABELS: Record<KBType, string> = {
  policy: "Policy",
  faq: "FAQ",
  objection: "Objection Handler",
  pricing: "Pricing",
};

const TYPE_COLORS: Record<KBType, string> = {
  policy: "bg-blue-500/20 text-blue-400",
  faq: "bg-green-500/20 text-green-400",
  objection: "bg-orange-500/20 text-orange-400",
  pricing: "bg-purple-500/20 text-purple-400",
};

const EMPTY_FORM = { agentId: '', type: 'faq' as KBType, question: '', answer: '' };

export function KnowledgeBase() {
  const { agents, kbEntries, saveKbEntries, isLoaded } = useStore();
  const [filterAgent, setFilterAgent] = useState('');
  const [filterType, setFilterType] = useState('');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<KnowledgeEntry | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!isLoaded) return null;

  const filtered = kbEntries.filter(e => {
    if (filterAgent && e.agentId !== filterAgent) return false;
    if (filterType && e.type !== filterType) return false;
    if (search && !e.question.toLowerCase().includes(search.toLowerCase()) && !e.answer.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const openEdit = (entry: KnowledgeEntry) => {
    setEditing(entry);
    setForm({ agentId: entry.agentId, type: entry.type, question: entry.question, answer: entry.answer });
    setShowModal(true);
  };

  const handleSave = () => {
    if (!form.agentId || !form.question.trim() || !form.answer.trim()) return;
    const agent = agents.find(a => a.id === form.agentId);
    if (!agent) return;

    if (editing) {
      saveKbEntries(kbEntries.map(e => e.id === editing.id
        ? { ...e, ...form, agentName: agent.name, companyName: agent.companyName, updatedAt: new Date().toISOString() }
        : e
      ));
    } else {
      const newEntry: KnowledgeEntry = {
        id: `kb${Date.now()}`,
        agentId: form.agentId,
        agentName: agent.name,
        companyName: agent.companyName,
        type: form.type,
        question: form.question.trim(),
        answer: form.answer.trim(),
        updatedAt: new Date().toISOString()
      };
      saveKbEntries([...kbEntries, newEntry]);
    }
    setShowModal(false);
  };

  const handleDelete = (id: string) => {
    if (!confirm('Delete this knowledge entry?')) return;
    saveKbEntries(kbEntries.filter(e => e.id !== id));
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Knowledge Base</h1>
          <p className="text-muted-foreground mt-1">Training data powering all insurance AI agents — {kbEntries.length} entries total.</p>
        </div>
        <button
          onClick={openAdd}
          className="bg-primary text-primary-foreground px-4 py-2 rounded font-medium hover:bg-primary/90 text-sm"
        >
          + Add Entry
        </button>
      </div>

      <div className="flex gap-3 flex-wrap">
        <input
          type="text"
          placeholder="Search questions or answers..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] bg-input border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <select
          value={filterAgent}
          onChange={e => setFilterAgent(e.target.value)}
          className="bg-input border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">All Agents</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="bg-input border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">All Types</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div className="text-xs text-muted-foreground">
        Showing {filtered.length} of {kbEntries.length} entries
      </div>

      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="bg-card border border-border rounded-lg p-12 text-center text-muted-foreground">
            <p className="text-lg font-medium">No entries found</p>
            <p className="text-sm mt-1">Try adjusting filters or add a new entry.</p>
          </div>
        )}
        {filtered.map(entry => (
          <div key={entry.id} className="bg-card border border-border rounded-lg overflow-hidden">
            <div
              className="flex items-start gap-4 px-5 py-4 cursor-pointer hover:bg-muted/20 transition-colors"
              onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[entry.type]}`}>
                    {TYPE_LABELS[entry.type]}
                  </span>
                  <span className="text-xs text-muted-foreground">{entry.agentName} · {entry.companyName}</span>
                </div>
                <p className="font-medium text-sm">{entry.question}</p>
                {expandedId !== entry.id && (
                  <p className="text-muted-foreground text-xs mt-1 truncate">{entry.answer}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={e => { e.stopPropagation(); openEdit(entry); }}
                  className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted"
                >
                  Edit
                </button>
                <button
                  onClick={e => { e.stopPropagation(); handleDelete(entry.id); }}
                  className="text-xs text-destructive hover:text-destructive/80 px-2 py-1 rounded hover:bg-destructive/10"
                >
                  Delete
                </button>
                <span className="text-muted-foreground text-xs">{expandedId === entry.id ? '▲' : '▼'}</span>
              </div>
            </div>
            {expandedId === entry.id && (
              <div className="border-t border-border px-5 py-4 bg-muted/10">
                <p className="text-sm font-medium text-muted-foreground mb-2">Answer</p>
                <p className="text-sm leading-relaxed">{entry.answer}</p>
                <p className="text-xs text-muted-foreground mt-3">
                  Updated {new Date(entry.updatedAt).toLocaleDateString()}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="px-6 py-4 border-b border-border flex justify-between items-center">
              <h2 className="font-semibold text-lg">{editing ? 'Edit Entry' : 'Add Knowledge Entry'}</h2>
              <button onClick={() => setShowModal(false)} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Agent</label>
                <select
                  required
                  className="w-full bg-input border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  value={form.agentId}
                  onChange={e => setForm(f => ({ ...f, agentId: e.target.value }))}
                >
                  <option value="">Select an agent...</option>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.name} ({a.companyName})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Type</label>
                <select
                  className="w-full bg-input border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  value={form.type}
                  onChange={e => setForm(f => ({ ...f, type: e.target.value as KBType }))}
                >
                  {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Question / Trigger</label>
                <input
                  type="text"
                  className="w-full bg-input border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="e.g. Why did my premium increase?"
                  value={form.question}
                  onChange={e => setForm(f => ({ ...f, question: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Answer / Script</label>
                <textarea
                  rows={5}
                  className="w-full bg-input border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary font-mono"
                  placeholder="Enter the answer the agent should give..."
                  value={form.answer}
                  onChange={e => setForm(f => ({ ...f, answer: e.target.value }))}
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setShowModal(false)} className="px-4 py-2 rounded text-sm font-medium bg-muted hover:bg-muted/80">
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={!form.agentId || !form.question.trim() || !form.answer.trim()}
                  className="px-4 py-2 rounded text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {editing ? 'Save Changes' : 'Add Entry'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
