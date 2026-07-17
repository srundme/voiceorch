import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, workshopEventsTable, workshopResponsesTable } from "@workspace/db";
import { workshopMetaRateLimit, workshopSubmitRateLimit } from "../lib/rate-limit.js";
import { logger } from "../lib/logger.js";

/**
 * Public workshop feedback form — no auth.
 *
 * Mounted in the PUBLIC block of routes/index.ts (before `provisionUser`) so it
 * never touches the Google session. Students open `/workshop/:slug`, the SPA
 * fetches meta here, then POSTs the fixed 12-section form. Rate-limited per
 * (IP, slug) and per (IP, email). Modeled on routes/book.ts + scheduling/public.ts.
 */
const router: IRouter = Router();

const Slug = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9-]*$/i, "slug must be alphanumeric/dash");

const Rating = z.number().int().min(1).max(5);
const RatingMap = z.record(z.string().max(120), Rating);
const ShortText = z.string().max(300);
const LongText = z.string().max(5000);
const StringList = z.array(z.string().max(300)).max(50);

const ResponseBody = z.object({
  // Section 1 — participant identity
  name: ShortText.optional(),
  email: z.string().email().max(320),
  phone: z.string().max(40).optional(),
  college: ShortText.optional(),
  department: ShortText.optional(),
  yearOrExperience: ShortText.optional(),
  city: ShortText.optional(),
  // Section 2 — audience profile
  audienceProfile: z
    .object({
      describesYou: ShortText.optional(),
      aiExperience: ShortText.optional(),
      builtAiBefore: ShortText.optional(),
      usedVoiceAgentsBefore: ShortText.optional(),
    })
    .optional(),
  // Section 3 — event experience ratings (metric key -> 1-5)
  eventExperience: RatingMap.optional(),
  // Section 4 — session-wise ratings (sessionId -> 1-5)
  sessionRatings: RatingMap.optional(),
  // Section 5 — learning impact ratings (metric key -> 1-5)
  learningImpact: RatingMap.optional(),
  // Section 6 — career & business impact
  careerImpact: z
    .object({
      interests: StringList.optional(),
      careerHelp: ShortText.optional(),
    })
    .optional(),
  // Section 7 — future engagement
  futureEngagement: z
    .object({
      interests: StringList.optional(),
      stayConnected: StringList.optional(),
      canContact: ShortText.optional(),
    })
    .optional(),
  // Section 8 — future workshop topics
  futureTopics: StringList.optional(),
  // Section 9 — open feedback
  openFeedback: z
    .object({
      liked: LongText.optional(),
      improve: LongText.optional(),
      suggestions: LongText.optional(),
    })
    .optional(),
  // Section 10 — NPS
  nps: z.number().int().min(0).max(10).optional(),
  // Section 11 — workshop outcomes
  outcomes: StringList.optional(),
  // Section 12 — SnapServe product feedback
  productFeedback: z
    .object({
      tryLikelihood: Rating.optional(),
      easeLooked: Rating.optional(),
      wouldRecommend: Rating.optional(),
      featureInterest: ShortText.optional(),
    })
    .optional(),
});

router.get("/workshop/:slug", workshopMetaRateLimit, async (req, res): Promise<void> => {
  const parsed = Slug.safeParse(req.params["slug"]);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid slug" });
    return;
  }
  try {
    const [ev] = await db
      .select()
      .from(workshopEventsTable)
      .where(eq(workshopEventsTable.slug, parsed.data))
      .limit(1);
    if (!ev) {
      res.status(404).json({ error: "Workshop not found" });
      return;
    }
    res.json({
      slug: ev.slug,
      title: ev.title,
      college: ev.college,
      eventDate: ev.eventDate ? ev.eventDate.toISOString() : null,
      mode: ev.mode,
      sessions: ev.sessions ?? [],
      status: ev.status,
    });
  } catch (err) {
    logger.error({ err, slug: parsed.data }, "workshop meta lookup failed");
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/workshop/:slug/responses", workshopSubmitRateLimit, async (req, res): Promise<void> => {
  const slugParsed = Slug.safeParse(req.params["slug"]);
  if (!slugParsed.success) {
    res.status(400).json({ error: "Invalid slug" });
    return;
  }
  const parsed = ResponseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid submission", details: parsed.error.flatten() });
    return;
  }
  try {
    const [ev] = await db
      .select()
      .from(workshopEventsTable)
      .where(eq(workshopEventsTable.slug, slugParsed.data))
      .limit(1);
    if (!ev) {
      res.status(404).json({ error: "Workshop not found" });
      return;
    }
    if (ev.status === "closed") {
      res.status(403).json({ error: "This feedback form is closed." });
      return;
    }
    const b = parsed.data;
    await db.insert(workshopResponsesTable).values({
      eventId: ev.id,
      name: b.name ?? null,
      email: b.email,
      phone: b.phone ?? null,
      college: b.college ?? null,
      department: b.department ?? null,
      yearOrExperience: b.yearOrExperience ?? null,
      city: b.city ?? null,
      audienceProfile: b.audienceProfile ?? null,
      eventExperience: b.eventExperience ?? null,
      sessionRatings: b.sessionRatings ?? null,
      learningImpact: b.learningImpact ?? null,
      careerImpact: b.careerImpact ?? null,
      futureEngagement: b.futureEngagement ?? null,
      futureTopics: b.futureTopics ?? null,
      openFeedback: b.openFeedback ?? null,
      nps: b.nps ?? null,
      outcomes: b.outcomes ?? null,
      productFeedback: b.productFeedback ?? null,
    });
    res.status(201).json({ ok: true });
  } catch (err) {
    logger.error({ err, slug: slugParsed.data }, "workshop response submit failed");
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
