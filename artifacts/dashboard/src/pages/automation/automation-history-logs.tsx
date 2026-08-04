import { useState } from "react";
import { 
  History, 
  Bot, 
  Phone, 
  Video, 
  MessageSquare, 
  CheckCircle2, 
  Clock, 
  ChevronRight, 
  FileText, 
  Search, 
  ExternalLink,
  Zap,
  Users,
  Play,
  X
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";

export type AutomationRun = {
  id: string;
  createdDate: string;
  name: string;
  agentName: string;
  leadCount: number;
  channel: string;
  status: "completed" | "active" | "failed";
  duration: string;
  cost: string;
  logs: Array<{
    id: string;
    leadName: string;
    phone: string;
    stepName: string;
    channel: "call" | "meet" | "whatsapp";
    status: "completed" | "voicemail" | "transferred" | "no_pickup";
    duration: string;
    timestamp: string;
    transcriptSummary?: string;
  }>;
};

export function AutomationHistoryLogs({ agentId }: { agentId?: number }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRun, setSelectedRun] = useState<AutomationRun | null>(null);

  // Sample Execution History Runs
  const [runs] = useState<AutomationRun[]>([
    {
      id: "run-101",
      createdDate: "Jul 27, 2026 20:55:48",
      name: "Departmental_store_AI",
      agentName: "sales",
      leadCount: 42,
      channel: "Web Call / Google Meet",
      status: "completed",
      duration: "7m 28s",
      cost: "₹37.33",
      logs: [
        {
          id: "log-1",
          leadName: "Anand Kumar",
          phone: "+91 98765 43210",
          stepName: "1st Call: Sales Pitch",
          channel: "call",
          status: "completed",
          duration: "2m 14s",
          timestamp: "20:55:50",
          transcriptSummary: "Lead showed high interest in wholesale pricing. Agreed for follow-up.",
        },
        {
          id: "log-2",
          leadName: "Priya Sharma",
          phone: "+91 98123 45678",
          stepName: "1st Call: Sales Pitch",
          channel: "meet",
          status: "completed",
          duration: "3m 45s",
          timestamp: "20:58:10",
          transcriptSummary: "Connected on Google Meet. Sent catalog PDF via WhatsApp.",
        },
        {
          id: "log-3",
          leadName: "Rajesh Patel",
          phone: "+91 97654 32109",
          stepName: "1st Call: Sales Pitch",
          channel: "call",
          status: "voicemail",
          duration: "0m 45s",
          timestamp: "21:02:15",
          transcriptSummary: "Voicemail detected. Left automated voice message.",
        },
      ],
    },
    {
      id: "run-102",
      createdDate: "Aug 02, 2026 14:10:12",
      name: "Monthly_Lead_Sequence",
      agentName: "sales",
      leadCount: 124,
      channel: "AI Voice Call",
      status: "active",
      duration: "14m 10s",
      cost: "₹82.50",
      logs: [
        {
          id: "log-4",
          leadName: "Vikram Singh",
          phone: "+91 99887 76655",
          stepName: "2nd Call: Monthly Offer",
          channel: "call",
          status: "transferred",
          duration: "4m 12s",
          timestamp: "14:10:20",
          transcriptSummary: "Requested human manager transfer. Warm handoff completed.",
        },
        {
          id: "log-5",
          leadName: "Sneha Reddy",
          phone: "+91 91234 56789",
          stepName: "2nd Call: Monthly Offer",
          channel: "call",
          status: "completed",
          duration: "1m 55s",
          timestamp: "14:15:00",
          transcriptSummary: "Confirmed appointment for tomorrow 11 AM.",
        },
      ],
    },
  ]);

  const filteredRuns = runs.filter(
    (r) =>
      r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.agentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.createdDate.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-5 p-6 max-w-6xl mx-auto">
      {/* Header & Filter */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-border/60 pb-4">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <History className="size-4.5 text-amber-500" />
            Automation & Meet Execution History
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Click any row or date to inspect detailed call logs, transcripts, and Google Meet records.
          </p>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50" />
          <Input
            placeholder="Search by date or name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-8.5 text-xs"
          />
        </div>
      </div>

      {/* Execution Logs History Table */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border/70 bg-muted/20 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Execution Log Batches
          </h3>
          <Badge variant="outline" className="text-[10px] text-emerald-500 border-emerald-500/20 bg-emerald-500/10">
            Live History Engine
          </Badge>
        </div>

        <div className="divide-y divide-border/60">
          {filteredRuns.map((run) => (
            <div
              key={run.id}
              onClick={() => setSelectedRun(run)}
              className="flex flex-col md:flex-row items-start md:items-center justify-between p-4 gap-3 hover:bg-muted/30 transition-all cursor-pointer group text-xs"
            >
              {/* Date & Automation Name */}
              <div className="space-y-0.5 min-w-[200px]">
                <p className="font-semibold text-foreground group-hover:text-primary transition-colors flex items-center gap-1.5">
                  {run.createdDate}
                  <ChevronRight className="size-3.5 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
                </p>
                <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Users className="size-3 text-blue-400" /> {run.name} ({run.leadCount} leads)
                </p>
              </div>

              {/* Agent Tag */}
              <div className="shrink-0 flex items-center gap-1.5 bg-muted/30 px-2.5 py-1 rounded-md border border-border/50">
                <Bot className="size-3.5 text-emerald-500" />
                <span className="font-medium text-foreground">{run.agentName}</span>
              </div>

              {/* Channel */}
              <div className="shrink-0 flex items-center gap-1.5 bg-muted/30 px-2.5 py-1 rounded-md border border-border/50">
                <ExternalLink className="size-3 text-purple-400" />
                <span className="text-muted-foreground">{run.channel}</span>
              </div>

              {/* Status */}
              <div className="shrink-0">
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
                    run.status === "completed"
                      ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                      : "bg-blue-500/10 text-blue-500 border-blue-500/20 animate-pulse"
                  }`}
                >
                  <span
                    className={`size-1.5 rounded-full ${
                      run.status === "completed" ? "bg-emerald-500" : "bg-blue-500"
                    }`}
                  />
                  {run.status === "completed" ? "Completed" : "Active Running"}
                </span>
              </div>

              {/* Duration & Cost */}
              <div className="shrink-0 text-right space-y-0.5">
                <p className="font-medium text-foreground">{run.duration}</p>
                <p className="text-[11px] text-muted-foreground font-medium">{run.cost}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detailed Call Logs Drawer / Modal */}
      <Sheet open={selectedRun != null} onOpenChange={(o) => !o && setSelectedRun(null)}>
        <SheetContent className="sm:max-w-2xl overflow-y-auto p-6 space-y-5">
          {selectedRun && (
            <>
              <SheetHeader className="border-b border-border/60 pb-4">
                <div className="flex items-center justify-between">
                  <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">
                    Execution Log #{selectedRun.id}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{selectedRun.createdDate}</span>
                </div>
                <SheetTitle className="text-lg font-bold pt-1">{selectedRun.name}</SheetTitle>
                <SheetDescription className="text-xs">
                  Showing individual lead call logs for agent <strong className="text-foreground">{selectedRun.agentName}</strong>.
                </SheetDescription>
              </SheetHeader>

              {/* Run Metrics Strip */}
              <div className="grid grid-cols-3 gap-3 p-3 bg-muted/20 border border-border/60 rounded-lg text-center text-xs">
                <div>
                  <span className="text-[10px] text-muted-foreground">Leads Dialed</span>
                  <p className="font-bold text-foreground">{selectedRun.leadCount}</p>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground">Total Duration</span>
                  <p className="font-bold text-foreground">{selectedRun.duration}</p>
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground">Total Cost</span>
                  <p className="font-bold text-emerald-500">{selectedRun.cost}</p>
                </div>
              </div>

              {/* Individual Lead Call Logs List */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  Lead Call Records ({selectedRun.logs.length})
                </h4>

                {selectedRun.logs.map((log) => (
                  <div
                    key={log.id}
                    className="p-3.5 rounded-lg border border-border/70 bg-background space-y-2 text-xs hover:border-primary/40 transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {log.channel === "meet" ? (
                          <Video className="size-3.5 text-blue-500" />
                        ) : (
                          <Phone className="size-3.5 text-emerald-500" />
                        )}
                        <span className="font-bold text-foreground">{log.leadName}</span>
                        <span className="text-muted-foreground font-mono text-[11px]">{log.phone}</span>
                      </div>

                      <Badge
                        variant="outline"
                        className={`text-[10px] ${
                          log.status === "completed"
                            ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                            : log.status === "transferred"
                            ? "bg-purple-500/10 text-purple-500 border-purple-500/20"
                            : "bg-amber-500/10 text-amber-500 border-amber-500/20"
                        }`}
                      >
                        {log.status === "completed"
                          ? "Completed"
                          : log.status === "transferred"
                          ? "Transferred"
                          : "Voicemail"}
                      </Badge>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-muted-foreground bg-muted/20 p-2 rounded">
                      <span>Step: <strong className="text-foreground">{log.stepName}</strong></span>
                      <span>{log.duration} @ {log.timestamp}</span>
                    </div>

                    {log.transcriptSummary && (
                      <p className="text-[11px] text-muted-foreground italic pt-1 border-t border-border/40">
                        "{log.transcriptSummary}"
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
