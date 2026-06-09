import React from "react";

export function Analytics() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Analytics</h1>
        <p className="text-muted-foreground">Platform-wide performance and conversation metrics.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-card border border-border h-64 rounded-lg flex items-center justify-center text-muted-foreground">
          [ Call Volume Chart ]
        </div>
        <div className="bg-card border border-border h-64 rounded-lg flex items-center justify-center text-muted-foreground">
          [ Conversion by Company Chart ]
        </div>
      </div>
    </div>
  );
}
