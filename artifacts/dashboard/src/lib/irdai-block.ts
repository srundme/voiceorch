import { ApiError } from "@workspace/api-client-react";

/**
 * IRDAI call-blocking helpers (frontend).
 * ─────────────────────────────────────────────────────────────────────────────
 * Mirror of the server-side enforcement gate (`api-server/src/services/irdai/
 * gate.ts`). Calls are blocked when an agent has IRDAI compliance enabled AND
 * its stored `agentConfig.irdaiComplianceStatus` contains any item with
 * `status: 'missing'`. Used to disable call/dial/start controls and show a
 * banner before the user attempts a blocked action.
 */

export interface IrdaiMissingItem {
  requirement: string;
  detail: string;
}

export interface IrdaiBlockResult {
  blocked: boolean;
  missingItems: IrdaiMissingItem[];
}

/** Standard message shown when a call is blocked by IRDAI non-compliance. */
export const IRDAI_BLOCKED_MESSAGE =
  "Call blocked: This agent's system prompt does not meet IRDAI compliance requirements. Resolve the missing items listed below before making a call.";

type AgentLike =
  | {
      agentConfig?: {
        compliance?: { irdai?: boolean } | null;
        irdaiComplianceStatus?: Array<{
          requirement?: string;
          status?: string;
          detail?: string;
        }> | null;
      } | null;
    }
  | null
  | undefined;

/**
 * Evaluate the IRDAI block for an agent using its already-loaded config.
 * Returns `blocked: true` only when IRDAI is enabled AND at least one stored
 * compliance item is `missing`.
 */
export function getIrdaiBlock(agent: AgentLike): IrdaiBlockResult {
  const enabled = !!agent?.agentConfig?.compliance?.irdai;
  if (!enabled) return { blocked: false, missingItems: [] };

  const status = Array.isArray(agent?.agentConfig?.irdaiComplianceStatus)
    ? agent!.agentConfig!.irdaiComplianceStatus!
    : [];

  const missingItems: IrdaiMissingItem[] = status
    .filter((s) => s?.status === "missing")
    .map((s) => ({
      requirement: typeof s.requirement === "string" ? s.requirement : "",
      detail: typeof s.detail === "string" ? s.detail : "",
    }));

  return { blocked: missingItems.length > 0, missingItems };
}

/**
 * Returns the IRDAI-block details when an API error is the structured
 * `IRDAI_BLOCKED` (403) response, otherwise null. Lets call sites surface the
 * backend's missing-items list even if the agent data was stale on the client.
 */
export function getIrdaiBlockedError(
  err: unknown,
): { message: string; missingItems: IrdaiMissingItem[] } | null {
  if (err instanceof ApiError) {
    const data = err.data as
      | { code?: string; error?: string; missingItems?: IrdaiMissingItem[] }
      | null;
    if (data?.code === "IRDAI_BLOCKED") {
      return {
        message: data.error ?? IRDAI_BLOCKED_MESSAGE,
        missingItems: Array.isArray(data.missingItems) ? data.missingItems : [],
      };
    }
  }
  return null;
}
