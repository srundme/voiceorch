import { WebSocket, type RawData } from "ws";

export const OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime";
const CONNECT_TIMEOUT_MS = 10_000;

export type RealtimeServerEvent = { type: string; [key: string]: unknown };

/** Open a GA Realtime WebSocket (no OpenAI-Beta header — that selects the retired beta shape). */
export function openRealtimeSocket(apiKey: string, model: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${OPENAI_REALTIME_URL}?model=${encodeURIComponent(model)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.terminate(); } catch { /* already closed */ }
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error("OpenAI Realtime connect timed out")), CONNECT_TIMEOUT_MS);
    ws.once("open", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ws);
    });
    ws.once("unexpected-response", (_req, res) => {
      fail(new Error(`OpenAI Realtime rejected the connection (HTTP ${res.statusCode ?? "?"})`));
    });
    ws.once("error", (err) => fail(err instanceof Error ? err : new Error(String(err))));
  });
}

export function sendRealtimeEvent(ws: WebSocket | null, event: Record<string, unknown>): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(event));
  return true;
}

export function parseRealtimeEvent(data: RawData): RealtimeServerEvent | null {
  try {
    const parsed = JSON.parse(data.toString()) as unknown;
    if (parsed && typeof parsed === "object" && typeof (parsed as { type?: unknown }).type === "string") {
      return parsed as RealtimeServerEvent;
    }
  } catch { /* non-JSON frame */ }
  return null;
}
