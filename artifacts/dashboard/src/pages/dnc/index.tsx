import { Ban } from "lucide-react";

export default function DncPage() {
  return (
    <div className="flex flex-col items-center justify-center h-[60vh] gap-3 text-muted-foreground">
      <Ban className="w-10 h-10 opacity-30" />
      <p className="text-sm font-medium">Do Not Call List</p>
      <p className="text-xs opacity-60">Coming in Phase 3 — Queue Management</p>
    </div>
  );
}
