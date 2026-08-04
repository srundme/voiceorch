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
  Bot
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
  triggerType: "day_of_month" | "delay_days";
  dayValue: number;
  timeOfDay: string;
  promptNote: string;
};

export function SequenceRulesPanel({ agentId, agentName }: { agentId: number; agentName?: string }) {
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2>(1); // 1 = Lead Source, 2 = Rules
  const [sheetUrl, setSheetUrl] = useState("");
  const [autoSync, setAutoSync] = useState(true);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [activeTab, setActiveTab] = useState("sheet");

  // Preset default rules
  const [rules, setRules] = useState<RuleStep[]>([
    {
      id: "rule-1",
      actionType: "call",
      triggerType: "day_of_month",
      dayValue: 21,
      timeOfDay: "10:00 AM",
      promptNote: "AI Sales Follow-up Call",
    },
    {
      id: "rule-2",
      actionType: "call",
      triggerType: "day_of_month",
      dayValue: 30,
      timeOfDay: "11:30 AM",
      promptNote: "Monthly Reminder AI Call",
    },
    {
      id: "rule-3",
      actionType: "meet",
      triggerType: "day_of_month",
      dayValue: 4,
      timeOfDay: "04:00 AM",
      promptNote: "Early Morning Wake-up Call + Google Meet Briefing",
    },
  ]);

  const addRule = () => {
    const newRule: RuleStep = {
      id: `rule-${Date.now()}`,
      actionType: "call",
      triggerType: "day_of_month",
      dayValue: 1,
      timeOfDay: "09:00 AM",
      promptNote: "AI Follow-up Call",
    };
    setRules([...rules, newRule]);
  };

  const removeRule = (id: string) => {
    setRules(rules.filter((r) => r.id !== id));
  };

  const updateRule = (id: string, patch: Partial<RuleStep>) => {
    setRules(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const handleSaveAutomation = () => {
    toast({
      title: "Automation Sequence Deployed! 🚀",
      description: `Active rules configured for ${agentName || "Agent"}. Leads will be called automatically on scheduled days.`,
    });
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Wizard Progress Indicator */}
      <div className="flex items-center justify-between border-b border-border/60 pb-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setStep(1)}
            className={`flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full transition-all ${
              step === 1 ? "bg-primary text-primary-foreground shadow-sm" : "bg-muted/40 text-muted-foreground hover:bg-muted"
            }`}
          >
            <span className="size-4 rounded-full bg-background/20 text-current text-[10px] flex items-center justify-center font-bold">1</span>
            Step 1: Lead Source
          </button>
          <ArrowRight className="size-3.5 text-muted-foreground/60" />
          <button
            onClick={() => setStep(2)}
            className={`flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full transition-all ${
              step === 2 ? "bg-primary text-primary-foreground shadow-sm" : "bg-muted/40 text-muted-foreground hover:bg-muted"
            }`}
          >
            <span className="size-4 rounded-full bg-background/20 text-current text-[10px] flex items-center justify-center font-bold">2</span>
            Step 2: Rules & Schedule
          </button>
        </div>

        <Badge variant="outline" className="text-[11px] gap-1.5 font-normal">
          <Bot className="size-3 text-emerald-500" />
          {agentName || `Agent #${agentId}`}
        </Badge>
      </div>

      {/* STEP 1: Overview & Lead Source Upload */}
      {step === 1 && (
        <div className="space-y-6">
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
            <div className="p-4 rounded-xl border border-border/80 bg-card/60 backdrop-blur-sm shadow-sm space-y-1">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-[11px] font-medium uppercase tracking-wider">Enrolled Leads</span>
                <Users className="size-3.5 text-blue-500" />
              </div>
              <p className="text-xl font-bold tracking-tight">1,248</p>
              <p className="text-[10px] text-emerald-500 font-medium flex items-center gap-1">
                <CheckCircle2 className="size-2.5" /> 98.4% Sync Active
              </p>
            </div>

            <div className="p-4 rounded-xl border border-border/80 bg-card/60 backdrop-blur-sm shadow-sm space-y-1">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-[11px] font-medium uppercase tracking-wider">Active Rules</span>
                <Sparkles className="size-3.5 text-amber-500" />
              </div>
              <p className="text-xl font-bold tracking-tight">{rules.length} Rules</p>
              <p className="text-[10px] text-muted-foreground font-medium">Configured</p>
            </div>

            <div className="p-4 rounded-xl border border-border/80 bg-card/60 backdrop-blur-sm shadow-sm space-y-1">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-[11px] font-medium uppercase tracking-wider">Next Trigger</span>
                <Clock className="size-3.5 text-purple-500" />
              </div>
              <p className="text-xl font-bold tracking-tight">4th @ 04:00 AM</p>
              <p className="text-[10px] text-purple-400 font-medium">Wake-up & Google Meet</p>
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

          {/* Lead Source Input Box */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <FileSpreadsheet className="size-4 text-emerald-500" />
                  Lead Source & Upload Channel
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Upload your lead CSV file or paste a live Google Sheet URL.
                </p>
              </div>
              <Badge variant="outline" className="text-[10px] gap-1 bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                <ShieldCheck className="size-3" /> Auto-De-duplication On
              </Badge>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid w-full grid-cols-2 max-w-xs mb-4 h-9 p-1">
                <TabsTrigger value="sheet" className="text-xs gap-1.5">
                  <Link2 className="size-3 text-blue-500" /> Google Sheet
                </TabsTrigger>
                <TabsTrigger value="csv" className="text-xs gap-1.5">
                  <Upload className="size-3 text-purple-500" /> CSV Upload
                </TabsTrigger>
              </TabsList>

              <TabsContent value="sheet" className="space-y-3 mt-0">
                <div className="space-y-2 border border-border/60 rounded-lg p-4 bg-muted/10">
                  <Label className="text-xs font-semibold flex items-center gap-1.5">
                    Live Google Sheet URL
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
                Next: Configure Rules
                <ArrowRight className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 2: Super Clean, Simple Rules Configurator */}
      {step === 2 && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-5 shadow-sm">
          <div className="flex items-center justify-between border-b border-border/60 pb-3">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Sparkles className="size-4 text-amber-500" />
                Automated Schedule Rules
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Set when to call or connect Google Meet for your imported leads.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={addRule} className="gap-1.5 text-xs h-8">
              <Plus className="size-3.5" />
              Add Rule
            </Button>
          </div>

          {/* Simple Clean Rules Table/List */}
          <div className="space-y-2.5">
            {rules.map((rule, index) => (
              <div
                key={rule.id}
                className="flex flex-col md:flex-row items-center gap-2.5 p-3 rounded-lg border border-border/70 bg-background hover:border-primary/40 transition-all text-xs"
              >
                {/* Rule Number */}
                <span className="size-6 rounded-full bg-primary/10 text-primary font-bold text-xs flex items-center justify-center shrink-0">
                  {index + 1}
                </span>

                {/* Action Type */}
                <div className="w-full md:w-40 shrink-0">
                  <Select
                    value={rule.actionType}
                    onValueChange={(v) => updateRule(rule.id, { actionType: v as any })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="call" className="text-xs">
                        <div className="flex items-center gap-1.5">
                          <Phone className="size-3 text-emerald-500" /> AI Phone Call
                        </div>
                      </SelectItem>
                      <SelectItem value="whatsapp" className="text-xs">
                        <div className="flex items-center gap-1.5">
                          <MessageSquare className="size-3 text-purple-500" /> WhatsApp Msg
                        </div>
                      </SelectItem>
                      <SelectItem value="meet" className="text-xs">
                        <div className="flex items-center gap-1.5">
                          <Video className="size-3 text-blue-500" /> Google Meet Call
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Schedule Type */}
                <div className="w-full md:w-36 shrink-0">
                  <Select
                    value={rule.triggerType}
                    onValueChange={(v) => updateRule(rule.id, { triggerType: v as any })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="day_of_month" className="text-xs">Day of Month</SelectItem>
                      <SelectItem value="delay_days" className="text-xs">Days After Upload</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Day Input */}
                <div className="w-full md:w-20 shrink-0 flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground md:hidden">Day:</span>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={rule.dayValue}
                    onChange={(e) => updateRule(rule.id, { dayValue: Number(e.target.value) })}
                    placeholder="Day"
                    className="h-8 text-xs text-center"
                  />
                </div>

                {/* Time Input */}
                <div className="w-full md:w-24 shrink-0 flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground md:hidden">Time:</span>
                  <Input
                    type="text"
                    value={rule.timeOfDay}
                    onChange={(e) => updateRule(rule.id, { timeOfDay: e.target.value })}
                    placeholder="Time"
                    className="h-8 text-xs text-center"
                  />
                </div>

                {/* Goal / Note */}
                <div className="w-full md:flex-1">
                  <Input
                    type="text"
                    value={rule.promptNote}
                    onChange={(e) => updateRule(rule.id, { promptNote: e.target.value })}
                    placeholder="Rule goal (e.g. Sales follow up)"
                    className="h-8 text-xs bg-muted/20"
                  />
                </div>

                {/* Delete */}
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => removeRule(rule.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>

          {/* Bottom Navigation & Save */}
          <div className="flex items-center justify-between pt-4 border-t border-border/60">
            <Button size="sm" variant="outline" onClick={() => setStep(1)} className="gap-1.5 text-xs h-9">
              <ArrowLeft className="size-3.5" />
              Back to Lead Source
            </Button>

            <Button onClick={handleSaveAutomation} className="gap-2 text-xs h-9 px-5">
              <Play className="size-3.5 fill-current" />
              Save & Activate Sequence
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
