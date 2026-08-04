/**
 * Read-only Agents view for partner-managed clients.
 *
 * Managed clients cannot create or edit agents — their partner builds and
 * operates agents on their behalf (enforced server-side). This view lists the
 * agents that live in the client's account and lets the client TEST them:
 *  - Web call  — browser Live Test (WebcallPanel)
 *  - Phone call — dial their own phone via the agent (OutboundCallDialog)
 */
import { useMemo, useState } from "react";
import {
  useListAgents,
  getListAgentsQueryKey,
  useListPhoneNumbers,
  getListPhoneNumbersQueryKey,
} from "@workspace/api-client-react";
import { usePartnerContext } from "@/hooks/use-partner";
import { WebcallPanel } from "@/components/webcall-panel";
import { OutboundCallDialog } from "@/components/outbound-call-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bot, Mic, Phone, Hash, Loader2 } from "lucide-react";

type AgentLite = {
  id: number;
  name: string;
  isActive?: boolean;
  language?: string | null;
  telephonyProvider?: string;
};

export default function ClientAgentsView() {
  const { data: partnerCtx } = usePartnerContext();
  const { data: agentsData, isLoading } = useListAgents({ query: { queryKey: getListAgentsQueryKey() } });
  const { data: numbersData } = useListPhoneNumbers({ query: { queryKey: getListPhoneNumbersQueryKey() } });

  const agents: AgentLite[] = Array.isArray(agentsData)
    ? (agentsData as AgentLite[])
    : (((agentsData as unknown as { agents?: AgentLite[] })?.agents) ?? []);
  const numbers = Array.isArray(numbersData) ? numbersData : [];

  const numberByAgent = useMemo(() => {
    const m = new Map<number, string>();
    for (const n of numbers as Array<{ agentId?: number | null; number: string }>) {
      if (n.agentId != null && !m.has(n.agentId)) m.set(n.agentId, n.number);
    }
    return m;
  }, [numbers]);

  const [webcallAgent, setWebcallAgent] = useState<AgentLite | null>(null);
  const [phoneAgent, setPhoneAgent] = useState<AgentLite | null>(null);

  const managerName = partnerCtx?.branding?.companyName;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Bot className="w-5 h-5 text-muted-foreground" /> Your agents
        </h1>
        <p className="text-[13px] text-muted-foreground mt-1">
          {managerName ? (
            <>Set up and managed for you by <span className="font-medium text-foreground">{managerName}</span>. </>
          ) : (
            <>Set up and managed for you by your service provider. </>
          )}
          Try any agent below — talk to it in the browser or have it call your phone.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-10 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading agents…
        </div>
      ) : agents.length === 0 ? (
        <div className="border border-dashed border-border rounded-xl p-10 text-center">
          <Bot className="w-8 h-8 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm font-medium">No agents yet</p>
          <p className="text-[13px] text-muted-foreground mt-1">
            {managerName ?? "Your provider"} will set up your voice agents — they'll appear here as soon as they're ready.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {agents.map((a) => {
            const assignedNumber = numberByAgent.get(a.id);
            return (
              <div key={a.id} className="border border-border rounded-xl bg-card p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{a.name}</p>
                    <div className="flex items-center gap-2 mt-1 text-[12px] text-muted-foreground">
                      {a.language && <span className="uppercase">{a.language}</span>}
                      {assignedNumber && (
                        <span className="inline-flex items-center gap-1">
                          <Hash className="w-3 h-3" /> {assignedNumber}
                        </span>
                      )}
                    </div>
                  </div>
                  <Badge variant={a.isActive === false ? "secondary" : "default"} className="shrink-0">
                    {a.isActive === false ? "Paused" : "Active"}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 mt-auto">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 flex-1"
                    onClick={() => setWebcallAgent(a)}
                  >
                    <Mic className="w-3.5 h-3.5 mr-1.5" /> Web call
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 flex-1"
                    onClick={() => setPhoneAgent(a)}
                  >
                    <Phone className="w-3.5 h-3.5 mr-1.5" /> Phone call
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Browser Live Test overlay */}
      {webcallAgent && (
        <div className="pointer-events-none fixed bottom-6 right-6 z-50 h-[520px] w-[min(92vw,380px)] bg-transparent">
          <div className="pointer-events-auto h-full">
            <WebcallPanel
              agentId={webcallAgent.id}
              agentName={webcallAgent.name ?? "Agent"}
              compact
              onClose={() => setWebcallAgent(null)}
            />
          </div>
        </div>
      )}

      {/* Test phone call dialog */}
      {phoneAgent && (
        <OutboundCallDialog
          agentId={phoneAgent.id}
          agentName={phoneAgent.name ?? "Agent"}
          telephonyProvider={phoneAgent.telephonyProvider ?? "vobiz"}
          open={!!phoneAgent}
          onOpenChange={(o: boolean) => { if (!o) setPhoneAgent(null); }}
        />
      )}
    </div>
  );
}
