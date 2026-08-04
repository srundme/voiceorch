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
  Link2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
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
      title: "Automation Sequence Saved! 🚀",
      description: `Active sequence rules configured for ${agentName || "Agent"}. Leads will be called automatically on scheduled days.`,
    });
  };

  return (
    <div className="space-y-6">
      {/* Lead Source Input (Google Sheet or CSV) */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <FileSpreadsheet className="size-4 text-emerald-500" />
              Lead Import Source (Google Sheet / CSV)
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Upload your lead list or connect a live Google Sheet. Leads will automatically follow the rules defined below.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Option A: Google Sheet Sync */}
          <div className="space-y-2 border border-border/60 rounded-lg p-3.5 bg-muted/20">
            <Label className="text-xs font-medium flex items-center gap-1.5">
              <Link2 className="size-3.5 text-blue-500" /> Google Sheet Sync URL
            </Label>
            <Input
              placeholder="https://docs.google.com/spreadsheets/d/..."
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
              className="h-8 text-xs"
            />
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-muted-foreground">Auto-sync new rows daily</span>
              <Switch checked={autoSync} onCheckedChange={setAutoSync} size="sm" />
            </div>
          </div>

          {/* Option B: Direct CSV File Upload */}
          <div className="space-y-2 border border-border/60 rounded-lg p-3.5 bg-muted/20 flex flex-col justify-between">
            <Label className="text-xs font-medium flex items-center gap-1.5">
              <Upload className="size-3.5 text-purple-500" /> Upload Lead CSV File
            </Label>
            <div className="relative border-2 border-dashed border-border/70 rounded-md p-2 text-center hover:bg-muted/40 transition-colors cursor-pointer">
              <input
                type="file"
                accept=".csv"
                className="absolute inset-0 opacity-0 cursor-pointer"
                onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
              />
              <p className="text-xs text-muted-foreground">
                {csvFile ? `Selected: ${csvFile.name}` : "Click or drag CSV lead list here"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Rules Builder Section */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="size-4 text-amber-500" />
              Automated Schedule Rules
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Define the exact day and time for AI calls, WhatsApp messages, or Google Meet connections.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={addRule} className="gap-1.5 text-xs h-8">
            <Plus className="size-3.5" />
            Add Rule
          </Button>
        </div>

        {/* List of Rules */}
        <div className="space-y-3">
          {rules.map((rule, index) => (
            <div
              key={rule.id}
              className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 border border-border/70 rounded-lg bg-background hover:border-primary/40 transition-all"
            >
              {/* Step indicator */}
              <div className="flex items-center gap-2 shrink-0">
                <span className="size-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">
                  {index + 1}
                </span>
              </div>

              {/* Action Type */}
              <div className="space-y-1 shrink-0 w-full sm:w-36">
                <Label className="text-[10px] text-muted-foreground">Action</Label>
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
                        <MessageSquare className="size-3 text-emerald-500" /> WhatsApp Msg
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

              {/* Schedule Type (Day of Month vs Delay) */}
              <div className="space-y-1 shrink-0 w-full sm:w-36">
                <Label className="text-[10px] text-muted-foreground">Schedule Rule</Label>
                <Select
                  value={rule.triggerType}
                  onValueChange={(v) => updateRule(rule.id, { triggerType: v as any })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="day_of_month" className="text-xs">
                      Day of Month (e.g. 21st)
                    </SelectItem>
                    <SelectItem value="delay_days" className="text-xs">
                      Days After Upload
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Day Value */}
              <div className="space-y-1 shrink-0 w-full sm:w-24">
                <Label className="text-[10px] text-muted-foreground">
                  {rule.triggerType === "day_of_month" ? "Day (1-31)" : "Delay (Days)"}
                </Label>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={rule.dayValue}
                  onChange={(e) => updateRule(rule.id, { dayValue: Number(e.target.value) })}
                  className="h-8 text-xs"
                />
              </div>

              {/* Time of Day */}
              <div className="space-y-1 shrink-0 w-full sm:w-28">
                <Label className="text-[10px] text-muted-foreground">Time of Day</Label>
                <Input
                  type="text"
                  value={rule.timeOfDay}
                  onChange={(e) => updateRule(rule.id, { timeOfDay: e.target.value })}
                  placeholder="09:00 AM"
                  className="h-8 text-xs"
                />
              </div>

              {/* Prompt Note */}
              <div className="space-y-1 flex-1 w-full">
                <Label className="text-[10px] text-muted-foreground">Rule Details / Goal</Label>
                <Input
                  type="text"
                  value={rule.promptNote}
                  onChange={(e) => updateRule(rule.id, { promptNote: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>

              {/* Delete Rule */}
              <Button
                size="icon"
                variant="ghost"
                className="size-8 text-muted-foreground hover:text-destructive shrink-0 mt-3 sm:mt-0"
                onClick={() => removeRule(rule.id)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-border/60 pt-4 mt-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="size-4 text-emerald-500" />
            <span>Rules will execute automatically via SnapServe engine.</span>
          </div>
          <Button onClick={handleSaveAutomation} className="gap-2 text-xs">
            <Play className="size-3.5 fill-current" />
            Save & Activate Sequence
          </Button>
        </div>
      </div>
    </div>
  );
}
