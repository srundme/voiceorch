import { useState } from "react";
import { 
  FileSpreadsheet, 
  Upload, 
  Plus, 
  Trash2, 
  Phone, 
  MessageSquare, 
  Video, 
  Clock, 
  Play, 
  CheckCircle2, 
  Sparkles,
  Link2,
  Users,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  Zap,
  Bot,
  CalendarDays,
  ExternalLink,
  MoreVertical,
  Edit2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

export type RuleStep = {
  id: string;
  actionType: "call" | "whatsapp" | "meet";
  triggerType: "specific_date" | "delay_days";
  dayValue: string;
  timeOfDay: string;
  promptNote: string;
  selectedAgentId?: number;
};

export type AutomationItem = {
  id: string;
  createdDate: string;
  name: string;
  agentName: string;
  leadCount: number;
  channel: string;
  status: "active" | "completed" | "paused";
  duration: string;
  cost: string;
  nextTrigger: string;
};

function getOrdinalSuffix(i: number) {
  const j = i % 10, k = i % 100;
  if (j === 1 && k !== 11) return `${i}st`;
  if (j === 2 && k !== 12) return `${i}nd`;
  if (j === 3 && k !== 13) return `${i}rd`;
  return `${i}th`;
}

export function SequenceRulesPanel({ 
  agents = [], 
  agentId, 
  agentName 
}: { 
  agents?: any[]; 
  agentId: number; 
  agentName?: string 
}) {
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<"list" | "create">("list");
  const [step, setStep] = useState<1 | 2>(1); // 1 = Lead Source, 2 = Call Schedule Rules
  
  const [sheetUrl, setSheetUrl] = useState("");
  const [autoSync, setAutoSync] = useState(true);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [activeTab, setActiveTab] = useState("sheet");

  // Saved Automations List
  const [automations, setAutomations] = useState<AutomationItem[]>([
    {
      id: "auto-1",
      createdDate: "Jul 27, 2026 20:55:48",
      name: "Departmental_store_AI",
      agentName: agentName || "sales",
      leadCount: 420,
      channel: "Web Call / Google Meet",
      status: "completed",
      duration: "7m 28s",
      cost: "₹37.33",
      nextTrigger: "Aug 21 @ 10:00 AM",
    },
    {
      id: "auto-2",
      createdDate: "Aug 02, 2026 14:10:12",
      name: "Monthly_Lead_Sequence",
      agentName: agentName || "sales",
      leadCount: 1248,
      channel: "AI Voice Call",
      status: "active",
      duration: "14m 10s",
      cost: "₹82.50",
      nextTrigger: "Aug 30 @ 11:30 AM",
    },
  ]);

  // Preset default rules with exact calendar dates
  const [rules, setRules] = useState<RuleStep[]>([
    {
      id: "rule-1",
      actionType: "call",
      triggerType: "specific_date",
      dayValue: "2026-08-21",
      timeOfDay: "10:00 AM",
      promptNote: "1st Follow-up Call (Sales Pitch)",
      selectedAgentId: agentId,
    },
    {
      id: "rule-2",
      actionType: "call",
      triggerType: "specific_date",
      dayValue: "2026-08-30",
      timeOfDay: "11:30 AM",
      promptNote: "2nd Follow-up Call (Monthly Offer)",
      selectedAgentId: agentId,
    },
    {
      id: "rule-3",
      actionType: "meet",
      triggerType: "specific_date",
      dayValue: "2026-09-04",
      timeOfDay: "04:00 AM",
      promptNote: "3rd Call: Wake-up Call + Google Meet Invite",
      selectedAgentId: agentId,
    },
  ]);

  const addRule = () => {
    const nextCallNum = rules.length + 1;
    const today = new Date().toISOString().split("T")[0];
    const newRule: RuleStep = {
      id: `rule-${Date.now()}`,
      actionType: "call",
      triggerType: "specific_date",
      dayValue: today,
      timeOfDay: "09:00 AM",
      promptNote: `${getOrdinalSuffix(nextCallNum)} Call Follow-up`,
      selectedAgentId: agentId,
    };
    setRules([...rules, newRule]);
  };

  const removeRule = (id: string) => {
    setRules(rules.filter((r) => r.id !== id));
  };

  const updateRule = (id: string, patch: Partial<RuleStep>) => {
    setRules(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  // Called when user clicks "Save & Activate Sequence"
  const handleSaveAutomation = () => {
    const newAuto: AutomationItem = {
      id: `auto-${Date.now()}`,
      createdDate: new Date().toLocaleString("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }),
      name: `${agentName || "Agent"}_Automation_${automations.length + 1}`,
      agentName: agentName || "sales",
      leadCount: csvFile ? 150 : 1248,
      channel: rules[0]?.actionType === "meet" ? "Google Meet Call" : "AI Voice Call",
      status: "active",
      duration: "Just Started",
      cost: "₹0.00",
      nextTrigger: `${rules[0]?.dayValue || "Aug 21"} @ ${rules[0]?.timeOfDay || "10:00 AM"}`,
    };

    setAutomations([newAuto, ...automations]);
    setViewMode("list"); // Redirect back to table view!

    toast({
      title: "Automation Saved & Activated! 🚀",
      description: `Automation sequence is now active in your dashboard table below.`,
    });
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* MODE 1: AUTOMATIONS TABLE LIST (Default View) */}
      {viewMode === "list" && (
        <div className="space-y-6">
          {/* Header Action Bar */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-card border border-border/80 p-5 rounded-xl shadow-sm">
            <div>
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Sparkles className="size-4.5 text-amber-500" />
                Active Automation Sequences
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Manage your scheduled AI call sequences, Google Sheet integrations, and execution logs.
              </p>
            </div>

            <Button onClick={() => { setStep(1); setViewMode("create"); }} className="gap-2 text-xs h-9 px-4">
              <Plus className="size-4" />
              + New Automation
            </Button>
          </div>

          {/* Stat Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
            <div className="p-4 rounded-xl border border-border/80 bg-card/60 backdrop-blur-sm shadow-sm space-y-1">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-[11px] font-medium uppercase tracking-wider">Total Enrolled Leads</span>
                <Users className="size-3.5 text-blue-500" />
              </div>
              <p className="text-xl font-bold tracking-tight">1,668</p>
              <p className="text-[10px] text-emerald-500 font-medium flex items-center gap-1">
                <CheckCircle2 className="size-2.5" /> Live Sync Active
              </p>
            </div>

            <div className="p-4 rounded-xl border border-border/80 bg-card/60 backdrop-blur-sm shadow-sm space-y-1">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-[11px] font-medium uppercase tracking-wider">Active Automations</span>
                <Zap className="size-3.5 text-amber-500" />
              </div>
              <p className="text-xl font-bold tracking-tight">{automations.length} Active</p>
              <p className="text-[10px] text-muted-foreground font-medium">Running Sequences</p>
            </div>

            <div className="p-4 rounded-xl border border-border/80 bg-card/60 backdrop-blur-sm shadow-sm space-y-1">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-[11px] font-medium uppercase tracking-wider">Next Scheduled Call</span>
                <Clock className="size-3.5 text-purple-500" />
              </div>
              <p className="text-xl font-bold tracking-tight">Aug 21 @ 10:00 AM</p>
              <p className="text-[10px] text-purple-400 font-medium">Rule #1 Trigger</p>
            </div>

            <div className="p-4 rounded-xl border border-border/80 bg-card/60 backdrop-blur-sm shadow-sm space-y-1">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-[11px] font-medium uppercase tracking-wider">Assigned Agent</span>
                <Bot className="size-3.5 text-emerald-500" />
              </div>
              <p className="text-sm font-bold truncate">{agentName || `Agent #${agentId}`}</p>
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-500 font-medium">
                <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" /> Ready & Live
              </span>
            </div>
          </div>

          {/* Automations Table (Matching User's 2nd Screenshot) */}
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="p-4 border-b border-border/70 bg-muted/20 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Deployed Automations & Execution History
              </h3>
              <Badge variant="outline" className="text-[10px] text-emerald-500 border-emerald-500/20 bg-emerald-500/10">
                Live Auto-Dialing Engine
              </Badge>
            </div>

            <div className="divide-y divide-border/60">
              {automations.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col md:flex-row items-start md:items-center justify-between p-4 gap-3 hover:bg-muted/10 transition-colors text-xs"
                >
                  {/* Left Info: Date & Automation Name */}
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="space-y-0.5">
                      <p className="font-semibold text-foreground">{item.createdDate}</p>
                      <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Users className="size-3 text-blue-400" /> {item.name}
                      </p>
                    </div>
                  </div>

                  {/* Agent Tag */}
                  <div className="shrink-0 flex items-center gap-1.5 bg-muted/30 px-2.5 py-1 rounded-md border border-border/50">
                    <Bot className="size-3.5 text-emerald-500" />
                    <span className="font-medium text-foreground">{item.agentName}</span>
                  </div>

                  {/* Channel Tag */}
                  <div className="shrink-0 flex items-center gap-1.5 bg-muted/30 px-2.5 py-1 rounded-md border border-border/50">
                    <ExternalLink className="size-3 text-purple-400" />
                    <span className="text-muted-foreground">{item.channel}</span>
                  </div>

                  {/* Status Badge */}
                  <div className="shrink-0">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
                        item.status === "completed"
                          ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                          : "bg-blue-500/10 text-blue-500 border-blue-500/20 animate-pulse"
                      }`}
                    >
                      <span
                        className={`size-1.5 rounded-full ${
                          item.status === "completed" ? "bg-emerald-500" : "bg-blue-500"
                        }`}
                      />
                      {item.status === "completed" ? "Completed" : "Active Running"}
                    </span>
                  </div>

                  {/* Duration & Cost */}
                  <div className="shrink-0 text-right space-y-0.5">
                    <p className="font-medium text-foreground">{item.duration}</p>
                    <p className="text-[11px] text-muted-foreground font-medium">{item.cost}</p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 text-muted-foreground hover:text-foreground"
                      onClick={() => { setStep(1); setViewMode("create"); }}
                    >
                      <Edit2 className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 text-muted-foreground hover:text-destructive"
                      onClick={() => setAutomations(automations.filter((a) => a.id !== item.id))}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODE 2: 2-STEP AUTOMATION CREATION WIZARD */}
      {viewMode === "create" && (
        <div className="space-y-6">
          {/* Header Bar */}
          <div className="flex items-center justify-between border-b border-border/60 pb-3">
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setViewMode("list")}
                className="gap-1.5 text-xs h-8 text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="size-3.5" />
                Back to Automations Table
              </Button>

              <div className="h-4 w-px bg-border" />

              <button
                onClick={() => setStep(1)}
                className={`flex items-center gap-2 text-xs font-semibold px-3 py-1 rounded-full transition-all ${
                  step === 1 ? "bg-primary text-primary-foreground shadow-sm" : "bg-muted/40 text-muted-foreground hover:bg-muted"
                }`}
              >
                <span className="size-4 rounded-full bg-background/20 text-current text-[10px] flex items-center justify-center font-bold">1</span>
                Step 1: Upload Leads
              </button>
              <ArrowRight className="size-3 text-muted-foreground/60" />
              <button
                onClick={() => setStep(2)}
                className={`flex items-center gap-2 text-xs font-semibold px-3 py-1 rounded-full transition-all ${
                  step === 2 ? "bg-primary text-primary-foreground shadow-sm" : "bg-muted/40 text-muted-foreground hover:bg-muted"
                }`}
              >
                <span className="size-4 rounded-full bg-background/20 text-current text-[10px] flex items-center justify-center font-bold">2</span>
                Step 2: Schedule & Rules
              </button>
            </div>
          </div>

          {/* STEP 1: Overview & Lead Source Upload */}
          {step === 1 && (
            <div className="space-y-6">
              <div className="rounded-xl border border-border bg-card p-5 space-y-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <FileSpreadsheet className="size-4 text-emerald-500" />
                      Lead Source (Google Sheet / CSV File)
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Upload your lead list once. You can pick exact calendar dates for the 1st call, 2nd call, and 3rd call.
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[10px] gap-1 bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                    <ShieldCheck className="size-3" /> Auto-De-duplication On
                  </Badge>
                </div>

                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                  <TabsList className="grid w-full grid-cols-2 max-w-xs mb-4 h-9 p-1">
                    <TabsTrigger value="sheet" className="text-xs gap-1.5">
                      <Link2 className="size-3 text-blue-500" /> Google Sheet Sync
                    </TabsTrigger>
                    <TabsTrigger value="csv" className="text-xs gap-1.5">
                      <Upload className="size-3 text-purple-500" /> Upload CSV File
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="sheet" className="space-y-3 mt-0">
                    <div className="space-y-2 border border-border/60 rounded-lg p-4 bg-muted/10">
                      <Label className="text-xs font-semibold flex items-center gap-1.5">
                        Live Google Sheet Link
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          placeholder="https://docs.google.com/spreadsheets/d/..."
                          value={sheetUrl}
                          onChange={(e) => setSheetUrl(e.target.value)}
                          className="h-9 text-xs"
                        />
                        <Button size="sm" className="h-9 text-xs shrink-0 gap-1.5">
                          <Zap className="size-3.5" /> Connect Sheet
                        </Button>
                      </div>
                      <div className="flex items-center justify-between pt-2">
                        <span className="text-[11px] text-muted-foreground">
                          Automatically poll & dial newly added rows every hour
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium">Auto-Sync</span>
                          <Switch checked={autoSync} onCheckedChange={setAutoSync} />
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="csv" className="space-y-3 mt-0">
                    <div className="border-2 border-dashed border-border/80 rounded-lg p-6 text-center hover:bg-muted/20 transition-all cursor-pointer relative">
                      <input
                        type="file"
                        accept=".csv"
                        className="absolute inset-0 opacity-0 cursor-pointer"
                        onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                      />
                      <Upload className="size-6 text-purple-500 mx-auto mb-2" />
                      <p className="text-xs font-medium">
                        {csvFile ? `Selected: ${csvFile.name}` : "Click or drag & drop lead CSV file here"}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Required columns: <code className="bg-muted px-1 rounded text-[10px]">phone</code>, <code className="bg-muted px-1 rounded text-[10px]">name</code>
                      </p>
                    </div>
                  </TabsContent>
                </Tabs>

                {/* Next Button */}
                <div className="flex justify-end pt-3 border-t border-border/60">
                  <Button onClick={() => setStep(2)} className="gap-2 text-xs h-9 px-5">
                    Next: Assign Agent & Set Call Schedule
                    <ArrowRight className="size-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Multi-Agent Date & Time Schedule Configurator */}
          {step === 2 && (
            <div className="rounded-xl border border-border bg-card p-6 space-y-6 shadow-sm">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-border/60 pb-4">
                <div>
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <CalendarDays className="size-4 text-emerald-500" />
                    Call Schedule (1st Call, 2nd Call, 3rd Call...)
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Assign an AI Agent and set the exact calendar date & time for each call.
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={addRule} className="gap-1.5 text-xs h-8">
                  <Plus className="size-3.5" />
                  + Add Next Call
                </Button>
              </div>

              {/* Rules List */}
              <div className="space-y-4">
                {rules.map((rule, index) => {
                  const callOrdinal = getOrdinalSuffix(index + 1);
                  const currentAgentId = rule.selectedAgentId || agentId;
                  const selectedAgentObj = agents.find((a) => a.id === currentAgentId);
                  const currentAgentName = selectedAgentObj?.name || (currentAgentId === agentId ? (agentName || `Agent #${agentId}`) : `Agent #${currentAgentId}`);

                  return (
                    <div
                      key={rule.id}
                      className="rounded-xl border border-border/80 bg-background p-4.5 space-y-4 shadow-xs hover:border-primary/40 transition-all"
                    >
                      {/* Card Header Bar */}
                      <div className="flex items-center justify-between border-b border-border/50 pb-3">
                        <div className="flex items-center gap-2.5">
                          <Badge className="bg-primary/10 text-primary border-primary/20 text-xs px-2.5 py-0.5 font-bold">
                            {callOrdinal} Call
                          </Badge>
                          <span className="text-xs text-muted-foreground font-medium">
                            Assigned Agent: <strong className="text-foreground">{currentAgentName}</strong>
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[11px] gap-1 font-normal bg-muted/30">
                            {rule.actionType === "call" ? "📞 AI Phone Call" : rule.actionType === "meet" ? "🎥 Google Meet Call" : "💬 WhatsApp"}
                          </Badge>

                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7 text-muted-foreground hover:text-destructive shrink-0"
                            onClick={() => removeRule(rule.id)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </div>

                      {/* Card Inputs Grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                        <div className="space-y-1.5">
                          <Label className="text-[11px] text-muted-foreground font-medium">Select Agent</Label>
                          <Select
                            value={String(currentAgentId)}
                            onValueChange={(v) => updateRule(rule.id, { selectedAgentId: Number(v) })}
                          >
                            <SelectTrigger className="h-9 text-xs font-medium bg-muted/20">
                              <SelectValue placeholder="Select Agent" />
                            </SelectTrigger>
                            <SelectContent>
                              {agents.length > 0 ? (
                                agents.map((a) => (
                                  <SelectItem key={a.id} value={String(a.id)} className="text-xs">
                                    {a.name || `Agent #${a.id}`}
                                  </SelectItem>
                                ))
                              ) : (
                                <SelectItem value={String(agentId)} className="text-xs">
                                  {agentName || `Agent #${agentId}`}
                                </SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-[11px] text-muted-foreground font-medium">Action Type</Label>
                          <Select
                            value={rule.actionType}
                            onValueChange={(v) => updateRule(rule.id, { actionType: v as any })}
                          >
                            <SelectTrigger className="h-9 text-xs bg-muted/20">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="call" className="text-xs">📞 AI Phone Call</SelectItem>
                              <SelectItem value="whatsapp" className="text-xs">💬 WhatsApp Msg</SelectItem>
                              <SelectItem value="meet" className="text-xs">🎥 Google Meet Call</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-[11px] text-muted-foreground font-medium">Calendar Date</Label>
                          <Input
                            type="date"
                            value={rule.dayValue}
                            onChange={(e) => updateRule(rule.id, { dayValue: e.target.value })}
                            className="h-9 text-xs bg-muted/20"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-[11px] text-muted-foreground font-medium">Time Window</Label>
                          <Input
                            type="text"
                            value={rule.timeOfDay}
                            onChange={(e) => updateRule(rule.id, { timeOfDay: e.target.value })}
                            placeholder="e.g. 10:00 AM"
                            className="h-9 text-xs bg-muted/20"
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5 pt-1">
                        <Label className="text-[11px] text-muted-foreground font-medium">Call Goal / Prompt Note</Label>
                        <Input
                          type="text"
                          value={rule.promptNote}
                          onChange={(e) => updateRule(rule.id, { promptNote: e.target.value })}
                          placeholder="Goal of this call"
                          className="h-9 text-xs bg-muted/20"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Bottom Navigation & Save */}
              <div className="flex items-center justify-between pt-4 border-t border-border/60">
                <Button size="sm" variant="outline" onClick={() => setStep(1)} className="gap-1.5 text-xs h-9">
                  <ArrowLeft className="size-3.5" />
                  Back to Upload Leads
                </Button>

                <Button onClick={handleSaveAutomation} className="gap-2 text-xs h-9 px-5 bg-white text-black hover:bg-slate-200 font-semibold shadow-md">
                  <Play className="size-3.5 fill-current" />
                  Save & Activate Sequence
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
