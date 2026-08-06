/**
 * Resolve which agent actually joins a meeting, and which prompt / timing it
 * should use. Config lives on agentConfig.meetings (Builder Meeting settings).
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
  /**
   * Hard cut-off for a meeting session (seconds). Independent of phone
   * maxDuration. Default 45 minutes — meetings commonly wait for late joiners.
   */
  maxDurationSeconds: number;
  /**
   * Silence window before a soft “still waiting?” check-in (seconds).
   * Independent of phone silenceTimeoutSeconds. Default 3 minutes so “please
   * wait for others” doesn’t hang up like a phone call. 0 = never.
   */
  silenceTimeoutSeconds: number;
  /**
   * When false, silence never ends the meeting (check-ins also disabled).
   * When true, one soft check-in then leave after a second full silence window.
   */
  silenceHangupEnabled: boolean;
  /**
   * HTTPS URL of a deck / PDF / webpage the bot can screenshare in Meet.
   * Empty = presentation tools unavailable until a URL is passed at start time.
   */
  presentationUrl: string;
  /** When true and presentationUrl is set, start screenshare as soon as the bot joins. */
  presentationAutoStart: boolean;
};

/** Default meeting length — longer than typical phone calls. */
export const DEFAULT_MEETING_MAX_DURATION_SECONDS = 45 * 60;
/** Default patience while waiting for other participants. */
export const DEFAULT_MEETING_SILENCE_TIMEOUT_SECONDS = 3 * 60;

export const DEFAULT_MEETINGS_CONFIG: MeetingsChannelConfig = {
  enabled: true,
  whoJoins: "self",
  meetingPrompt: "",
  delegateAgentId: null,
  passMemory: true,
  passCallContext: true,
  maxDurationSeconds: DEFAULT_MEETING_MAX_DURATION_SECONDS,
  silenceTimeoutSeconds: DEFAULT_MEETING_SILENCE_TIMEOUT_SECONDS,
  silenceHangupEnabled: true,
  presentationUrl: "",
  presentationAutoStart: false,
};

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

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
    // 1 min … 2 hours
    maxDurationSeconds: clampInt(
      m["maxDurationSeconds"],
      60,
      7200,
      DEFAULT_MEETING_MAX_DURATION_SECONDS,
    ),
    // 0 = disabled … 10 minutes
    silenceTimeoutSeconds: clampInt(
      m["silenceTimeoutSeconds"],
      0,
      600,
      DEFAULT_MEETING_SILENCE_TIMEOUT_SECONDS,
    ),
    silenceHangupEnabled: m["silenceHangupEnabled"] !== false,
    presentationUrl: typeof m["presentationUrl"] === "string" ? m["presentationUrl"].trim() : "",
    presentationAutoStart: m["presentationAutoStart"] === true,
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

/** Short behavior block appended for meet-bot sessions (waiting, speaker tags). */
export const MEETING_BEHAVIOR_PROMPT =
  `[MEETING BEHAVIOR] You are a participant in a live video meeting, not a phone call. ` +
  `If someone asks you to wait for others to join, acknowledge briefly once, then stay quiet — do not keep checking in. ` +
  `Caller lines may be tagged [Speaker: Name]; address people by name when natural and never read those tags aloud. ` +
  `Do not use phone openers like "am I speaking with…". Leave only when the host wraps up or clearly asks you to go.\n` +
  `[MEETING SCHEDULING] If participants want another time: use list_bookings / reschedule / book tools when available. ` +
  `After a successful reschedule or booking with a Meet link, confirm the new time and that a SnapServe meeting agent will join automatically near that time. ` +
  `If they want YOU to rejoin THIS same Meet link later (same URL, later clock time), call schedule_meet_rejoin with that time — do not invent a new Meet link. ` +
  `Never claim a booking or rejoin is set unless the tool returned success.\n` +
  `[MEETING PRESENTATION] When participants ask you to present or share slides, call start_presentation (optional url if they give a different HTTPS link). ` +
  `Use next_slide / previous_slide to advance; stop_presentation when done. ` +
  `Do not claim you are sharing unless the tool returned success. Voice stays on; screenshare is the deck.`;
