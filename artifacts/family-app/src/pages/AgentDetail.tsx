import React, { useState } from "react";
import { useRoute } from "wouter";
import { useStore, AgentStatus } from "@/lib/store";

const STATUS_FLOW: AgentStatus[] = ['draft', 'training', 'testing', 'approved', 'published'];

export function AgentDetail() {
  const [, params] = useRoute("/agents/:id");
  const { agents, saveAgents, isLoaded } = useStore();
  const [activeTab, setActiveTab] = useState("overview");

  if (!isLoaded || !params) return null;

  const agent = agents.find(a => a.id === params.id);
  if (!agent) return <div>Agent not found</div>;

  const handleStatusChange = (newStatus: AgentStatus) => {
    saveAgents(agents.map(a => a.id === agent.id ? { ...a, status: newStatus } : a));
  };

  const currentIndex = STATUS_FLOW.indexOf(agent.status);
  const nextStatus = currentIndex < STATUS_FLOW.length - 1 ? STATUS_FLOW[currentIndex + 1] : null;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold">{agent.name}</h1>
          <p className="text-muted-foreground">{agent.companyName} • Last updated {new Date(agent.lastUpdated).toLocaleDateString()}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="px-3 py-1 rounded-full text-sm font-medium bg-secondary text-secondary-foreground">
            Status: {agent.status.toUpperCase()}
          </span>
          {nextStatus && (
            <button 
              onClick={() => handleStatusChange(nextStatus)}
              className="bg-primary text-primary-foreground px-4 py-2 rounded text-sm font-medium hover:bg-primary/90"
            >
              Move to {nextStatus.toUpperCase()}
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-4 border-b border-border">
        {['overview', 'knowledge', 'test', 'settings'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-2 px-1 text-sm font-medium capitalize ${activeTab === tab ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {tab.replace('-', ' ')}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-card border border-border p-6 rounded-lg">
            <h3 className="font-bold mb-4">System Prompt</h3>
            <pre className="text-sm bg-muted p-4 rounded whitespace-pre-wrap">{agent.systemPrompt}</pre>
          </div>
          <div className="bg-card border border-border p-6 rounded-lg space-y-4">
            <h3 className="font-bold">Performance Metrics</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-muted-foreground">Total Calls</div>
                <div className="text-2xl font-bold">{agent.totalCalls.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Conversion Rate</div>
                <div className="text-2xl font-bold">{agent.conversionRate}%</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">KB Entries</div>
                <div className="text-2xl font-bold">{agent.kbEntries}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'knowledge' && (
        <div className="bg-card border border-border p-6 rounded-lg">
          <p className="text-muted-foreground mb-4">Knowledge Base management interface would go here.</p>
          <button className="bg-secondary text-secondary-foreground px-4 py-2 rounded text-sm font-medium">
            + Add QA Pair
          </button>
        </div>
      )}
      
      {activeTab === 'test' && (
        <div className="bg-card border border-border h-96 rounded-lg flex items-center justify-center text-muted-foreground">
          [ Interactive Call Simulator ]
        </div>
      )}
    </div>
  );
}
