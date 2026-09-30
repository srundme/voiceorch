import type { AgentConfig, ToolDefinition } from "../../types.js";
import { buildToolDefs } from "../../../services/tool-executor.js";

export const SCHEDULE_CALLBACK_TOOL: ToolDefinition = {
  name: "schedule_callback",
  description:
    "Schedule a callback when the caller explicitly asks to be called back later.",
  parameters: {
    type: "object",
    properties: {
      scheduled_at: {
        type: "string",
        description:
          "Local wall-clock datetime to call back, in the business timezone shown in your current date/time context. Resolve relative phrasing ('tomorrow', 'this evening', 'in two hours') against the current date/time and output an absolute ISO 8601 value WITHOUT a timezone suffix (e.g. '2026-06-23T15:00:00'). Omit if no time was mentioned — defaults to 1 hour from now.",
      },
      notes: {
        type: "string",
        description: "Brief note capturing why the callback was requested, in the caller's words.",
      },
    },
    required: [],
  },
};

export const SCHEDULE_MEET_REJOIN_TOOL: ToolDefinition = {
  name: "schedule_meet_rejoin",
  description:
    "Schedule a SnapServe meeting agent to rejoin this same Meet/Zoom/Teams link later. Use for same-URL rejoin; use book/reschedule for a new calendar slot.",
  parameters: {
    type: "object",
    properties: {
      scheduled_at: {
        type: "string",
        description: "When to rejoin as ISO 8601 without timezone suffix.",
      },
      meet_url: {
        type: "string",
        description: "Optional. Defaults to the current meeting link.",
      },
      notes: {
        type: "string",
        description: "Short note about the rejoin request.",
      },
    },
    required: ["scheduled_at"],
  },
};

export const MEETING_PRESENTATION_TOOLS: ToolDefinition[] = [
  {
    name: "start_presentation",
    description:
      "Start screensharing a presentation in this meeting. Uses configured URL unless url is provided.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Optional https:// Google Slides, PDF, or webpage URL.",
        },
      },
      required: [],
    },
  },
  {
    name: "stop_presentation",
    description: "Stop screensharing the presentation.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "next_slide",
    description: "Advance to the next slide while presenting.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "previous_slide",
    description: "Go back to the previous slide while presenting.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "goto_slide",
    description: "Jump to a specific slide number (1-based) while presenting.",
    parameters: {
      type: "object",
      properties: {
        slide: { type: "number", description: "Slide number to show (starting at 1)." },
      },
      required: ["slide"],
    },
  },
  {
    name: "send_meeting_chat",
    description:
      "Post a short message to the meeting chat (links, agenda, summary). Keep under ~500 characters.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "Chat message for everyone." },
        pin: { type: "boolean", description: "Pin on Google Meet (optional)." },
      },
      required: ["message"],
    },
  },
  {
    name: "leave_meeting",
    description: "Leave the video meeting now when the host wraps up or asks you to leave.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "mute_meeting",
    description: "Mute your audio output into the meeting. Call unmute_meeting before speaking again.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "unmute_meeting",
    description: "Unmute your audio output into the meeting so you can speak again.",
    parameters: { type: "object", properties: {}, required: [] },
  },
];

/** Agent tools + the callback tool (+ meeting tools on Meet sessions) for native-audio stacks. */
export function buildLiveToolDefs(agent: AgentConfig): ToolDefinition[] {
  const toolDefs = buildToolDefs(agent.tools, {
    systemPrompt: agent.systemPrompt,
    knownEmail: agent.knownAttendeeEmail,
  });
  toolDefs.push(SCHEDULE_CALLBACK_TOOL);
  if (agent.isMeetingSession) {
    toolDefs.push(SCHEDULE_MEET_REJOIN_TOOL, ...MEETING_PRESENTATION_TOOLS);
  }
  return toolDefs;
}

/** Strip TTS prosody markup so Live transcripts stay human-readable. */
export function stripLiveMarkup(text: string): string {
  return text
    .replace(/<\/?emotion\b[^>]*>/gi, "")
    .replace(/<break\b[^>]*\/?>/gi, "")
    .replace(/[^\S\r\n]{2,}/g, " ")
    .trim();
}
