import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useFamilyStore } from "@/lib/family-store";
import { Building2, FileText, Bot, ChevronRight } from "lucide-react";

const CATEGORY_LABEL: Record<string, string> = {
  health: "Health",
  general: "General",
  life: "Life",
};
const CATEGORY_STYLE: Record<string, string> = {
  health:  "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  general: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  life:    "bg-purple-500/10 text-purple-400 border-purple-500/20",
};

export default function FamilyCompaniesPage() {
  const { companies, policies, agents, isLoaded } = useFamilyStore();

  const policyCountByCompany = policies.reduce<Record<string, number>>((acc, p) => {
    acc[p.companyId] = (acc[p.companyId] ?? 0) + 1;
    return acc;
  }, {});

  const agentCountByCompany = agents.reduce<Record<string, number>>((acc, a) => {
    acc[a.companyId] = (acc[a.companyId] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Insurance Companies</h1>
        <p className="text-muted-foreground mt-1">
          {companies.length} companies listed. Click a company to manage its policies and knowledge base.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Companies", value: companies.length, icon: Building2 },
          { label: "Total Policies",  value: isLoaded ? policies.length : "…", icon: FileText },
          { label: "Total Agents",    value: isLoaded ? agents.length  : "…", icon: Bot },
          { label: "Published",       value: isLoaded ? agents.filter(a => a.status === "published").length : "…", icon: Bot },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="p-4 flex items-center gap-3">
              <Icon className="h-8 w-8 text-muted-foreground opacity-40 shrink-0" />
              <div>
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {companies.map((company) => {
          const pCount = policyCountByCompany[company.id] ?? 0;
          const aCount = agentCountByCompany[company.id] ?? 0;
          return (
            <Link key={company.id} href={`/family/companies/${company.id}`}>
              <Card className="cursor-pointer hover:border-muted-foreground/40 transition-all hover:shadow-sm group">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div
                      className="h-10 w-10 rounded-lg flex items-center justify-center text-white font-bold text-sm shrink-0"
                      style={{ backgroundColor: company.logoColor }}
                    >
                      {company.name.slice(0, 2).toUpperCase()}
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[10px] shrink-0 ${CATEGORY_STYLE[company.category]}`}
                    >
                      {CATEGORY_LABEL[company.category]}
                    </Badge>
                  </div>

                  <p className="font-semibold text-sm leading-tight mb-3 group-hover:text-primary transition-colors">
                    {company.name}
                  </p>

                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1">
                        <FileText className="h-3 w-3" />
                        {pCount} {pCount === 1 ? "policy" : "policies"}
                      </span>
                      <span className="flex items-center gap-1">
                        <Bot className="h-3 w-3" />
                        {aCount} {aCount === 1 ? "agent" : "agents"}
                      </span>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 opacity-40 group-hover:opacity-100 transition-opacity" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
