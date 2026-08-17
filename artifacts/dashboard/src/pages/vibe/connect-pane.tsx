import { Link } from "wouter";
import { BookOpen, Plug, Webhook } from "lucide-react";
import { useGetAgent, useListKnowledgeSources, getGetAgentQueryKey } from "@workspace/api-client-react";
import { AgentInboundPanel } from "@/pages/agents/agent-inbound-panel";
import { ConnectionsHub } from "@/pages/connections/hub";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function VibeConnectPane({
  agentId,
  onOpenAgentSection,
}: {
  agentId: number;
  onOpenAgentSection: (section: string) => void;
}) {
  const { data: agent } = useGetAgent(agentId, {
    query: { queryKey: getGetAgentQueryKey(agentId) },
  });
  const { data: sources } = useListKnowledgeSources();
  const kbIds = ((agent as { knowledgeSourceIds?: number[] } | undefined)?.knowledgeSourceIds ?? []) as number[];
  const attached = (sources ?? []).filter((s) => kbIds.includes(s.id));
  const webhookUrl = (agent as { webhookUrl?: string | null } | undefined)?.webhookUrl?.trim() || "";

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8 pb-safe">
        <div>
          <p className="text-[15px] font-semibold tracking-tight">Connections</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Phone, knowledge, CRM webhook, and the same integrations as the rest of the workspace.
          </p>
        </div>

        <AgentInboundPanel agentId={agentId} telephonyProvider={agent?.telephonyProvider} />

        <section className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-muted/40">
                <BookOpen className="h-4 w-4 text-foreground/80" />
              </div>
              <span className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]",
                attached.length > 0
                  ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "border-border bg-muted/40 text-muted-foreground",
              )}>
                {attached.length > 0 ? `${attached.length} attached` : "None yet"}
              </span>
            </div>
            <p className="mt-4 text-[15px] font-semibold">Knowledge</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              {attached.length > 0
                ? attached.map((s) => s.name).join(", ")
                : "Attach FAQs, files, or a website so the agent can answer from your content."}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" className="h-9 text-xs" onClick={() => onOpenAgentSection("tools")}>
                Manage on agent
              </Button>
              <Button size="sm" variant="outline" className="h-9 text-xs" asChild>
                <Link href="/app/knowledge-base">Open knowledge library</Link>
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-muted/40">
                <Webhook className="h-4 w-4 text-foreground/80" />
              </div>
              <span className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]",
                webhookUrl
                  ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "border-border bg-muted/40 text-muted-foreground",
              )}>
                {webhookUrl ? "Set" : "Optional"}
              </span>
            </div>
            <p className="mt-4 text-[15px] font-semibold">CRM webhook</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              {webhookUrl
                ? webhookUrl
                : "Post-call JSON to Zapier, your CRM, or any HTTPS endpoint."}
            </p>
            <Button
              size="sm"
              className="mt-4 h-9 text-xs"
              variant={webhookUrl ? "outline" : "default"}
              onClick={() => onOpenAgentSection("settings")}
            >
              <Plug className="mr-1.5 h-3.5 w-3.5" />
              {webhookUrl ? "Edit in settings" : "Add webhook"}
            </Button>
          </div>
        </section>

        <ConnectionsHub embedded />
      </div>
    </div>
  );
}
