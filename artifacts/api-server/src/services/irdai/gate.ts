/**
 * IRDAI call-blocking gate.
 * ─────────────────────────────────────────────────────────────────────────────
 * Enforcement layer (separate from the informational Compliance-tab banner).
 *
 * When an agent has `agentConfig.compliance.irdai` enabled AND the latest stored
 * `agentConfig.irdaiComplianceStatus` contains any item with `status: 'missing'`,
 * call initiation is blocked across all call paths (web call, telephony
 * dial-out, campaign start).
 *
 * This reads ONLY the already-stored status — it never re-runs
 * `checkIrdaiCompliance` at call time. After the prompt is fixed and re-saved
 * (clearing the missing items), the next attempt succeeds automatically.
 *
 * Pure function: no DB, no network. Never throws.
 */

export interface IrdaiGateMissingItem {
  requirement: string;
  detail: string;
}

export interface IrdaiGateResult {
  blocked: boolean;
  missingItems: IrdaiGateMissingItem[];
}

/** Standard error message prefix shown to the user when a call is blocked. */
export const IRDAI_BLOCKED_MESSAGE =
  "Call blocked: This agent's system prompt does not meet IRDAI compliance requirements. Resolve the missing items listed below before making a call.";

/** Structured error code returned in the 403 response body. */
export const IRDAI_BLOCKED_CODE = "IRDAI_BLOCKED";

type ComplianceShape = {
  compliance?: { irdai?: boolean } | null;
  irdaiComplianceStatus?: Array<{
    requirement?: unknown;
    status?: unknown;
    detail?: unknown;
  }> | null;
} | null | undefined;

/**
 * Evaluate the IRDAI gate against an agent's stored config.
 *
 * @param agentConfig the agent's `agentConfig` JSON (may be null/undefined).
 * @returns `blocked: true` only when IRDAI is enabled AND at least one stored
 *   compliance item has `status: 'missing'`. `missingItems` lists those items.
 */
export function evaluateIrdaiGate(agentConfig: ComplianceShape): IrdaiGateResult {
  const enabled = !!agentConfig?.compliance?.irdai;
  if (!enabled) return { blocked: false, missingItems: [] };

  const status = Array.isArray(agentConfig?.irdaiComplianceStatus)
    ? agentConfig!.irdaiComplianceStatus!
    : [];

  const missingItems: IrdaiGateMissingItem[] = status
    .filter((s) => s?.status === "missing")
    .map((s) => ({
      requirement: typeof s.requirement === "string" ? s.requirement : "",
      detail: typeof s.detail === "string" ? s.detail : "",
    }));

  return { blocked: missingItems.length > 0, missingItems };
}
