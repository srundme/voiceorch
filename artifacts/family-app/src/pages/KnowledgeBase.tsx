import React from "react";

export function KnowledgeBase() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Global Knowledge Base</h1>
          <p className="text-muted-foreground">Manage training data and policies across all agents.</p>
        </div>
        <button className="bg-primary text-primary-foreground px-4 py-2 rounded font-medium hover:bg-primary/90">
          + Add Entry
        </button>
      </div>

      <div className="bg-card border border-border p-12 text-center rounded-lg text-muted-foreground">
        <p>No knowledge base entries exist yet.</p>
      </div>
    </div>
  );
}
