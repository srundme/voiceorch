import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, bookProgressTable } from "@workspace/db";

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

export default router;
