import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(), input: vi.fn(), end: vi.fn(),
}));
vi.mock("../session.js", () => ({
  createSession: mocks.create,
  getSession: () => ({ pipeline: { onRawPcm8kIn: mocks.input, noteMediaDropIfWaitingForReply: vi.fn() } }),
  getSessionByCampaignLeadId: () => undefined,
  getSessionByExternalCallId: () => undefined,
  endSession: mocks.end,
  failSession: vi.fn(),
}));
vi.mock("./early-ambient.js", () => ({ startEarlyAmbientKeepalive: () => ({ stop: vi.fn() }) }));
import { handleVobizWebSocket } from "./vobiz.js";

class Socket extends EventEmitter {
  OPEN = 1;
  readyState = 1;
  send = vi.fn();
  close = vi.fn();
  message(value: unknown) { this.emit("message", JSON.stringify(value)); }
  media(pcm: Buffer, track = "inbound") {
    this.message({ event: "media", media: { payload: pcm.toString("base64"), track } });
  }
}
beforeEach(() => vi.clearAllMocks());

async function setup() {
  let ready!: (session: { sessionId: string }) => void;
  mocks.create.mockImplementation(() => new Promise((resolve) => { ready = resolve; }));
  const socket = new Socket();
  await handleVobizWebSocket(socket as unknown as WebSocket, 1);
  socket.message({ event: "start", start: { streamId: "stream", callId: "call" } });
  expect(mocks.create).toHaveBeenCalledTimes(1);
  return { socket, ready: () => ready({ sessionId: "session" }) };
}

describe("Vobiz input during async call setup", () => {
  it("delivers initial caller audio in order, exactly once, before live frames", async () => {
    const { socket, ready } = await setup();
    socket.media(Buffer.alloc(320, 1));
    socket.media(Buffer.alloc(320, 9), "outbound");
    socket.media(Buffer.alloc(320, 2));
    expect(mocks.input).not.toHaveBeenCalled();
    ready();
    await vi.waitFor(() => expect(mocks.input).toHaveBeenCalledTimes(2));
    socket.media(Buffer.alloc(320, 3));
    expect(mocks.input.mock.calls.map(([pcm]) => pcm[0])).toEqual([1, 2, 3]);
  });

  it("bounds retained PCM to five seconds during slow setup", async () => {
    const { socket, ready } = await setup();
    for (let i = 0; i < 300; i++) socket.media(Buffer.alloc(320, i % 256));
    ready();
    await vi.waitFor(() => expect(mocks.input).toHaveBeenCalledTimes(250));
    expect(mocks.input.mock.calls[0]![0][0]).toBe(50);
  });

  it.each(["stop", "close", "error"])("discards retained audio on %s before setup completes", async (event) => {
    const { socket, ready } = await setup();
    socket.media(Buffer.alloc(320));
    if (event === "stop") socket.message({ event });
    else socket.emit(event, new Error("socket gone"));
    ready();
    await vi.waitFor(() => expect(mocks.end).toHaveBeenCalledWith("session"));
    expect(mocks.input).not.toHaveBeenCalled();
  });
});
