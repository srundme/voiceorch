/**
 * Meeting chat helpers — Recall send_chat_message for meet-bot sessions.
 */
import { logger } from "../lib/logger.js";
import { sendRecallChatMessage } from "./meet-bots.js";
import { getMeetRosterBotId } from "./meet-roster.js";

export async function executeMeetChatTool(opts: {
  meetMid: string | null | undefined;
  message: string;
  pin?: boolean;
}): Promise<string> {
  const mid = opts.meetMid?.trim();
  if (!mid) return "error: send_meeting_chat requires an active meeting bot session";
  const botId = getMeetRosterBotId(mid);
  if (!botId) return "error: meeting bot id unknown — cannot send chat right now";
  const message = opts.message.trim();
  if (!message) return "error: message is required";
  try {
    await sendRecallChatMessage(botId, message, {
      to: "everyone",
      pin: opts.pin === true,
    });
    logger.info({ mid, botId, chars: message.length, pin: opts.pin === true }, "Meeting chat sent");
    return `chat_sent: posted to meeting chat (${Math.min(message.length, 500)} chars). Do not read the message aloud unless asked.`;
  } catch (err) {
    logger.warn({ err, mid, botId }, "Meeting chat send failed");
    return `error: could not send chat — ${err instanceof Error ? err.message : "unknown error"}`;
  }
}
