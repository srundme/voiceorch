import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFamilyStore, AgentStatus } from "@/lib/family-store";
import { Plus, Search, Bot, ArrowRight, TrendingUp } from "lucide-react";

const STATUS_COLORS: Record<AgentStatus, string> = {
  draft: "secondary",
  training: "outline",
  testing: "outline",
  approved: "outline",
  published: "default",
} as const;

const STATUS_LABEL: Record<AgentStatus, string> = {
  draft: "Draft",
  training: "Training",
  testing: "Testing",
  approved: "Approved",
  published: "Published",
};

const STATUS_DOT: Record<AgentStatus, string> = {
  draft: "bg-muted-foreground",
  training: "bg-yellow-400",
  testing: "bg-blue-400",
  approved: "bg-green-400",
  published: "bg-emerald-500",
};

export default function FamilyAgentsPage() {
  const { agents, isLoaded } = useFamilyStore();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filtered = agents.filter((a) => {
    const matchesSearch =
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.companyName.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || a.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const counts = {
    total: agents.length,
    published: agents.filter((a) => a.status === "published").length,
    approved: agents.filter((a) => a.status === "approved").length,
    testing: agents.filter((a) => a.status === "testing").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Family — Insurance Agents</h1>
          <p className="text-muted-foreground mt-1">
            Create and manage AI voice agents for insurance companies. Publish to make them available in the Family mobile app.
          </p>
        </div>
        <Button onClick={() => setLocation("/family-agents/new")} className="gap-2">
          <Plus className="h-4 w-4" />
          New Agent
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Agents", value: counts.total, icon: Bot },
          { label: "Published", value: counts.published, icon: TrendingUp },
          { label: "Approved", value: counts.approved, icon: TrendingUp },
          { label: "In Testing", value: counts.testing, icon: TrendingUp },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="p-4 flex items-center gap-3">
              <Icon className="h-8 w-8 text-muted-foreground opacity-50 shrink-0" />
              <div>
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search agents or companies…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="training">Training</SelectItem>
                <SelectItem value="testing">Testing</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="published">Published</SelectItem>
              </SelectContent>
            </Select>
            <CardTitle className="text-sm text-muted-foreground ml-auto">
              {isLoaded ? `${filtered.length} of ${agents.length}` : "Loading…"}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!isLoaded ? (
            <p className="text-sm text-muted-foreground px-6 py-8">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground px-6 py-8">No agents found.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground border-b border-border">
                <tr>
                  <th className="px-6 py-3 font-medium">Agent</th>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">KB Entries</th>
                  <th className="px-4 py-3 font-medium text-right">Total Calls</th>
                  <th className="px-4 py-3 font-medium text-right">Conv. Rate</th>
                  <th className="px-4 py-3 font-medium text-right">Updated</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((agent) => (
                  <tr key={agent.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-6 py-3 font-medium">{agent.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{agent.companyName}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${STATUS_DOT[agent.status]}`} />
                        <Badge variant={STATUS_COLORS[agent.status] as any}>
                          {STATUS_LABEL[agent.status]}
                        </Badge>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{agent.kbEntries}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {agent.totalCalls > 0 ? agent.totalCalls.toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {agent.conversionRate > 0 ? `${agent.conversionRate}%` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {new Date(agent.lastUpdated).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/family-agents/${agent.id}`}>
                        <Button size="sm" variant="ghost" className="gap-1">
                          Manage <ArrowRight className="h-3 w-3" />
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
