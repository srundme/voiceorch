import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { eq, desc, sql } from "drizzle-orm";
import { db, candidateIntakesTable, type CandidateIntake } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { getAuth } from "../lib/auth-compat.js";
import { logger } from "../lib/logger.js";
import { getSelfBaseUrl } from "../lib/app-domain.js";
import { emitIntakeChange, onIntakeChange } from "../lib/intake-events.js";
import {
  INTAKE_FIELD_KEYS,
  INTAKE_LOCKED_FIELDS,
  missingIntakeFields,
  normalizeIntakePatch,
  type IntakeFieldKey,
} from "../lib/candidate-intake-fields.js";
import {
  INTAKE_DISPOSITIONS,
  applyDispositionPatch,
  missingDispositionFields,
  parseIntakeExtra,
  type IntakeExtra,
} from "../lib/intake-dispositions.js";
import { INTAKE_JOBS } from "../lib/intake-jobs.js";
import { buildIntakeProfile, matchIntakeJobs } from "../lib/intake-job-match.js";

/**
 * Candidate intake form — live during an inbound call.
 *
 * The agent PATCHes one answer at a time; every viewer of
 * `/intake/:token` sees it appear without reloading. Token routes are public
 * (the token is the credential, same trust model as /join/:token) so the form
 * can be opened on a screen with no login; `/intake/sessions` is authed.
 *
 * Mounted in the PUBLIC block of routes/index.ts, before `provisionUser`.
 */
const router: IRouter = Router();

/** How often the SSE handler re-reads the row (covers cross-instance writes). */
const STREAM_POLL_MS = 2_000;
/** Proxy idle timeouts kill a silent SSE connection; keep a comment frame going. */
const STREAM_HEARTBEAT_MS = 15_000;

const Token = z.string().regex(/^[a-f0-9]{32}$/, "Invalid form token");

const CreateSessionBody = z.object({
  agentId: z.number().int().positive().optional(),
  callId: z.number().int().positive().optional(),
  /** Pre-known values, e.g. caller ID on an inbound call. */
  phone: z.string().max(40).optional(),
  jobCity: z.string().max(80).optional(),
});

const PatchFieldsBody = z.object({
  fields: z.record(z.string().max(60), z.unknown()),
  source: z.enum(["agent", "human"]).optional(),
});

const CompleteBody = z.object({
  englishCommunication: z.string().max(40).optional(),
});

export interface IntakeDto {
  token: string;
  status: CandidateIntake["status"];
  revision: number;
  lastFieldKey: string | null;
  lastWriteSource: CandidateIntake["lastWriteSource"];
  agentId: number | null;
  callId: number | null;
  fields: Record<IntakeFieldKey, string | number | null>;
  missingFields: IntakeFieldKey[];
  dispositionId: string | null;
  dispositionAnswers: Record<string, string | number | null>;
  missingDispositionFields: string[];
  proposedJob: Record<string, unknown> | null;
  alternatives: Record<string, unknown>[];
  speakScript: string | null;
  matchNote: string | null;
  profile: Record<string, unknown> | null;
  updatedAt: string;
  createdAt: string;
}

function extraOf(row: CandidateIntake): IntakeExtra {
  return parseIntakeExtra(row.extra);
}

function toDto(row: CandidateIntake): IntakeDto {
  const fields = Object.fromEntries(
    INTAKE_FIELD_KEYS.map((key) => [key, row[key] ?? null]),
  ) as Record<IntakeFieldKey, string | number | null>;
  const extra = extraOf(row);
  return {
    token: row.publicToken,
    status: row.status,
    revision: row.revision,
    lastFieldKey: row.lastFieldKey,
    lastWriteSource: row.lastWriteSource,
    agentId: row.agentId,
    callId: row.callId,
    fields,
    missingFields: missingIntakeFields(fields),
    dispositionId: extra.dispositionId,
    dispositionAnswers: extra.answers,
    missingDispositionFields: missingDispositionFields(extra),
    proposedJob: (extra.match?.["proposed"] as Record<string, unknown> | null) ?? null,
    alternatives: Array.isArray(extra.match?.["alternatives"])
      ? extra.match["alternatives"] as Record<string, unknown>[]
      : [],
    speakScript: typeof extra.match?.["speakScript"] === "string" ? extra.match["speakScript"] : null,
    matchNote: typeof extra.match?.["note"] === "string" ? extra.match["note"] : null,
    profile: (extra.match?.["profile"] as Record<string, unknown> | null) ?? null,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function formUrlFor(token: string): string {
  const base = (process.env["APP_BASE_URL"] ?? getSelfBaseUrl()).replace(/\/+$/, "");
  return `${base}/intake/${token}`;
}

async function loadByToken(token: string): Promise<CandidateIntake | null> {
  const [row] = await db
    .select()
    .from(candidateIntakesTable)
    .where(eq(candidateIntakesTable.publicToken, token))
    .limit(1);
  return row ?? null;
}

// ── Authed: create / list intake sessions ───────────────────────────────────

router.post("/intake/sessions", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const parsed = CreateSessionBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", issues: parsed.error.flatten() });
    return;
  }
  const seed = normalizeIntakePatch({
    ...(parsed.data.phone ? { phone: parsed.data.phone } : {}),
    ...(parsed.data.jobCity ? { jobCity: parsed.data.jobCity } : {}),
  });
  try {
    const [row] = await db
      .insert(candidateIntakesTable)
      .values({
        publicToken: crypto.randomBytes(16).toString("hex"),
        userId,
        agentId: parsed.data.agentId ?? null,
        callId: parsed.data.callId ?? null,
        ...INTAKE_LOCKED_FIELDS,
        ...seed.values,
      })
      .returning();
    if (!row) {
      res.status(500).json({ error: "Could not create intake form" });
      return;
    }
    res.status(201).json({ ...toDto(row), formUrl: formUrlFor(row.publicToken) });
  } catch (err) {
    logger.error({ err, userId }, "intake session create failed");
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/intake/sessions", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  try {
    const rows = await db
      .select()
      .from(candidateIntakesTable)
      .where(eq(candidateIntakesTable.userId, userId!))
      .orderBy(desc(candidateIntakesTable.id))
      .limit(50);
    res.json(rows.map((row) => ({ ...toDto(row), formUrl: formUrlFor(row.publicToken) })));
  } catch (err) {
    logger.error({ err, userId }, "intake session list failed");
    res.status(500).json({ error: "Server error" });
  }
});

// ── Public by token: snapshot, live stream, agent writes ────────────────────

router.get("/intake/schema", (_req, res): void => {
  res.json({ dispositions: INTAKE_DISPOSITIONS, jobs: INTAKE_JOBS });
});

router.get("/intake/jobs", (_req, res): void => {
  res.json({ jobs: INTAKE_JOBS });
});

router.get("/intake/:token", async (req, res): Promise<void> => {
  const token = Token.safeParse(req.params["token"]);
  if (!token.success) {
    res.status(400).json({ error: "Invalid form token" });
    return;
  }
  try {
    const row = await loadByToken(token.data);
    if (!row) {
      res.status(404).json({ error: "Intake form not found" });
      return;
    }
    res.json(toDto(row));
  } catch (err) {
    logger.error({ err }, "intake snapshot failed");
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/intake/:token/stream", async (req, res): Promise<void> => {
  const token = Token.safeParse(req.params["token"]);
  if (!token.success) {
    res.status(400).json({ error: "Invalid form token" });
    return;
  }
  const row = await loadByToken(token.data).catch(() => null);
  if (!row) {
    res.status(404).json({ error: "Intake form not found" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let lastRevision = -1;
  let closed = false;

  const write = (payload: IntakeDto): void => {
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
      (res as unknown as { flush?: () => void }).flush?.();
    } catch {
      closed = true;
    }
  };

  const push = async (): Promise<void> => {
    if (closed) return;
    try {
      const current = await loadByToken(token.data);
      if (!current) return;
      if (current.revision === lastRevision) return;
      lastRevision = current.revision;
      write(toDto(current));
    } catch (err) {
      logger.warn({ err }, "intake stream read failed");
    }
  };

  await push();
  const unsubscribe = onIntakeChange(token.data, () => void push());
  const poll = setInterval(() => void push(), STREAM_POLL_MS);
  const heartbeat = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      closed = true;
    }
  }, STREAM_HEARTBEAT_MS);

  req.on("close", () => {
    closed = true;
    unsubscribe();
    clearInterval(poll);
    clearInterval(heartbeat);
    res.end();
  });
});

router.patch("/intake/:token/fields", async (req, res): Promise<void> => {
  const token = Token.safeParse(req.params["token"]);
  if (!token.success) {
    res.status(400).json({ error: "Invalid form token" });
    return;
  }
  const parsed = PatchFieldsBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", issues: parsed.error.flatten() });
    return;
  }
  const typedInput: Record<string, unknown> = {};
  const extraInput: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed.data.fields)) {
    if (INTAKE_FIELD_KEYS.includes(key as IntakeFieldKey)) typedInput[key] = value;
    else extraInput[key] = value;
  }
  const { values, errors: typedErrors } = normalizeIntakePatch(typedInput);
  const typedKeys = Object.keys(values) as IntakeFieldKey[];
  try {
    const existing = await loadByToken(token.data);
    if (!existing) {
      res.status(404).json({ error: "Intake form not found" });
      return;
    }
    const extraResult = Object.keys(extraInput).length > 0
      ? applyDispositionPatch(extraOf(existing), extraInput)
      : { extra: extraOf(existing), written: [] as string[], errors: [] as Array<{ field: string; message: string }> };
    const errors = [...typedErrors, ...extraResult.errors];
    const writtenKeys = [...typedKeys, ...extraResult.written];
    if (writtenKeys.length === 0) {
      res.status(400).json({ error: "No valid fields to write", fieldErrors: errors });
      return;
    }
    const [row] = await db
      .update(candidateIntakesTable)
      .set({
        ...values,
        extra: extraResult.extra as unknown as Record<string, unknown>,
        lastFieldKey: writtenKeys[writtenKeys.length - 1]!,
        lastWriteSource: parsed.data.source ?? "agent",
        revision: sql`${candidateIntakesTable.revision} + 1`,
      })
      .where(eq(candidateIntakesTable.publicToken, token.data))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Intake form not found" });
      return;
    }
    emitIntakeChange(row.publicToken, row.revision);
    res.json({ ...toDto(row), written: writtenKeys, fieldErrors: errors });
  } catch (err) {
    logger.error({ err }, "intake field write failed");
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * Close the form after the call. English communication is scored here because
 * it is a judgement on how the candidate spoke, not an answer they gave.
 */
router.post("/intake/:token/complete", async (req, res): Promise<void> => {
  const token = Token.safeParse(req.params["token"]);
  if (!token.success) {
    res.status(400).json({ error: "Invalid form token" });
    return;
  }
  const parsed = CompleteBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", issues: parsed.error.flatten() });
    return;
  }
  const rating = parsed.data.englishCommunication;
  const { values, errors } = rating
    ? normalizeIntakePatch({ englishCommunication: rating })
    : { values: {}, errors: [] as Array<{ field: string; message: string }> };
  if (errors.length > 0) {
    res.status(400).json({ error: "Invalid English communication rating", fieldErrors: errors });
    return;
  }
  try {
    const existing = await loadByToken(token.data);
    if (!existing) {
      res.status(404).json({ error: "Intake form not found" });
      return;
    }
    const extra = extraOf(existing);
    const forMatch = { ...existing, ...values };
    const matched = matchIntakeJobs(forMatch, extra);
    extra.match = {
      proposed: matched.proposed,
      alternatives: matched.alternatives,
      speakScript: matched.speakScript,
      note: matched.note,
      blocked: matched.blocked,
      profile: buildIntakeProfile(forMatch, extra, matched),
    };
    const [row] = await db
      .update(candidateIntakesTable)
      .set({
        ...values,
        extra: extra as unknown as Record<string, unknown>,
        status: "completed",
        lastFieldKey: rating ? "englishCommunication" : "disposition",
        lastWriteSource: "human",
        revision: sql`${candidateIntakesTable.revision} + 1`,
      })
      .where(eq(candidateIntakesTable.publicToken, token.data))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Intake form not found" });
      return;
    }
    emitIntakeChange(row.publicToken, row.revision);
    res.json(toDto(row));
  } catch (err) {
    logger.error({ err }, "intake complete failed");
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
