/**
 * Admin — Workshop events + feedback analytics.
 *
 * CRUD for workshop events plus per-event analytics computed in JS (workshop
 * scale is small — a few hundred responses at most). Gated by requireAdmin
 * (x-admin-token). Mounted before `provisionUser` in routes/index.ts.
 *
 * Modeled on admin-board-analytics.ts.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq, desc, sql } from "drizzle-orm";
import {
  db,
  workshopEventsTable,
  workshopResponsesTable,
  WORKSHOP_EVENT_EXPERIENCE_METRICS,
  WORKSHOP_LEARNING_METRICS,
  type WorkshopResponse,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
router.use("/admin/events", requireAdmin);

// ─── helpers ─────────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "workshop"
  );
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  for (let i = 0; i < 5; i++) {
    const [ex] = await db
      .select({ id: workshopEventsTable.id })
      .from(workshopEventsTable)
      .where(eq(workshopEventsTable.slug, slug))
      .limit(1);
    if (!ex) return slug;
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

const SessionSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(200),
});

const CreateBody = z.object({
  title: z.string().min(1).max(200),
  slug: z
    .string()
    .max(128)
    .regex(/^[a-z0-9][a-z0-9-]*$/i)
    .optional(),
  college: z.string().max(200).optional().nullable(),
  eventDate: z.string().datetime().optional().nullable(),
  mode: z.enum(["online", "offline"]).optional(),
  sessions: z.array(SessionSchema).max(50).optional(),
  status: z.enum(["open", "closed"]).optional(),
  registrationsCount: z.number().int().min(0).optional(),
  attendeesCount: z.number().int().min(0).optional(),
});

const UpdateBody = CreateBody.partial();

function withSessionIds(sessions: Array<{ id?: string; name: string }>) {
  return sessions.map((s, i) => ({
    id: s.id && s.id.trim() ? s.id : `s${i + 1}-${Math.random().toString(36).slice(2, 6)}`,
    name: s.name,
  }));
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

router.get("/admin/events", async (_req, res): Promise<void> => {
  try {
    const events = await db
      .select()
      .from(workshopEventsTable)
      .orderBy(desc(workshopEventsTable.createdAt));
    const counts = await db
      .select({
        eventId: workshopResponsesTable.eventId,
        c: sql<number>`count(*)::int`,
      })
      .from(workshopResponsesTable)
      .groupBy(workshopResponsesTable.eventId);
    const countMap = new Map(counts.map((r) => [r.eventId, Number(r.c)]));
    res.json(
      events.map((e) => ({
        ...e,
        eventDate: e.eventDate ? e.eventDate.toISOString() : null,
        createdAt: e.createdAt.toISOString(),
        updatedAt: e.updatedAt.toISOString(),
        responseCount: countMap.get(e.id) ?? 0,
      })),
    );
  } catch (err) {
    logger.error({ err }, "list workshop events failed");
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/admin/events", async (req, res): Promise<void> => {
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  try {
    const b = parsed.data;
    const slug = await uniqueSlug(slugify(b.slug || b.title));
    const [row] = await db
      .insert(workshopEventsTable)
      .values({
        slug,
        title: b.title,
        college: b.college ?? null,
        eventDate: b.eventDate ? new Date(b.eventDate) : null,
        mode: b.mode ?? "offline",
        sessions: withSessionIds(b.sessions ?? []),
        status: b.status ?? "open",
        registrationsCount: b.registrationsCount ?? 0,
        attendeesCount: b.attendeesCount ?? 0,
      })
      .returning();
    res.status(201).json({
      ...row,
      eventDate: row!.eventDate ? row!.eventDate.toISOString() : null,
      createdAt: row!.createdAt.toISOString(),
      updatedAt: row!.updatedAt.toISOString(),
      responseCount: 0,
    });
  } catch (err) {
    logger.error({ err }, "create workshop event failed");
    res.status(500).json({ error: "Server error" });
  }
});

router.patch("/admin/events/:id", async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  try {
    const b = parsed.data;
    const set: Record<string, unknown> = {};
    if (b.title !== undefined) set["title"] = b.title;
    if (b.college !== undefined) set["college"] = b.college ?? null;
    if (b.eventDate !== undefined) set["eventDate"] = b.eventDate ? new Date(b.eventDate) : null;
    if (b.mode !== undefined) set["mode"] = b.mode;
    if (b.sessions !== undefined) set["sessions"] = withSessionIds(b.sessions);
    if (b.status !== undefined) set["status"] = b.status;
    if (b.registrationsCount !== undefined) set["registrationsCount"] = b.registrationsCount;
    if (b.attendeesCount !== undefined) set["attendeesCount"] = b.attendeesCount;
    if (b.slug !== undefined && b.slug) set["slug"] = await uniqueSlug(slugify(b.slug));
    if (Object.keys(set).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }
    const [row] = await db
      .update(workshopEventsTable)
      .set(set)
      .where(eq(workshopEventsTable.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({
      ...row,
      eventDate: row.eventDate ? row.eventDate.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "update workshop event failed");
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/admin/events/:id", async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    await db.delete(workshopEventsTable).where(eq(workshopEventsTable.id, id));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "delete workshop event failed");
    res.status(500).json({ error: "Server error" });
  }
});

// ─── analytics ───────────────────────────────────────────────────────────────

const avg = (nums: number[]): number | null =>
  nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : null;

const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

function tally(values: Array<string | undefined | null>): Array<{ label: string; count: number }> {
  const map = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    map.set(v, (map.get(v) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

function tallyList(rows: Array<string[] | undefined | null>): Array<{ label: string; count: number }> {
  return tally(rows.flatMap((r) => r ?? []));
}

function metricBreakdown(
  responses: WorkshopResponse[],
  field: "eventExperience" | "learningImpact",
  metrics: ReadonlyArray<readonly [string, string]>,
): Array<{ key: string; label: string; avg: number | null; count: number }> {
  return metrics.map(([key, label]) => {
    const nums = responses
      .map((r) => (r[field] as Record<string, number> | null)?.[key])
      .filter((n): n is number => typeof n === "number");
    return { key, label, avg: avg(nums), count: nums.length };
  });
}

router.get("/admin/events/:id/analytics", async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const [event] = await db
      .select()
      .from(workshopEventsTable)
      .where(eq(workshopEventsTable.id, id))
      .limit(1);
    if (!event) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const responses = await db
      .select()
      .from(workshopResponsesTable)
      .where(eq(workshopResponsesTable.eventId, id))
      .orderBy(desc(workshopResponsesTable.createdAt));

    const total = responses.length;

    // Session ratings — per event.sessions row
    const sessions = (event.sessions ?? []).map((s) => {
      const nums = responses
        .map((r) => r.sessionRatings?.[s.id])
        .filter((n): n is number => typeof n === "number");
      return { id: s.id, name: s.name, avg: avg(nums), count: nums.length };
    });
    const rated = sessions.filter((s) => s.avg != null);
    const topSession = rated.length
      ? rated.reduce((a, b) => ((b.avg ?? 0) > (a.avg ?? 0) ? b : a))
      : null;
    const lowestSession = rated.length
      ? rated.reduce((a, b) => ((b.avg ?? 0) < (a.avg ?? 0) ? b : a))
      : null;

    const eventExperience = metricBreakdown(responses, "eventExperience", WORKSHOP_EVENT_EXPERIENCE_METRICS);
    const learningImpact = metricBreakdown(responses, "learningImpact", WORKSHOP_LEARNING_METRICS);

    const satisfactionNums = responses
      .map((r) => r.eventExperience?.["overallSatisfaction"])
      .filter((n): n is number => typeof n === "number");

    const speakerNums = responses.flatMap((r) =>
      [r.eventExperience?.["speakerCommunication"], r.eventExperience?.["speakerKnowledge"]].filter(
        (n): n is number => typeof n === "number",
      ),
    );

    const learningOverall = responses.flatMap((r) =>
      WORKSHOP_LEARNING_METRICS.map(([k]) => (r.learningImpact as Record<string, number> | null)?.[k]).filter(
        (n): n is number => typeof n === "number",
      ),
    );

    // NPS
    const npsScores = responses.map((r) => r.nps).filter((n): n is number => typeof n === "number");
    const promoters = npsScores.filter((n) => n >= 9).length;
    const passives = npsScores.filter((n) => n >= 7 && n <= 8).length;
    const detractors = npsScores.filter((n) => n <= 6).length;
    const npsScore = npsScores.length
      ? Math.round(((promoters - detractors) / npsScores.length) * 100)
      : null;

    // Career & business impact
    const careerAnswered = responses.filter((r) => r.careerImpact?.careerHelp);
    const careerRelevancePct = pct(
      careerAnswered.filter((r) =>
        ["Definitely", "Probably"].includes(r.careerImpact?.careerHelp ?? ""),
      ).length,
      careerAnswered.length,
    );

    // Confidence / hands-on (learning ratings >= 4)
    const confidenceNums = responses
      .map((r) => r.learningImpact?.["confidentToTry"])
      .filter((n): n is number => typeof n === "number");
    const confidencePct = pct(confidenceNums.filter((n) => n >= 4).length, confidenceNums.length);
    const handsOnNums = responses
      .map((r) => r.learningImpact?.["examplesPractical"])
      .filter((n): n is number => typeof n === "number");
    const handsOnPct = pct(handsOnNums.filter((n) => n >= 4).length, handsOnNums.length);

    // Future engagement
    const contactAnswered = responses.filter((r) => r.futureEngagement?.canContact);
    const followUpPct = pct(
      contactAnswered.filter((r) => r.futureEngagement?.canContact === "Yes").length,
      contactAnswered.length,
    );
    const internshipPlacementPct = pct(
      responses.filter((r) =>
        (r.futureEngagement?.interests ?? []).some((i) => /internship|placement/i.test(i)),
      ).length,
      total,
    );
    const communityPct = pct(
      responses.filter((r) => (r.futureEngagement?.stayConnected ?? []).length > 0).length,
      total,
    );

    // Product feedback
    const tryNums = responses
      .map((r) => r.productFeedback?.tryLikelihood)
      .filter((n): n is number => typeof n === "number");
    const productInterestPct = pct(tryNums.filter((n) => n >= 4).length, tryNums.length);
    const productFeedback = {
      tryLikelihoodAvg: avg(tryNums),
      easeLookedAvg: avg(
        responses.map((r) => r.productFeedback?.easeLooked).filter((n): n is number => typeof n === "number"),
      ),
      wouldRecommendAvg: avg(
        responses
          .map((r) => r.productFeedback?.wouldRecommend)
          .filter((n): n is number => typeof n === "number"),
      ),
      productInterestPct,
      featureInterest: tally(responses.map((r) => r.productFeedback?.featureInterest)),
    };

    const openFeedback = responses
      .map((r) => ({
        name: r.name,
        liked: r.openFeedback?.liked,
        improve: r.openFeedback?.improve,
        suggestions: r.openFeedback?.suggestions,
        createdAt: r.createdAt.toISOString(),
      }))
      .filter((r) => r.liked || r.improve || r.suggestions);

    res.json({
      event: {
        id: event.id,
        slug: event.slug,
        title: event.title,
        college: event.college,
        eventDate: event.eventDate ? event.eventDate.toISOString() : null,
        mode: event.mode,
        status: event.status,
        registrationsCount: event.registrationsCount,
        attendeesCount: event.attendeesCount,
        sessions: event.sessions ?? [],
      },
      summary: {
        responseCount: total,
        attendanceRate: pct(event.attendeesCount, event.registrationsCount),
        feedbackResponseRate: pct(total, event.attendeesCount),
        avgSatisfaction: avg(satisfactionNums),
        npsScore,
        promoters,
        passives,
        detractors,
        npsRespondents: npsScores.length,
        speakerRating: avg(speakerNums),
        learningImpactAvg: avg(learningOverall),
        careerRelevancePct,
        confidencePct,
        handsOnPct,
        followUpPct,
        internshipPlacementPct,
        communityPct,
        productInterestPct,
      },
      eventExperience,
      learningImpact,
      sessions,
      topSession,
      lowestSession,
      audienceProfile: {
        describesYou: tally(responses.map((r) => r.audienceProfile?.describesYou)),
        aiExperience: tally(responses.map((r) => r.audienceProfile?.aiExperience)),
        builtAiBefore: tally(responses.map((r) => r.audienceProfile?.builtAiBefore)),
        usedVoiceAgentsBefore: tally(responses.map((r) => r.audienceProfile?.usedVoiceAgentsBefore)),
      },
      careerInterests: tallyList(responses.map((r) => r.careerImpact?.interests)),
      futureEngagementInterests: tallyList(responses.map((r) => r.futureEngagement?.interests)),
      stayConnectedChannels: tallyList(responses.map((r) => r.futureEngagement?.stayConnected)),
      topFutureTopics: tallyList(responses.map((r) => r.futureTopics)),
      outcomes: tallyList(responses.map((r) => r.outcomes)),
      productFeedback,
      openFeedback,
    });
  } catch (err) {
    logger.error({ err }, "workshop analytics failed");
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/admin/events/:id/responses", async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const responses = await db
      .select()
      .from(workshopResponsesTable)
      .where(eq(workshopResponsesTable.eventId, id))
      .orderBy(desc(workshopResponsesTable.createdAt));
    res.json(
      responses.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    logger.error({ err }, "list workshop responses failed");
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
