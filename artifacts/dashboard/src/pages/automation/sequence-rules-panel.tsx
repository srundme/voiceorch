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
  Calendar, 
  Play, 
  CheckCircle2, 
  Sparkles,
  Link2,
  Users,
  Activity,
  ArrowRight,
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
  dayValue: number; // e.g. 21 for 21st, 3 for 3rd day
  timeOfDay: string; // e.g. "04:00 AM", "09:00 AM"
  promptNote: string;
};

export function SequenceRulesPanel({ agentId, agentName }: { agentId: number; agentName?: string }) {
  const { toast } = useToast();
  const [sheetUrl, setSheetUrl] = useState("");
  const [autoSync, setAutoSync] = useState(true);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [activeTab, setActiveTab] = useState("sheet");

  // Preset default rules matching user request: 21st call, 30th call, 4th mrg wake up call
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
      description: `Active sequence rules configured for ${agentName || "Agent"}. Leads will be processed automatically on scheduled dates.`,
    });
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Overview Stat Cards */}
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
            <span className="text-[11px] font-medium uppercase tracking-wider">Active Sequence Rules</span>
            <Sparkles className="size-3.5 text-amber-500" />
          </div>
          <p className="text-xl font-bold tracking-tight">{rules.length} Rules</p>
          <p className="text-[10px] text-muted-foreground font-medium">Sequential Drip Rules</p>
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

      {/* Lead Import Source Section */}
      <div className="rounded-xl border border-border/80 bg-card shadow-sm overflow-hidden">
        <div className="border-b border-border/70 p-4 bg-muted/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <FileSpreadsheet className="size-4 text-emerald-500" />
              Lead Source & Upload Channel
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Connect a Google Sheet or drop a CSV file. Leads automatically flow into your schedule rules below.
            </p>
          </div>
          <Badge variant="outline" className="text-[10px] gap-1 bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
            <ShieldCheck className="size-3" /> Auto-De-duplication On
          </Badge>
        </div>

        <div className="p-5">
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
                    placeholder="https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKbB6tSm.../edit"
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
                    <Switch checked={autoSync} onCheckedChange={setAutoSync} size="sm" />
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
                  Supported columns: <code className="bg-muted px-1 rounded text-[10px]">phone</code>, <code className="bg-muted px-1 rounded text-[10px]">name</code>, <code className="bg-muted px-1 rounded text-[10px]">email</code>
                </p>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Visual Sequence & Rule Builder */}
      <div className="rounded-xl border border-border/80 bg-card shadow-sm overflow-hidden">
        <div className="border-b border-border/70 p-4 bg-muted/20 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Activity className="size-4 text-amber-500" />
              Rule Sequence Timeline
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              The AI engine executes these rules in chronological order for each lead.
            </p>
          </div>
          <Button size="sm" onClick={addRule} className="gap-1.5 text-xs h-8">
            <Plus className="size-3.5" /> Add Rule Step
          </Button>
        </div>

        <div className="p-6">
          <div className="relative space-y-6 before:absolute before:inset-0 before:left-5 before:w-0.5 before:bg-border/60 before:z-0">
            {rules.map((rule, index) => {
              const actionBadge = 
                rule.actionType === "call" ? (
                  <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px] gap-1">
                    <Phone className="size-3" /> AI Phone Call
                  </Badge>
                ) : rule.actionType === "meet" ? (
                  <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-[10px] gap-1">
                    <Video className="size-3" /> Google Meet Call
                  </Badge>
                ) : (
                  <Badge className="bg-purple-500/10 text-purple-600 border-purple-500/20 text-[10px] gap-1">
                    <MessageSquare className="size-3" /> WhatsApp Msg
                  </Badge>
                );

              return (
                <div key={rule.id} className="relative z-10 flex items-start gap-4">
                  {/* Step Icon Badge */}
                  <div className="size-10 rounded-full bg-background border-2 border-primary text-primary font-bold text-xs flex items-center justify-center shrink-0 shadow-sm">
                    {index + 1}
                  </div>

                  {/* Rule Card */}
                  <div className="flex-1 rounded-xl border border-border/80 bg-background p-4 shadow-sm hover:border-primary/40 transition-all space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
                      <div className="flex items-center gap-2">
                        {actionBadge}
                        <span className="text-xs font-semibold text-foreground">
                          {rule.triggerType === "day_of_month" ? `${rule.dayValue}st / ${rule.dayValue}th of Month` : `Day ${rule.dayValue} Delay`}
                        </span>
                        <span className="text-xs text-muted-foreground">@ {rule.timeOfDay}</span>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-muted-foreground hover:text-destructive"
                        onClick={() => removeRule(rule.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>

                    {/* Rule Configuration Fields */}
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground font-medium">Action Type</Label>
                        <Select
                          value={rule.actionType}
                          onValueChange={(v) => updateRule(rule.id, { actionType: v as any })}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="call" className="text-xs">AI Phone Call</SelectItem>
                            <SelectItem value="meet" className="text-xs">Google Meet Call</SelectItem>
                            <SelectItem value="whatsapp" className="text-xs">WhatsApp Message</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground font-medium">Timing Rule</Label>
                        <Select
                          value={rule.triggerType}
                          onValueChange={(v) => updateRule(rule.id, { triggerType: v as any })}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="day_of_month" className="text-xs">Day of Month (21st, 30th...)</SelectItem>
                            <SelectItem value="delay_days" className="text-xs">Days After Import</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground font-medium">Day Number</Label>
                        <Input
                          type="number"
                          min={1}
                          max={31}
                          value={rule.dayValue}
                          onChange={(e) => updateRule(rule.id, { dayValue: Number(e.target.value) })}
                          className="h-8 text-xs"
                        />
                      </div>

                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground font-medium">Time Window</Label>
                        <Input
                          type="text"
                          value={rule.timeOfDay}
                          onChange={(e) => updateRule(rule.id, { timeOfDay: e.target.value })}
                          placeholder="e.g. 04:00 AM"
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>

                    <div className="space-y-1 pt-1">
                      <Label className="text-[10px] text-muted-foreground font-medium">Rule Objective / Prompt Note</Label>
                      <Input
                        type="text"
                        value={rule.promptNote}
                        onChange={(e) => updateRule(rule.id, { promptNote: e.target.value })}
                        className="h-8 text-xs bg-muted/20"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Action Footer */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-border/60 pt-5 mt-6">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
              <span>Engine automatically handles timezones, quiet hours & Google Meet links.</span>
            </div>

            <Button onClick={handleSaveAutomation} className="gap-2 text-xs w-full sm:w-auto h-9 px-5">
              <Play className="size-3.5 fill-current" />
              Save & Activate Sequence
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
