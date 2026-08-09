/**
 * Meeting control tools: leave, mute/unmute (soft-mute of bot audio into the room).
 * Note: avoid static imports from meet-roster (circular — roster binds mute controllers here).
 */
import { logger } from "../lib/logger.js";
import { leaveRecallBot } from "./meet-bots.js";

export type MeetMuteController = {
  setMeetingOutputMuted?(muted: boolean): void;
  isMeetingOutputMuted?(): boolean;
  endMeetingSession?(reason?: string): void;
};

const muteControllers = new Map<string, MeetMuteController>();

export function bindMeetMuteController(mid: string, ctrl: MeetMuteController): void {
  muteControllers.set(mid, ctrl);
}

export function unbindMeetMuteController(mid: string): void {
  muteControllers.delete(mid);
}

export async function executeLeaveMeetingTool(opts: {
  meetMid: string | null | undefined;
}): Promise<string> {
  const mid = opts.meetMid?.trim();
  if (!mid) return "error: leave_meeting requires an active meeting bot session";
  const { getMeetRosterBotId } = await import("./meet-roster.js");
  const botId = getMeetRosterBotId(mid);
  if (!botId) return "error: meeting bot id unknown — cannot leave right now";
  try {
    await leaveRecallBot(botId);
    const ctrl = muteControllers.get(mid);
    ctrl?.endMeetingSession?.("left_by_agent");
    logger.info({ mid, botId }, "Meeting bot left via leave_meeting tool");
    return "left_meeting: you have left the call. Do not speak further.";
  } catch (err) {
    logger.warn({ err, mid, botId }, "leave_meeting failed");
    return `error: could not leave meeting — ${err instanceof Error ? err.message : "unknown error"}`;
  }
}

export function executeMuteMeetingTool(opts: {
  meetMid: string | null | undefined;
  muted: boolean;
}): string {
  const mid = opts.meetMid?.trim();
  if (!mid) return "error: mute tools require an active meeting bot session";
  const ctrl = muteControllers.get(mid);
  if (!ctrl?.setMeetingOutputMuted) {
    return "error: mute control unavailable for this session";
  }
  ctrl.setMeetingOutputMuted(opts.muted);
  return opts.muted
    ? "muted: your microphone output into the meeting is muted. Call unmute_meeting before speaking again."
    : "unmuted: you can speak into the meeting again.";
}
