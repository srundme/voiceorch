/**
 * Dedicated call-plan Activity page — paginated log + analysis.
 */

import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { StripePage } from "@/components/stripe-page";
import { CallPlanActivityPanel } from "./activity-panel";
import type { CallPlanStep } from "./step-editor";

const DASH_API = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

type CallPlan = {
  id: number;
  name: string;
  steps: CallPlanStep[];
  totalRuns: number;
};

export default function CallPlanActivityPage() {
  const params = useParams<{ id: string }>();
  const planId = parseInt(String(params.id ?? ""), 10);

  const planQ = useQuery({
    queryKey: ["call-plans", planId],
    queryFn: () => customFetch<CallPlan>(`${DASH_API}/journeys/${planId}`),
    enabled: Number.isFinite(planId) && planId > 0,
  });

  if (!Number.isFinite(planId) || planId <= 0) {
    return (
      <StripePage title="Activity" description="Invalid call plan.">
        <p className="text-sm text-muted-foreground">Missing plan id.</p>
      </StripePage>
    );
  }

  if (planQ.isLoading) {
    return (
      <StripePage title="Activity" description="Loading…">
        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading plan…
        </div>
      </StripePage>
    );
  }

  if (planQ.isError || !planQ.data) {
    return (
      <StripePage title="Activity" description="Couldn’t load this plan.">
        <p className="text-sm text-muted-foreground">Plan not found or you don’t have access.</p>
      </StripePage>
    );
  }

  const plan = planQ.data;
  const steps = Array.isArray(plan.steps) ? plan.steps : [];

  return (
    <StripePage
      title={plan.name || "Call plan"}
      description="Activity & call log — progress, step funnel, and full history links."
      contentClassName="!pt-4"
    >
      <CallPlanActivityPanel
        planId={plan.id}
        steps={steps}
        totalRuns={plan.totalRuns}
        showBackLink
      />
    </StripePage>
  );
}
