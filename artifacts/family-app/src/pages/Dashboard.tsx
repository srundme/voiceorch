import React from "react";

export function Dashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Platform Overview</h1>
        <p className="text-muted-foreground">Real-time status of all insurance agents.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="p-6 bg-card border border-border rounded-lg">
          <h3 className="text-sm font-medium text-muted-foreground">Total Agents</h3>
          <p className="text-3xl font-bold mt-2">34</p>
        </div>
        <div className="p-6 bg-card border border-border rounded-lg">
          <h3 className="text-sm font-medium text-muted-foreground">Active Calls (Live)</h3>
          <p className="text-3xl font-bold mt-2 text-primary">1,402</p>
        </div>
        <div className="p-6 bg-card border border-border rounded-lg">
          <h3 className="text-sm font-medium text-muted-foreground">Avg Conversion</h3>
          <p className="text-3xl font-bold mt-2">42.8%</p>
        </div>
      </div>
      
      <div className="h-64 border border-border rounded flex items-center justify-center text-muted-foreground">
        [ Dashboard charts would go here ]
      </div>
    </div>
  );
}
