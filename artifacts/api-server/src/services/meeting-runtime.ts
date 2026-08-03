/**
 * Resolve which agent actually joins a meeting, and which prompt it should use.
 * Config lives on agentConfig.meetings (Phase 4 Channels).
 */

export type MeetingsChannelConfig = {
  /** When false, auto-dispatch skips this agent. Manual join still allowed. */
  enabled: boolean;
  whoJoins: "self" | "delegate";
  /** Alternate prompt for meeting mode when this agent joins. Empty = use call prompt. */
  meetingPrompt: string;
  /** Other agent that joins when whoJoins === "delegate". */
  delegateAgentId: number | null;
  /** Prefer shared contact memory when a prior call context exists. */
  passMemory: boolean;
  /** Inject recent call summary into the meeting prompt when available. */
  passCallContext: boolean;
};

export const DEFAULT_MEETINGS_CONFIG: MeetingsChannelConfig = {
  enabled: true,
  whoJoins: "self",
  meetingPrompt: "",
  delegateAgentId: null,
  passMemory: true,
  passCallContext: true,
};

export function parseMeetingsConfig(agentConfig: unknown): MeetingsChannelConfig {
  const raw =
    agentConfig && typeof agentConfig === "object"
      ? (agentConfig as Record<string, unknown>)["meetings"]
      : undefined;
  if (!raw || typeof raw !== "object") return { ...DEFAULT_MEETINGS_CONFIG };
  const m = raw as Record<string, unknown>;
  const who = m["whoJoins"] === "delegate" ? "delegate" : "self";
  const delegateRaw = m["delegateAgentId"];
  const delegateAgentId =
    typeof delegateRaw === "number" && Number.isInteger(delegateRaw) && delegateRaw > 0
      ? delegateRaw
      : typeof delegateRaw === "string" && /^\d+$/.test(delegateRaw)
        ? Number(delegateRaw)
        : null;
  return {
    enabled: m["enabled"] !== false,
    whoJoins: who,
    meetingPrompt: typeof m["meetingPrompt"] === "string" ? m["meetingPrompt"] : "",
    delegateAgentId,
    passMemory: m["passMemory"] !== false,
    passCallContext: m["passCallContext"] !== false,
  };
}

/** Agent id that should run inside the meeting given the configured owner's config. */
export function resolveMeetRuntimeAgentId(
  configuredAgentId: number,
  agentConfig: unknown,
): number {
  const m = parseMeetingsConfig(agentConfig);
  if (m.whoJoins === "delegate" && m.delegateAgentId && m.delegateAgentId !== configuredAgentId) {
    return m.delegateAgentId;
  }
  return configuredAgentId;
}
