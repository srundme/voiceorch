/**
 * SnapServe Autonomous Meeting Bot Dispatcher.
 *
 * 1. WhatsApp/Email invites are sent when bookings are created (elsewhere).
 * 2. This worker schedules Recall bots with join_at = slotStart − 2m when the
 *    meeting is far enough out (≥10m lead — Recall on-time guarantee), or
 *    creates an ad-hoc bot in the last ~3 minutes before the slot.
 * 3. Bot id is persisted on bookings.meet_bot_id so restarts don't double-dispatch.
 *
 * Admit / waiting room: Google Meet has no Recall “auto-admit guests” API.
 * We rely on signed-in Workspace identity + calendar invite of RECALL_BOT_EMAIL,
 * clear chat admit hints, and host admit when prompted.
 */

import { randomUUID } from "node:crypto";
import { eq, and, sql, gte, lte, ne, isNull } from "drizzle-orm";
import {
  db,
  bookingsTable,
  agentsTable,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import { getSelfBaseUrl } from "../lib/app-domain.js";
import {
  signMeetBotToken,
  createRecallBot,
  deleteRecallBot,
} from "./meet-bots.js";
import {
  bindMeetRosterBot,
  createMeetRoster,
  recallRealtimeEvents,
  setMeetAttendeeHints,
} from "./meet-roster.js";
import {
  parseMeetingsConfig,
  resolveMeetRuntimeAgentId,
} from "./meeting-runtime.js";
import { prepareMeetPresentationAtLaunch } from "./meet-presentation.js";
import { resolveDispatchContextFromCall } from "./meet-booking.js";
import {
  MEET_BOT_LOOKBACK_MS,
  MEET_BOT_SCHEDULE_HORIZON_MS,
  planMeetBotDispatch,
} from "./meet-dispatch-plan.js";

export {
  MEET_BOT_ADHOC_WINDOW_MS,
  MEET_BOT_JOIN_EARLY_MS,
  MEET_BOT_LOOKBACK_MS,
  MEET_BOT_SCHEDULE_HORIZON_MS,
  MEET_BOT_SCHEDULE_MIN_LEAD_MS,
  planMeetBotDispatch,
  type MeetBotDispatchPlan,
} from "./meet-dispatch-plan.js";

/** In-flight lock so concurrent polls don't double-create before DB write. */
const dispatchInFlight = new Set<number>();

/** Best-effort: delete a scheduled Recall bot when a booking is cancelled. */
export async function cancelMeetBotForBooking(bookingId: number): Promise<void> {
  try {
    const [row] = await db
      .select({ meetBotId: bookingsTable.meetBotId })
      .from(bookingsTable)
      .where(eq(bookingsTable.id, bookingId))
      .limit(1);
    const botId = typeof row?.meetBotId === "string" ? row.meetBotId.trim() : "";
    if (!botId) return;
    try {
      await deleteRecallBot(botId);
    } catch (err) {
      logger.warn({ err, bookingId, botId }, "Failed to delete Recall bot on booking cancel");
    }
    await db
      .update(bookingsTable)
      .set({ meetBotId: null, meetBotJoinAt: null, updatedAt: new Date() })
      .where(eq(bookingsTable.id, bookingId));
  } catch (err) {
    logger.warn({ err, bookingId }, "cancelMeetBotForBooking failed");
  }
}

/**
 * Schedule or immediately dispatch Recall bots for upcoming bookings.
 */
export async function dispatchUpcomingMeetingBots(): Promise<void> {
  try {
    const now = new Date();
    const windowStart = new Date(now.getTime() - MEET_BOT_LOOKBACK_MS);
    const windowEnd = new Date(now.getTime() + MEET_BOT_SCHEDULE_HORIZON_MS);

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
        meetBotId: bookingsTable.meetBotId,
      })
      .from(bookingsTable)
      .where(
        and(
          ne(bookingsTable.status, "cancelled"),
          sql`${bookingsTable.meetLink} IS NOT NULL AND ${bookingsTable.meetLink} != ''`,
          isNull(bookingsTable.meetBotId),
          gte(bookingsTable.slotStart, windowStart),
          lte(bookingsTable.slotStart, windowEnd),
        ),
      );

    if (dueBookings.length === 0) return;

    for (const b of dueBookings) {
      if (!b.meetLink || !b.slotStart) continue;
      const plan = planMeetBotDispatch(b.slotStart, now);
      if (plan.action === "skip") continue;
      if (dispatchInFlight.has(b.id)) continue;
      dispatchInFlight.add(b.id);

      try {
        let configuredAgentId: number | null = null;
        let memoryPhone: string | undefined;
        let sourceCallId: number | undefined;

        if (b.callId) {
          const ctx = await resolveDispatchContextFromCall(b.callId);
          if (ctx.agentId) {
            configuredAgentId = ctx.agentId;
            sourceCallId = ctx.sourceCallId;
            memoryPhone = ctx.memoryPhone;
          }
        }

        if (!configuredAgentId) {
          const [agentRow] = await db
            .select({ id: agentsTable.id, name: agentsTable.name, agentConfig: agentsTable.agentConfig })
            .from(agentsTable)
            .where(eq(agentsTable.userId, b.userId))
            .limit(1);
          if (agentRow) configuredAgentId = agentRow.id;
        }

        if (!configuredAgentId) {
          logger.warn({ bookingId: b.id }, "Auto-dispatch meeting bot: no agent found for user");
          continue;
        }

        const [configured] = await db
          .select({
            id: agentsTable.id,
            name: agentsTable.name,
            agentConfig: agentsTable.agentConfig,
            userId: agentsTable.userId,
          })
          .from(agentsTable)
          .where(eq(agentsTable.id, configuredAgentId))
          .limit(1);
        if (!configured) continue;

        const meetings = parseMeetingsConfig(configured.agentConfig);
        if (!meetings.enabled) {
          logger.info(
            { bookingId: b.id, agentId: configuredAgentId },
            "Auto-dispatch skipped — meetings channel disabled for agent",
          );
          continue;
        }

        let runtimeAgentId = resolveMeetRuntimeAgentId(configuredAgentId, configured.agentConfig);
        let agentName = configured.name || "SnapServe AI Assistant";
        if (runtimeAgentId !== configuredAgentId) {
          const [delegate] = await db
            .select({
              id: agentsTable.id,
              name: agentsTable.name,
              userId: agentsTable.userId,
            })
            .from(agentsTable)
            .where(eq(agentsTable.id, runtimeAgentId))
            .limit(1);
          if (!delegate || delegate.userId !== b.userId) {
            logger.warn(
              { bookingId: b.id, configuredAgentId, runtimeAgentId },
              "Auto-dispatch: meeting delegate missing — falling back to configured agent",
            );
            runtimeAgentId = configuredAgentId;
          } else {
            agentName = delegate.name || agentName;
          }
        }

        const mid = randomUUID();
        const attendeeEmail =
          typeof b.attendeeEmail === "string" ? b.attendeeEmail.trim().toLowerCase() : "";
        const attendeeName =
          typeof b.attendeeName === "string" ? b.attendeeName.trim() : "";
        // Token must outlive a bot scheduled up to 24h ahead.
        const tokenExp = Math.max(Date.now(), b.slotStart.getTime()) + 2 * 60 * 60 * 1000;
        const token = signMeetBotToken({
          agentId: runtimeAgentId,
          userId: b.userId,
          exp: tokenExp,
          mid,
          meetUrl: b.meetLink,
          ...(sourceCallId && meetings.passCallContext ? { sourceCallId } : {}),
          ...(memoryPhone && meetings.passMemory ? { memoryPhone } : {}),
          ...(attendeeEmail && meetings.passMemory ? { memoryEmail: attendeeEmail } : {}),
          passMemory: meetings.passMemory,
          passCallContext: meetings.passCallContext,
        });
        const base = getSelfBaseUrl();
        const pageUrl = `${base}/api/meet-bots/page?mb=${encodeURIComponent(token)}`;

        createMeetRoster(mid, agentName);
        if (attendeeEmail) {
          setMeetAttendeeHints(mid, [{ name: attendeeName || attendeeEmail, email: attendeeEmail }]);
        }
        const { screensharePageUrl } = prepareMeetPresentationAtLaunch({
          mid,
          token,
          baseUrl: base,
          presentationUrl: meetings.presentationUrl,
          presentationAutoStart: meetings.presentationAutoStart,
        });

        const joinAt = plan.action === "schedule" ? plan.joinAt : undefined;
        const bot = await createRecallBot({
          meetingUrl: b.meetLink,
          botName: agentName,
          pageUrl,
          ownerUserId: b.userId,
          agentId: runtimeAgentId,
          eventsUrl: `${base}/api/meet-bots/recall-events?mb=${encodeURIComponent(token)}`,
          eventsList: recallRealtimeEvents(),
          ...(screensharePageUrl ? { screensharePageUrl } : {}),
          ...(joinAt ? { joinAt } : {}),
        });
        bindMeetRosterBot(mid, bot.id);

        await db
          .update(bookingsTable)
          .set({
            meetBotId: bot.id,
            meetBotJoinAt: joinAt ?? new Date(),
            updatedAt: new Date(),
          })
          .where(eq(bookingsTable.id, b.id));

        logger.info(
          {
            bookingId: b.id,
            agentId: runtimeAgentId,
            configuredAgentId,
            botId: bot.id,
            meetLink: b.meetLink,
            slotStart: b.slotStart,
            mode: plan.action,
            joinAt: joinAt?.toISOString() ?? null,
          },
          plan.action === "schedule"
            ? "Meeting bot scheduled (join_at)"
            : "Meeting bot dispatched (ad-hoc)",
        );
      } catch (err) {
        logger.error({ err, bookingId: b.id }, "Auto-dispatch meeting bot failed for booking");
      } finally {
        dispatchInFlight.delete(b.id);
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

  // Poll every 30s: schedule far-out meetings + catch last-minute ad-hoc joins.
  setInterval(() => {
    void dispatchUpcomingMeetingBots();
  }, 30_000);

  logger.info("Meeting bot auto-dispatcher started (schedule 24h / ad-hoc 3m, poll 30s)");
}
