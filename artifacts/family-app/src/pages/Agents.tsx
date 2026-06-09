import React from "react";
import { Link } from "wouter";
import { useStore, AgentStatus } from "@/lib/store";

const STATUS_COLORS: Record<AgentStatus, string> = {
  draft: "bg-gray-100 text-gray-800 border-gray-200",
  training: "bg-blue-100 text-blue-800 border-blue-200",
  testing: "bg-yellow-100 text-yellow-800 border-yellow-200",
  approved: "bg-purple-100 text-purple-800 border-purple-200",
  published: "bg-green-100 text-green-800 border-green-200",
};

export function Agents() {
  const { agents, isLoaded } = useStore();

  if (!isLoaded) return null;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Agents</h1>
          <p className="text-muted-foreground">Manage AI voice agents across all companies.</p>
        </div>
        <Link href="/agents/new" className="bg-primary text-primary-foreground px-4 py-2 rounded font-medium hover:bg-primary/90">
          + New Agent
        </Link>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="px-6 py-3 font-medium">Company</th>
              <th className="px-6 py-3 font-medium">Agent Name</th>
              <th className="px-6 py-3 font-medium">Status</th>
              <th className="px-6 py-3 font-medium">Calls</th>
              <th className="px-6 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {agents.map(agent => (
              <tr key={agent.id} className="hover:bg-muted/30">
                <td className="px-6 py-4 font-medium">{agent.companyName}</td>
                <td className="px-6 py-4">{agent.name}</td>
                <td className="px-6 py-4">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${STATUS_COLORS[agent.status]}`}>
                    {agent.status.toUpperCase()}
                  </span>
                </td>
                <td className="px-6 py-4">{agent.totalCalls.toLocaleString()}</td>
                <td className="px-6 py-4 text-right space-x-2">
                  <Link href={`/agents/${agent.id}`} className="text-primary hover:underline">
                    Manage
                  </Link>
                </td>
              </tr>
            ))}
            {agents.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                  No agents found. Create one to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
