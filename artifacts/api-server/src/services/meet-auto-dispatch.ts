/**
 * SnapServe Autonomous Meeting Bot Dispatcher & Invites.
 *
 * Automates the end-to-end phone -> meeting workflow:
 *  1. When a booking with a Google Meet / Zoom link is created, sends immediate
 *     WhatsApp & Email invites containing the meeting URL.
 *  2. Background worker polls upcoming bookings (starting in <= 3 minutes) and
 *     automatically dispatches a Recall.ai Meeting Bot to join the meeting early.
 *  3. The bot joins the room, auto-admits the caller when they enter, and conducts
 *     the live voice AI conversation.
 */

import { randomUUID } from "node:crypto";
import { eq, and, sql, gte, lte, ne } from "drizzle-orm";
import {
  db,
  bookingsTable,
  callsTable,
  agentsTable,
  eventTypesTable,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import { getSelfBaseUrl } from "../lib/app-domain.js";
import {
  signMeetBotToken,
  createRecallBot,
} from "./meet-bots.js";
import {
  createMeetRoster,
  RECALL_PARTICIPANT_EVENTS,
} from "./meet-roster.js";

/** In-memory cache of booking IDs for which a meeting bot has already been dispatched */
const dispatchedBotBookings = new Set<number>();

/**
 * Auto-dispatches Recall.ai Meeting Bots for upcoming bookings starting in <= 3 minutes.
 */
export async function dispatchUpcomingMeetingBots(): Promise<void> {
  try {
    const now = new Date();
    // Look ahead up to 3 minutes, and look back up to 2 minutes (in case of scheduler cold start)
    const windowStart = new Date(now.getTime() - 2 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + 3 * 60 * 1000);

    const dueBookings = await db
      .select({
        id: bookingsTable.id,
        userId: bookingsTable.userId,
        callId: bookingsTable.callId,
        attendeeName: bookingsTable.attendeeName,
        attendeeEmail: bookingsTable.attendeeEmail,
        slotStart: bookingsTable.slotStart,
        meetLink: bookingsTable.meetLink,
        status: bookingsTable.status,
      })
      .from(bookingsTable)
      .where(
        and(
          ne(bookingsTable.status, "cancelled"),
          sql`${bookingsTable.meetLink} IS NOT NULL AND ${bookingsTable.meetLink} != ''`,
          gte(bookingsTable.slotStart, windowStart),
          lte(bookingsTable.slotStart, windowEnd),
        ),
      );

    if (dueBookings.length === 0) return;

    for (const b of dueBookings) {
      if (!b.meetLink) continue;
      if (dispatchedBotBookings.has(b.id)) continue;
      dispatchedBotBookings.add(b.id);

      try {
        let agentId: number | null = null;
        let agentName = "SnapServe AI Assistant";

        if (b.callId) {
          const [callRow] = await db
            .select({ agentId: callsTable.agentId })
            .from(callsTable)
            .where(eq(callsTable.id, b.callId))
            .limit(1);
          if (callRow?.agentId) agentId = callRow.agentId;
        }

        if (!agentId) {
          const [agentRow] = await db
            .select({ id: agentsTable.id, name: agentsTable.name })
            .from(agentsTable)
            .where(eq(agentsTable.userId, b.userId))
            .limit(1);
          if (agentRow) {
            agentId = agentRow.id;
            agentName = agentRow.name;
          }
        }

        if (!agentId) {
          logger.warn({ bookingId: b.id }, "Auto-dispatch meeting bot: no agent found for user");
          continue;
        }

        const mid = randomUUID();
        const token = signMeetBotToken({
          agentId,
          userId: b.userId,
          exp: Date.now() + 2 * 60 * 60 * 1000, // 2 hour TTL for live meeting
          mid,
        });
        const base = getSelfBaseUrl();
        const pageUrl = `${base}/api/meet-bots/page?mb=${encodeURIComponent(token)}`;

        // Register meeting roster early so participant webhooks map correctly
        createMeetRoster(mid, agentName);

        const bot = await createRecallBot({
          meetingUrl: b.meetLink,
          botName: agentName,
          pageUrl,
          ownerUserId: b.userId,
          agentId,
          eventsUrl: `${base}/api/meet-bots/recall-events?mb=${encodeURIComponent(token)}`,
          eventsList: RECALL_PARTICIPANT_EVENTS,
        });

        logger.info(
          {
            bookingId: b.id,
            agentId,
            botId: bot.id,
            meetLink: b.meetLink,
            slotStart: b.slotStart,
          },
          "🤖 Autonomous Meeting Bot dispatched successfully!",
        );
      } catch (err) {
        logger.error({ err, bookingId: b.id }, "Auto-dispatch meeting bot failed for booking");
      }
    }
  } catch (err) {
    logger.error({ err }, "dispatchUpcomingMeetingBots worker error");
  }
}

/**
 * Start the autonomous meeting bot dispatcher worker.
 */
let workerStarted = false;
export function startMeetingBotAutoDispatcher(): void {
  if (workerStarted) return;
  workerStarted = true;

  // Poll every 30 seconds to catch meetings starting soon
  setInterval(() => {
    void dispatchUpcomingMeetingBots();
  }, 30_000);

  logger.info("🤖 SnapServe Autonomous Meeting Bot Dispatcher started (polling every 30s)");
}
