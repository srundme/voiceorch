import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn(), update: vi.fn() },
  callsTable: {},
}));

const leaveRecallBot = vi.fn(async (_botId: string) => undefined);

vi.mock("./meet-bots.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./meet-bots.js")>();
  return {
    ...actual,
    leaveRecallBot: (botId: string) => leaveRecallBot(botId),
    isRecallDiarizedTranscriptEnabled: () => false,
    fetchRecallBotDiarizedTranscript: async () => null,
  };
});

import {
  attachMeetSession,
  bindMeetRosterBot,
  createMeetRoster,
  EMPTY_ROOM_GRACE_MS,
  handleRecallParticipantEvent,
  hasEmptyRoomTimer,
  hasMeetingTeardownStarted,
  teardownMeetingForCost,
} from "./meet-roster.js";

function joinEvt(id: number, name: string) {
  return {
    event: "participant_events.join",
    data: { data: { participant: { id, name, is_host: false } } },
  };
}

function leaveEvt(id: number, name: string) {
  return {
    event: "participant_events.leave",
    data: { data: { participant: { id, name, is_host: false } } },
  };
}

describe("meet roster empty-room cost cut", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    leaveRecallBot.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("arms empty-room timer when last human leaves; rejoin cancels it", () => {
    const mid = "mid-empty-1";
    createMeetRoster(mid, "Agent");
    handleRecallParticipantEvent(mid, joinEvt(1, "Priya"));
    handleRecallParticipantEvent(mid, leaveEvt(1, "Priya"));
    expect(hasEmptyRoomTimer(mid)).toBe(true);

    handleRecallParticipantEvent(mid, joinEvt(1, "Priya"));
    expect(hasEmptyRoomTimer(mid)).toBe(false);
    expect(hasMeetingTeardownStarted(mid)).toBe(false);
  });

  it("tears down after grace when room stays empty", async () => {
    const mid = "mid-empty-2";
    const endMeetingSession = vi.fn();
    createMeetRoster(mid, "Agent");
    bindMeetRosterBot(mid, "bot-abc");
    attachMeetSession(mid, { endMeetingSession });

    handleRecallParticipantEvent(mid, joinEvt(7, "Host"));
    handleRecallParticipantEvent(mid, leaveEvt(7, "Host"));
    expect(hasEmptyRoomTimer(mid)).toBe(true);

    await vi.advanceTimersByTimeAsync(EMPTY_ROOM_GRACE_MS);
    await Promise.resolve();
    await Promise.resolve();

    expect(hasMeetingTeardownStarted(mid)).toBe(true);
    expect(endMeetingSession).toHaveBeenCalledWith("empty_room");
    expect(leaveRecallBot).toHaveBeenCalledWith("bot-abc");
  });

  it("teardownMeetingForCost is idempotent", async () => {
    const mid = "mid-empty-3";
    const endMeetingSession = vi.fn();
    createMeetRoster(mid, "Agent");
    bindMeetRosterBot(mid, "bot-xyz");
    attachMeetSession(mid, { endMeetingSession });

    await teardownMeetingForCost(mid, "empty_room");
    await teardownMeetingForCost(mid, "empty_room");
    expect(endMeetingSession).toHaveBeenCalledTimes(1);
    expect(leaveRecallBot).toHaveBeenCalledTimes(1);
  });

  it("routes inbound chat to injectMeetingChat", () => {
    const mid = "mid-chat";
    const injectMeetingChat = vi.fn();
    createMeetRoster(mid, "Agent");
    attachMeetSession(mid, { injectMeetingChat });

    handleRecallParticipantEvent(mid, {
      event: "participant_events.chat_message",
      data: {
        data: {
          participant: { id: 7, name: "Karthik", is_host: true },
          data: { text: "Next topic: pricing", to: "everyone" },
        },
      },
    });

    expect(injectMeetingChat).toHaveBeenCalledWith("Karthik", "Next topic: pricing");
  });
});
