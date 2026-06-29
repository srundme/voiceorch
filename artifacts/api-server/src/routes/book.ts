import { Router } from "express";
import { eq, sql, desc, and, gt } from "drizzle-orm";
import { z } from "zod";
import { db, bookProgressTable, bookExamAttemptsTable, bookInternsTable } from "@workspace/db";
import {
  EXAM_DURATION_MINUTES,
  EXAM_PASS_MARKS,
  EXAM_TOTAL_MARKS,
  getPublicQuestions,
  gradeExam,
  filterKnownAnswers,
  type ExamAnswerMap,
} from "../lib/book-exam.js";

/**
 * The SnapServe Book — anonymous per-device reading progress.
 *
 * No auth: the book has no login. Each browser generates a UUID once and stores
 * it in localStorage; that UUID is the row key. Mounted in the PUBLIC section of
 * routes/index.ts (before `provisionUser`) so it never touches the Google session.
 *
 * All mutations are atomic at the SQL level (ON CONFLICT array-union / jsonb
 * merge / array_remove) so concurrent tabs on the same device never lose writes.
 * Reads never create a row — a first-time device just gets empty defaults.
 */
const router = Router();

const DeviceId = z.string().uuid();
const Slug = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9-]*$/i, "slug must be alphanumeric/dash");

const GetQuery = z.object({ deviceId: DeviceId });
const ChapterRef = z.object({ deviceId: DeviceId, slug: Slug });
const QuizBody = z.object({
  deviceId: DeviceId,
  chapterSlug: Slug,
  questionIndex: z.number().int().min(0).max(999),
  answerIndex: z.number().int().min(0).max(999),
});

interface ProgressResponse {
  deviceId: string;
  completedChapters: string[];
  quizAnswers: Record<string, number>;
}

function toResponse(row: {
  deviceId: string;
  completedChapters: string[] | null;
  quizAnswers: Record<string, number> | null;
}): ProgressResponse {
  return {
    deviceId: row.deviceId,
    completedChapters: row.completedChapters ?? [],
    quizAnswers: row.quizAnswers ?? {},
  };
}

const empty = (deviceId: string): ProgressResponse => ({
  deviceId,
  completedChapters: [],
  quizAnswers: {},
});

/* ── GET /api/book/progress?deviceId=<uuid> ──────────────────────────────── */
router.get("/book/progress", async (req, res): Promise<void> => {
  const parsed = GetQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid deviceId", issues: parsed.error.issues });
    return;
  }
  const { deviceId } = parsed.data;

  const [row] = await db
    .select()
    .from(bookProgressTable)
    .where(eq(bookProgressTable.deviceId, deviceId));

  res.json(row ? toResponse(row) : empty(deviceId));
});

/* ── POST /api/book/progress/complete ────────────────────────────────────── */
router.post("/book/progress/complete", async (req, res): Promise<void> => {
  const parsed = ChapterRef.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }
  const { deviceId, slug } = parsed.data;

  const [row] = await db
    .insert(bookProgressTable)
    .values({ deviceId, completedChapters: [slug] })
    .onConflictDoUpdate({
      target: bookProgressTable.deviceId,
      set: {
        completedChapters: sql`array(select distinct e from unnest(${bookProgressTable.completedChapters} || array[${slug}]::text[]) as e)`,
        updatedAt: sql`now()`,
      },
    })
    .returning();

  res.json(toResponse(row));
});

/* ── POST /api/book/progress/uncomplete ──────────────────────────────────── */
router.post("/book/progress/uncomplete", async (req, res): Promise<void> => {
  const parsed = ChapterRef.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }
  const { deviceId, slug } = parsed.data;

  const [row] = await db
    .update(bookProgressTable)
    .set({
      completedChapters: sql`array_remove(${bookProgressTable.completedChapters}, ${slug})`,
      updatedAt: sql`now()`,
    })
    .where(eq(bookProgressTable.deviceId, deviceId))
    .returning();

  res.json(row ? toResponse(row) : empty(deviceId));
});

/* ── POST /api/book/progress/quiz ────────────────────────────────────────── */
router.post("/book/progress/quiz", async (req, res): Promise<void> => {
  const parsed = QuizBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }
  const { deviceId, chapterSlug, questionIndex, answerIndex } = parsed.data;
  const patch = JSON.stringify({ [`${chapterSlug}_${questionIndex}`]: answerIndex });

  const [row] = await db
    .insert(bookProgressTable)
    .values({ deviceId, quizAnswers: { [`${chapterSlug}_${questionIndex}`]: answerIndex } })
    .onConflictDoUpdate({
      target: bookProgressTable.deviceId,
      set: {
        quizAnswers: sql`coalesce(${bookProgressTable.quizAnswers}, '{}'::jsonb) || ${patch}::jsonb`,
        updatedAt: sql`now()`,
      },
    })
    .returning();

  res.json(toResponse(row));
});

/* ── The SnapServe Book — final exam (server-graded gatekeeper) ───────────── */

/* GET /api/book/exam — sanitized question bank (NO answer key / explanations) */
router.get("/book/exam", (_req, res): void => {
  const questions = getPublicQuestions();
  res.json({
    questions,
    totalMarks: EXAM_TOTAL_MARKS,
    passMarks: EXAM_PASS_MARKS,
    durationMinutes: EXAM_DURATION_MINUTES,
    questionCount: questions.length,
  });
});

const AnswerValue = z.union([
  z.number().int().min(0).max(99),
  z.array(z.number().int().min(0).max(99)).max(20),
]);
const ExamSubmitBody = z.object({
  deviceId: DeviceId,
  // Cap the key count so a public, unauthenticated caller can't push an arbitrarily
  // large object into the jsonb column. The bank is 25 questions; 64 is generous slack.
  answers: z
    .record(z.string().min(1).max(64), AnswerValue)
    .refine((a) => Object.keys(a).length <= 64, { message: "Too many answers" }),
  durationSeconds: z.number().int().min(0).max(86400).optional(),
});

/* POST /api/book/exam/submit — server grades, records the attempt, returns the review */
router.post("/book/exam/submit", async (req, res): Promise<void> => {
  const parsed = ExamSubmitBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }
  const { deviceId, durationSeconds } = parsed.data;

  // Per-device throttle. The exam is a real gatekeeper: returning a score on an
  // unauthenticated, retakeable endpoint is an inherent (if weak) oracle, so we
  // cap submission frequency to make scripted answer-probing impractical and to
  // protect the DB from spam. deviceId is client-supplied so this is best-effort,
  // not a hard guarantee.
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await db
    .select({ createdAt: bookExamAttemptsTable.createdAt })
    .from(bookExamAttemptsTable)
    .where(and(eq(bookExamAttemptsTable.deviceId, deviceId), gt(bookExamAttemptsTable.createdAt, since)))
    .orderBy(desc(bookExamAttemptsTable.createdAt));
  if (recent.length >= 20) {
    res.status(429).json({ error: "Too many attempts this hour. Take a break and try again later." });
    return;
  }
  if (recent[0] && Date.now() - recent[0].createdAt.getTime() < 10_000) {
    res.status(429).json({ error: "Slow down — wait a few seconds between attempts." });
    return;
  }

  const answers = filterKnownAnswers(parsed.data.answers as ExamAnswerMap);
  const grade = gradeExam(answers);

  const [row] = await db
    .insert(bookExamAttemptsTable)
    .values({
      deviceId,
      score: grade.score,
      total: grade.total,
      passed: grade.passed,
      durationSeconds: durationSeconds ?? null,
      answers,
    })
    .returning();

  res.json({
    attemptId: row.id,
    score: grade.score,
    total: grade.total,
    passMarks: grade.passMarks,
    passed: grade.passed,
    durationSeconds: row.durationSeconds,
    createdAt: row.createdAt.toISOString(),
  });
});

/* GET /api/book/exam/attempts?deviceId=<uuid> — attempt history + best score */
router.get("/book/exam/attempts", async (req, res): Promise<void> => {
  const parsed = GetQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid deviceId", issues: parsed.error.issues });
    return;
  }
  const { deviceId } = parsed.data;

  const rows = await db
    .select()
    .from(bookExamAttemptsTable)
    .where(eq(bookExamAttemptsTable.deviceId, deviceId))
    .orderBy(desc(bookExamAttemptsTable.createdAt));

  res.json({
    attempts: rows.map((r) => ({
      id: r.id,
      score: r.score,
      total: r.total,
      passed: r.passed,
      durationSeconds: r.durationSeconds,
      createdAt: r.createdAt.toISOString(),
    })),
    bestScore: rows.reduce((m, r) => Math.max(m, r.score), 0),
    total: EXAM_TOTAL_MARKS,
    passMarks: EXAM_PASS_MARKS,
    passed: rows.some((r) => r.passed),
    attemptCount: rows.length,
  });
});

// POST /api/book/interns/register — link a name+email identity to a deviceId
router.post("/book/interns/register", async (req, res): Promise<void> => {
  const Body = z.object({
    name: z.string().min(2).max(200),
    email: z.string().email(),
    deviceId: DeviceId,
  });
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
    return;
  }
  const { name, email, deviceId } = parsed.data;
  try {
    const [row] = await db
      .insert(bookInternsTable)
      .values({ name, email, deviceId, registeredAt: new Date(), lastActivityAt: new Date() })
      .onConflictDoUpdate({
        target: bookInternsTable.email,
        set: { name, deviceId, lastActivityAt: new Date() },
      })
      .returning({ id: bookInternsTable.id });
    res.json({ id: row!.id });
  } catch (err) {
    req.log.error({ err }, "book/interns/register failed");
    res.status(500).json({ error: "Failed to register intern" });
  }
});

// PATCH /api/book/interns/:deviceId/activity — update lastActivityAt on chapter complete
router.patch("/book/interns/:deviceId/activity", async (req, res): Promise<void> => {
  const parsed = DeviceId.safeParse(req.params["deviceId"]);
  if (!parsed.success) { res.status(400).json({ error: "Invalid deviceId" }); return; }
  await db
    .update(bookInternsTable)
    .set({ lastActivityAt: new Date() })
    .where(eq(bookInternsTable.deviceId, parsed.data));
  res.json({ ok: true });
});

export default router;
