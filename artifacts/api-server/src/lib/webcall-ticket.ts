import { randomBytes } from "crypto";

interface TicketEntry {
  agentId: number;
  userId: string;
  expiresAt: number;
}

// Short-lived single-use tickets for webcall WebSocket upgrades.
// Removes the session JWT from the WS URL (which appears in server logs).
// Stored in-process — acceptable for a single Railway instance; move to
// Redis when horizontal scaling is needed (P1 backlog item).
const ticketStore = new Map<string, TicketEntry>();

const TICKET_TTL_MS = 60_000; // 60 seconds

/** Sweep expired entries to prevent unbounded map growth. */
function sweepExpired(): void {
  const now = Date.now();
  for (const [ticket, entry] of ticketStore) {
    if (entry.expiresAt <= now) ticketStore.delete(ticket);
  }
}

/** Create and store a short-lived ticket. Returns the opaque hex string. */
export function issueTicket(agentId: number, userId: string): string {
  sweepExpired();
  const ticket = randomBytes(32).toString("hex");
  ticketStore.set(ticket, { agentId, userId, expiresAt: Date.now() + TICKET_TTL_MS });
  return ticket;
}

/**
 * Validate and consume a ticket (single-use — deleted on first call).
 * Returns { userId } on success, null on any failure.
 */
export function consumeTicket(ticket: string, agentId: number): { userId: string } | null {
  const entry = ticketStore.get(ticket);
  if (!entry) return null;
  ticketStore.delete(ticket); // single-use: remove immediately regardless of outcome
  if (entry.expiresAt < Date.now()) return null;
  if (entry.agentId !== agentId) return null;
  return { userId: entry.userId };
}
