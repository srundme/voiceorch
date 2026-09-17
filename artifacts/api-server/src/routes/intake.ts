import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db, candidateIntakesTable, type CandidateIntake } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { getAuth } from "../lib/auth-compat.js";
import { logger } from "../lib/logger.js";
import { onIntakeChange } from "../lib/intake-events.js";
import {
  INTAKE_FIELD_KEYS,
  missingIntakeFields,
  type IntakeFieldKey,
} from "../lib/candidate-intake-fields.js";
import {
  DISPOSITION_MEANINGS,
  INTAKE_DISPOSITIONS,
  missingDispositionFields,
  type IntakeExtra,
} from "../lib/intake-dispositions.js";
import { INTAKE_JOBS } from "../lib/intake-jobs.js";
import {
  applyIntakeWrite,
  completeIntakeSession,
  createIntakeSession,
  intakeExtraOf,
  intakeFormUrl,
  loadIntakeByToken,
} from "../lib/intake-service.js";

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
  dispositionIds: string[];
  /** Keyed by disposition id, then field id. */
  dispositionAnswers: Record<string, Record<string, string | number | null>>;
  missingDispositionFields: string[];
  /** Live read of the caller's English, built from the call itself. */
  english: { rating: string; confidence: number; evidence: string[]; samples: number } | null;
  proposedJob: Record<string, unknown> | null;
  alternatives: Record<string, unknown>[];
  speakScript: string | null;
  talkingPoints: string[];
  matchNote: string | null;
  profile: Record<string, unknown> | null;
  /** 6-digit Indian PIN from the recruiter screen. */
  pincode: string | null;
  lastCompany: string | null;
  tenure: string | null;
  updatedAt: string;
  createdAt: string;
}

function extraOf(row: CandidateIntake): IntakeExtra {
  return intakeExtraOf(row);
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
    dispositionIds: extra.dispositionIds,
    dispositionAnswers: extra.answers,
    missingDispositionFields: missingDispositionFields(extra),
    english: extra.english ?? null,
    proposedJob: (extra.match?.["proposed"] as Record<string, unknown> | null) ?? null,
    alternatives: Array.isArray(extra.match?.["alternatives"])
      ? extra.match["alternatives"] as Record<string, unknown>[]
      : [],
    speakScript: typeof extra.match?.["speakScript"] === "string" ? extra.match["speakScript"] : null,
    talkingPoints: Array.isArray(extra.match?.["talkingPoints"])
      ? extra.match["talkingPoints"].filter((p): p is string => typeof p === "string")
      : [],
    matchNote: typeof extra.match?.["note"] === "string" ? extra.match["note"] : null,
    profile: (extra.match?.["profile"] as Record<string, unknown> | null) ?? null,
    pincode: extra.screen?.pincode
      ?? (typeof extra.answers["non_hiring_zone"]?.["candidate_pincode"] === "string"
        ? extra.answers["non_hiring_zone"]["candidate_pincode"]
        : null),
    lastCompany: extra.screen?.lastCompany ?? null,
    tenure: extra.screen?.tenure ?? null,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

const formUrlFor = intakeFormUrl;
const loadByToken = loadIntakeByToken;

// ── Authed: create / list intake sessions ───────────────────────────────────

router.post("/intake/sessions", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const parsed = CreateSessionBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", issues: parsed.error.flatten() });
    return;
  }
  try {
    const row = await createIntakeSession({
      userId: userId!,
      agentId: parsed.data.agentId ?? null,
      callId: parsed.data.callId ?? null,
      phone: parsed.data.phone ?? null,
      jobCity: parsed.data.jobCity ?? null,
    });
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
  res.json({
    // The meaning rides along so the form can show the recruiter when each
    // outcome applies, same wording the agent reasons over.
    dispositions: INTAKE_DISPOSITIONS.map((d) => ({
      ...d,
      meaning: DISPOSITION_MEANINGS[d.id] ?? null,
    })),
    jobs: INTAKE_JOBS,
  });
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
  try {
    const existing = await loadByToken(token.data);
    if (!existing) {
      res.status(404).json({ error: "Intake form not found" });
      return;
    }
    const { row, written, errors } = await applyIntakeWrite(
      token.data,
      parsed.data.fields,
      parsed.data.source ?? "agent",
    );
    if (!row) {
      res.status(400).json({ error: "No valid fields to write", fieldErrors: errors });
      return;
    }
    res.json({ ...toDto(row), written, fieldErrors: errors });
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
  try {
    const result = await completeIntakeSession(token.data, parsed.data.englishCommunication);
    if (!result.row) {
      if (result.errors.length > 0) {
        res.status(400).json({ error: "Invalid English communication rating", fieldErrors: result.errors });
        return;
      }
      res.status(404).json({ error: "Intake form not found" });
      return;
    }
    res.json(toDto(result.row));
  } catch (err) {
    logger.error({ err }, "intake complete failed");
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
