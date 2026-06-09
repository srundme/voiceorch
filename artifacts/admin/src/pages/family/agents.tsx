import React from "react";
import { useLocation } from "wouter";
import { Plus, Bot, Building2, FileText, Pencil, Trash2, AlertCircle } from "lucide-react";
import { useFamilyStore, AgentStatus } from "@/lib/family-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

const STATUS_COLORS: Record<AgentStatus, string> = {
  draft:     "bg-zinc-700 text-zinc-300",
  training:  "bg-yellow-900/60 text-yellow-300",
  testing:   "bg-blue-900/60 text-blue-300",
  approved:  "bg-emerald-900/60 text-emerald-300",
  published: "bg-green-900/60 text-green-300",
};

export default function FamilyAgentsPage() {
  const [, setLocation] = useLocation();
  const { agents, saveAgents } = useFamilyStore();
  const { toast } = useToast();

  const handleDelete = (id: string, name: string) => {
    saveAgents(agents.filter(a => a.id !== id));
    toast({ title: "Agent deleted", description: `"${name}" has been removed.` });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" />
            Family Agents
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            AI voice agents for insurance companies — {agents.length} agent{agents.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button onClick={() => setLocation("/family/agents/new")} className="gap-2">
          <Plus className="h-4 w-4" />
          New Agent
        </Button>
      </div>

      {agents.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center space-y-3">
            <Bot className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-muted-foreground font-medium">No agents yet</p>
            <p className="text-muted-foreground/60 text-sm max-w-xs">
              Create your first insurance AI voice agent to get started.
            </p>
            <Button
              onClick={() => setLocation("/family/agents/new")}
              variant="outline"
              className="gap-2 mt-2"
            >
              <Plus className="h-4 w-4" />
              Create Agent
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map(agent => (
            <Card
              key={agent.id}
              className="relative group hover:border-muted-foreground/30 transition-colors"
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base truncate">{agent.name}</CardTitle>
                    {agent.description && (
                      <CardDescription className="text-xs mt-0.5 line-clamp-1">
                        {agent.description}
                      </CardDescription>
                    )}
                  </div>
                  <Badge className={`text-[10px] shrink-0 ${STATUS_COLORS[agent.status]}`}>
                    {agent.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Building2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{agent.companyName}</span>
                  {agent.policyName && (
                    <>
                      <span className="text-muted-foreground/40">·</span>
                      <FileText className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{agent.policyName}</span>
                    </>
                  )}
                </div>

                {(agent.asrProvider || agent.llmProvider || agent.ttsProvider) && (
                  <div className="flex items-center gap-1 flex-wrap">
                    {agent.asrProvider && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                        {agent.asrProvider}
                      </span>
                    )}
                    {agent.llmProvider && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                        {agent.llmProvider}
                      </span>
                    )}
                    {agent.ttsProvider && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                        {agent.ttsProvider}
                      </span>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <span className="text-[10px] text-muted-foreground/50">
                    Updated {new Date(agent.lastUpdated).toLocaleDateString()}
                  </span>
                  <div className="flex-1" />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={() => setLocation(`/family/agents/${agent.id}`)}
                  >
                    <Pencil className="h-3 w-3" />
                    Edit
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 text-destructive" />
                          Delete Agent
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete <strong>{agent.name}</strong>? This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => handleDelete(agent.id, agent.name)}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
