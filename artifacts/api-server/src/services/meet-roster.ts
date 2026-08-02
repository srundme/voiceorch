// ─────────────────────────────────────────────────────────────────────────────
// Meeting speaker identification (Recall.ai participant events).
//
// At bot launch we subscribe the Recall bot to real-time participant webhooks
// (join / leave / update / speech_on / speech_off) pointed at
// POST /api/meet-bots/recall-events?mb=<signed token>. Each launch mints a
// unique meeting id (`mid`, carried inside the signed token) that keys an
// in-memory roster here. When the bot page opens its webcall WS, the live
// pipeline attaches to the same `mid`, and from then on:
//   • the LLM gets a persistent participant-list context line,
//   • join/leave produce one-shot volatile notes ("Priya joined"),
//   • speech_on marks the current speaker, so the caller's next utterance is
//     tagged "[Speaker: Priya]" for the LLM.
//
// All state is in-memory and best-effort: webhook loss or a server restart
// degrades gracefully to the old nameless behavior. Nothing here may ever
// block or fail the voice pipeline.
// ─────────────────────────────────────────────────────────────────────────────
import { logger } from "../lib/logger.js";

/** The subset of pipeline surface the roster drives (all optional on VoiceSession). */
export interface MeetingAwareSession {
  setMeetingRoster?(line: string | null): void;
  setMeetingSpeaker?(name: string | null): void;
  injectMeetingNote?(note: string): void;
}

interface Participant {
  name: string;
  isHost: boolean;
}

interface Roster {
  botName: string;
  createdAt: number;
  participants: Map<number, Participant>;
  /** Most recent non-bot participant that started speaking. */
  lastSpeaker: string | null;
  session: MeetingAwareSession | null;
}

const rosters = new Map<string, Roster>();
const ROSTER_TTL_MS = 6 * 60 * 60 * 1000; // > max page-token TTL (4h)
const MAX_ROSTERS = 500;

function sweep(): void {
  const now = Date.now();
  for (const [mid, r] of rosters) {
    if (now - r.createdAt > ROSTER_TTL_MS) rosters.delete(mid);
  }
  // Hard cap against a webhook flood creating unbounded entries.
  if (rosters.size > MAX_ROSTERS) {
    const oldest = [...rosters.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
    for (const [mid] of oldest.slice(0, rosters.size - MAX_ROSTERS)) rosters.delete(mid);
  }
}

/** Untrusted display names go into LLM prompts — flatten and cap them. */
function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.replace(/[\r\n\t[\]{}<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return s || null;
}

export function createMeetRoster(mid: string, botName: string): void {
  sweep();
  rosters.set(mid, {
    botName: botName.trim().toLowerCase(),
    createdAt: Date.now(),
    participants: new Map(),
    lastSpeaker: null,
    session: null,
  });
}

/** Attach the live pipeline; replays current roster + speaker immediately. */
export function attachMeetSession(mid: string, session: MeetingAwareSession): void {
  const r = rosters.get(mid);
  if (!r) return; // roster expired or server restarted — degrade silently
  r.session = session;
  pushRoster(r);
  if (r.lastSpeaker) session.setMeetingSpeaker?.(r.lastSpeaker);
}

export function detachMeetSession(mid: string): void {
  const r = rosters.get(mid);
  if (r) r.session = null;
}

function rosterLine(r: Roster): string | null {
  const names = [...r.participants.values()]
    .map((p) => (p.isHost ? `${p.name} (host)` : p.name))
    .slice(0, 30);
  if (!names.length) return null;
  return (
    `[MEETING CONTEXT] You are attending a group meeting as a participant. ` +
    `People currently in the meeting: ${names.join(", ")}. ` +
    `Caller messages may be tagged with the speaker's name — address people by name when natural, and never read these tags aloud.`
  );
}

function pushRoster(r: Roster): void {
  try {
    r.session?.setMeetingRoster?.(rosterLine(r));
  } catch (err) {
    logger.warn({ err }, "Meet roster push failed");
  }
}

function isBotItself(r: Roster, name: string): boolean {
  return name.trim().toLowerCase() === r.botName;
}

/**
 * Handle one Recall real-time participant webhook. Payload shape (docs):
 * { event, data: { data: { participant: { id, name, is_host, ... } } } }
 */
export function handleRecallParticipantEvent(mid: string, body: unknown): void {
  const r = rosters.get(mid);
  if (!r) return;
  const evt = (body as { event?: unknown })?.event;
  if (typeof evt !== "string") return;
  const inner = (body as { data?: { data?: { participant?: unknown } } })?.data?.data;
  const p = inner?.participant as { id?: unknown; name?: unknown; is_host?: unknown } | undefined;
  const id = typeof p?.id === "number" ? p.id : null;
  const name = sanitizeName(p?.name);
  if (id === null || !name || isBotItself(r, name)) return;
  const isHost = p?.is_host === true;

  switch (evt) {
    case "participant_events.join": {
      const wasKnown = r.participants.has(id);
      r.participants.set(id, { name, isHost });
      pushRoster(r);
      if (!wasKnown) r.session?.injectMeetingNote?.(`${name} just joined the meeting.`);
      break;
    }
    case "participant_events.update": {
      r.participants.set(id, { name, isHost });
      pushRoster(r);
      break;
    }
    case "participant_events.leave": {
      if (r.participants.delete(id)) {
        pushRoster(r);
        r.session?.injectMeetingNote?.(`${name} left the meeting.`);
        if (r.lastSpeaker === name) {
          r.lastSpeaker = null;
          r.session?.setMeetingSpeaker?.(null);
        }
      }
      break;
    }
    case "participant_events.speech_on": {
      // Track the participant even if we missed their join event.
      if (!r.participants.has(id)) {
        r.participants.set(id, { name, isHost });
        pushRoster(r);
      }
      if (r.lastSpeaker !== name) {
        r.lastSpeaker = name;
        r.session?.setMeetingSpeaker?.(name);
      }
      break;
    }
    // speech_off intentionally keeps the last speaker: STT finals lag the
    // speech window, so the label must survive until someone ELSE speaks.
    default:
      break;
  }
}

/** Events the bot subscribes to at creation. */
export const RECALL_PARTICIPANT_EVENTS = [
  "participant_events.join",
  "participant_events.leave",
  "participant_events.update",
  "participant_events.speech_on",
  "participant_events.speech_off",
];
