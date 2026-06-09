import React, { useState } from "react";
import { useLocation } from "wouter";
import { useStore } from "@/lib/store";

export function AgentNew() {
  const [, setLocation] = useLocation();
  const { companies, agents, saveAgents, isLoaded } = useStore();
  
  const [companyId, setCompanyId] = useState("");
  const [name, setName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const company = companies.find(c => c.id === companyId);
    if (!company) return;

    const newAgent = {
      id: `a${Date.now()}`,
      companyId,
      companyName: company.name,
      name,
      status: "draft" as const,
      systemPrompt,
      voiceId: "v1",
      kbEntries: 0,
      totalCalls: 0,
      conversionRate: 0,
      lastUpdated: new Date().toISOString()
    };

    saveAgents([...agents, newAgent]);
    setLocation(`/agents/${newAgent.id}`);
  };

  if (!isLoaded) return null;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold">Create New Agent</h1>
        <p className="text-muted-foreground">Provision a new AI voice agent for an insurance company.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 bg-card border border-border p-6 rounded-lg">
        <div>
          <label className="block text-sm font-medium mb-1">Insurance Company</label>
          <select 
            required
            className="w-full bg-input border border-border rounded px-3 py-2"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
          >
            <option value="">Select a company...</option>
            {companies.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Agent Name</label>
          <input 
            required
            type="text"
            className="w-full bg-input border border-border rounded px-3 py-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sales Renewal Assistant"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">System Prompt</label>
          <textarea 
            required
            rows={5}
            className="w-full bg-input border border-border rounded px-3 py-2 font-mono text-sm"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="You are an AI assistant for..."
          />
        </div>

        <div className="pt-4 border-t border-border flex justify-end">
          <button type="submit" className="bg-primary text-primary-foreground px-4 py-2 rounded font-medium hover:bg-primary/90">
            Create Agent
          </button>
        </div>
      </form>
    </div>
  );
}
