import { PhoneOutgoing } from "lucide-react";
import { WebcallPanel } from "@/components/webcall-panel";
import { Button } from "@/components/ui/button";
import { ToolTestSimulator } from "@/pages/test-simulator";

export function VibeTestPane({
  agentId,
  agentName,
  onPhoneCall,
}: {
  agentId: number;
  agentName: string;
  onPhoneCall: () => void;
}) {
  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8 pb-safe">
        <div>
          <p className="text-[15px] font-semibold tracking-tight">Test {agentName}</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Talk in the browser, place a real phone call, or fire a scheduling tool without leaving Vibe.
          </p>
        </div>

        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">Live web call</p>
              <p className="text-[12px] text-muted-foreground">Uses your mic in this tab — no phone needed.</p>
            </div>
            <Button size="sm" variant="outline" className="h-9 gap-1.5 text-xs" onClick={onPhoneCall}>
              <PhoneOutgoing className="h-3.5 w-3.5" />
              Call a phone
            </Button>
          </div>
          <WebcallPanel agentId={agentId} agentName={agentName} />
        </section>

        <section className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="border-b border-border/70 px-5 py-4">
            <p className="text-sm font-semibold">Tool simulator</p>
            <p className="text-[12px] text-muted-foreground">
              Run booking tools with sample arguments and inspect the JSON the agent would get.
            </p>
          </div>
          <div className="min-h-[280px]">
            <ToolTestSimulator lockedAgentId={agentId} embedded />
          </div>
        </section>
      </div>
    </div>
  );
}
