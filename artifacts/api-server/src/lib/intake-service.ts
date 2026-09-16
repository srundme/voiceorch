/**
 * Intake form reads and writes, shared by the HTTP routes and the agent's
 * in-call tools. Both go through here so a value typed by a human and a value
 * spoken to the agent are normalized, versioned and broadcast identically.
 */
import crypto from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db, agentsTable, candidateIntakesTable, type CandidateIntake } from "@workspace/db";
import { logger } from "./logger.js";
import { getSelfBaseUrl } from "./app-domain.js";
import { emitIntakeChange } from "./intake-events.js";
import {
  INTAKE_FIELD_KEYS,
  INTAKE_LOCKED_FIELDS,
  normalizeIntakePatch,
  type IntakeFieldKey,
} from "./candidate-intake-fields.js";
import {
  applyDispositionPatch,
  parseIntakeExtra,
  type IntakeExtra,
} from "./intake-dispositions.js";
import { buildIntakeProfile, matchIntakeJobs } from "./intake-job-match.js";
import { inferGenderFromName } from "./intake-gender.js";
import { englishRatingForForm, updateEnglishRead, type EnglishTurnInput } from "./intake-english.js";

/**
 * A form the operator opened just before the call rings is adopted instead of
 * creating a second one, so the screen they are already watching is the screen
 * that fills in.
 */
const ADOPT_WINDOW_MS = 15 * 60 * 1000;

export interface FieldError {
  field: string;
  message: string;
}

export function intakeExtraOf(row: CandidateIntake): IntakeExtra {
  return parseIntakeExtra(row.extra);
}

export function intakeFormUrl(token: string): string {
  const base = (process.env["APP_BASE_URL"] ?? getSelfBaseUrl()).replace(/\/+$/, "");
  return `${base}/intake/${token}`;
}

export async function loadIntakeByToken(token: string): Promise<CandidateIntake | null> {
  const [row] = await db
    .select()
    .from(candidateIntakesTable)
    .where(eq(candidateIntakesTable.publicToken, token))
    .limit(1);
  return row ?? null;
}

export async function loadIntakeByCallId(callId: number): Promise<CandidateIntake | null> {
  const [row] = await db
    .select()
    .from(candidateIntakesTable)
    .where(eq(candidateIntakesTable.callId, callId))
    .orderBy(desc(candidateIntakesTable.id))
    .limit(1);
  return row ?? null;
}

export interface CreateIntakeInput {
  userId: string;
  agentId?: number | null;
  callId?: number | null;
  phone?: string | null;
  jobCity?: string | null;
}

export async function createIntakeSession(input: CreateIntakeInput): Promise<CandidateIntake | null> {
  const seed = normalizeIntakePatch({
    ...(input.phone ? { phone: input.phone } : {}),
    ...(input.jobCity ? { jobCity: input.jobCity } : {}),
  });
  const [row] = await db
    .insert(candidateIntakesTable)
    .values({
      publicToken: crypto.randomBytes(16).toString("hex"),
      userId: input.userId,
      agentId: input.agentId ?? null,
      callId: input.callId ?? null,
      ...INTAKE_LOCKED_FIELDS,
      ...seed.values,
    })
    .returning();
  return row ?? null;
}

/**
 * The form for a live call. Returns the same row for every tool call in a call,
 * adopting a form the operator pre-opened for this agent when there is one.
 */
export async function ensureIntakeForCall(params: {
  callId: number;
  agentId: number;
  callerPhone?: string | null;
}): Promise<CandidateIntake | null> {
  const existing = await loadIntakeByCallId(params.callId);
  if (existing) return existing;

  const [agent] = await db
    .select({ userId: agentsTable.userId })
    .from(agentsTable)
    .where(eq(agentsTable.id, params.agentId))
    .limit(1);
  const userId = agent?.userId;
  if (!userId) {
    logger.warn({ agentId: params.agentId, callId: params.callId }, "intake: agent has no owner, cannot open form");
    return null;
  }

  const since = new Date(Date.now() - ADOPT_WINDOW_MS);
  const [adoptable] = await db
    .select()
    .from(candidateIntakesTable)
    .where(and(
      eq(candidateIntakesTable.userId, userId),
      eq(candidateIntakesTable.status, "in_progress"),
      isNull(candidateIntakesTable.callId),
      gt(candidateIntakesTable.createdAt, since),
    ))
    .orderBy(desc(candidateIntakesTable.id))
    .limit(1);

  if (adoptable) {
    const phone = params.callerPhone
      ? normalizeIntakePatch({ phone: params.callerPhone }).values
      : {};
    const [row] = await db
      .update(candidateIntakesTable)
      .set({
        callId: params.callId,
        agentId: params.agentId,
        ...(adoptable.phone ? {} : phone),
        revision: sql`${candidateIntakesTable.revision} + 1`,
      })
      .where(eq(candidateIntakesTable.id, adoptable.id))
      .returning();
    if (row) {
      emitIntakeChange(row.publicToken, row.revision);
      logger.info({ callId: params.callId, token: row.publicToken }, "intake: adopted pre-opened form for call");
      return row;
    }
  }

  const created = await createIntakeSession({
    userId,
    agentId: params.agentId,
    callId: params.callId,
    phone: params.callerPhone ?? null,
  });
  if (created) {
    logger.info({ callId: params.callId, token: created.publicToken }, "intake: opened form for call");
  }
  return created;
}

export interface IntakeWriteResult {
  row: CandidateIntake;
  written: string[];
  errors: FieldError[];
}

/**
 * Applies a patch of candidate answers and/or disposition answers. Keys that
 * are not intake columns are handed to the disposition normalizer, which is
 * what lets `{ disposition: "Not Interested", reason: "Already Placed" }` land
 * in one call.
 */
export async function applyIntakeWrite(
  token: string,
  fields: Record<string, unknown>,
  source: "agent" | "human",
): Promise<IntakeWriteResult | { row: null; written: []; errors: FieldError[] }> {
  const typedInput: Record<string, unknown> = {};
  const extraInput: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (INTAKE_FIELD_KEYS.includes(key as IntakeFieldKey)) typedInput[key] = value;
    else extraInput[key] = value;
  }

  const { values, errors: typedErrors } = normalizeIntakePatch(typedInput);

  const existing = await loadIntakeByToken(token);
  if (!existing) return { row: null, written: [], errors: [] };

  // Gender is read off the name instead of being asked for. Only fill it when
  // it is still blank and the name is unambiguous, and never override a value
  // someone set by hand.
  if (!existing.gender && !("gender" in values)) {
    const first = values.firstName ?? existing.firstName;
    const last = values.lastName ?? existing.lastName;
    const guess = inferGenderFromName([first, last].filter(Boolean).join(" "));
    if (guess) values.gender = guess;
  }

  const typedKeys = Object.keys(values) as IntakeFieldKey[];

  const extraResult = Object.keys(extraInput).length > 0
    ? applyDispositionPatch(intakeExtraOf(existing), extraInput)
    : { extra: intakeExtraOf(existing), written: [] as string[], errors: [] as FieldError[] };

  const errors = [...typedErrors, ...extraResult.errors];
  const written = [...typedKeys, ...extraResult.written];
  if (written.length === 0) return { row: null, written: [], errors };

  const [row] = await db
    .update(candidateIntakesTable)
    .set({
      ...values,
      extra: extraResult.extra as unknown as Record<string, unknown>,
      lastFieldKey: written[written.length - 1]!,
      lastWriteSource: source,
      revision: sql`${candidateIntakesTable.revision} + 1`,
    })
    .where(eq(candidateIntakesTable.publicToken, token))
    .returning();
  if (!row) return { row: null, written: [], errors };

  emitIntakeChange(row.publicToken, row.revision);
  return { row, written, errors };
}

/**
 * Folds one caller turn into the live English read for this call's form.
 *
 * The rating is a judgement on how the candidate speaks, so it is built from
 * their own transcripts while the call runs rather than asked for or guessed
 * afterwards. Never throws — a scoring failure must not disturb a live call.
 */
export async function recordIntakeEnglishTurn(
  callId: number,
  turn: EnglishTurnInput,
): Promise<void> {
  try {
    const existing = await loadIntakeByCallId(callId);
    if (!existing || existing.status === "completed") return;

    const extra = intakeExtraOf(existing);
    const next = updateEnglishRead(extra.english, turn);
    if (next.samples === (extra.english?.samples ?? 0)) return;

    extra.english = next;
    const [row] = await db
      .update(candidateIntakesTable)
      .set({
        extra: extra as unknown as Record<string, unknown>,
        revision: sql`${candidateIntakesTable.revision} + 1`,
      })
      .where(eq(candidateIntakesTable.id, existing.id))
      .returning();
    if (row) emitIntakeChange(row.publicToken, row.revision);
  } catch (err) {
    logger.warn({ err, callId }, "intake: english scoring failed");
  }
}

/**
 * Closes the form, runs JD matching and stores the proposed job plus the
 * candidate profile. When no rating is passed in, the live read built from the
 * caller's own speech is used.
 */
export async function completeIntakeSession(
  token: string,
  englishCommunication?: string,
): Promise<{ row: CandidateIntake } | { row: null; errors: FieldError[] }> {
  const existing = await loadIntakeByToken(token);
  if (!existing) return { row: null, errors: [] };

  const extra = intakeExtraOf(existing);
  const rating = englishCommunication
    ?? (existing.englishCommunication ? undefined : englishRatingForForm(extra.english) ?? undefined);

  const { values, errors } = rating
    ? normalizeIntakePatch({ englishCommunication: rating })
    : { values: {}, errors: [] as FieldError[] };
  if (errors.length > 0) return { row: null, errors };

  const forMatch = { ...existing, ...values };
  const matched = matchIntakeJobs(forMatch, extra);
  extra.match = {
    proposed: matched.proposed,
    alternatives: matched.alternatives,
    speakScript: matched.speakScript,
    talkingPoints: matched.talkingPoints,
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
    .where(eq(candidateIntakesTable.publicToken, token))
    .returning();
  if (!row) return { row: null, errors: [] };

  emitIntakeChange(row.publicToken, row.revision);
  return { row };
}

/**
 * Attaches the recording and transcript to the stored candidate profile.
 *
 * Both only exist after the leg is torn down, so the profile written during
 * the call carries nulls and is topped up from here. If the form was never
 * closed on the call, close it now — a completed call should always leave a
 * profile behind.
 */
export async function attachIntakeCallArtifacts(params: {
  callId: number;
  recordingUrl?: string | null;
  transcript?: string | null;
  durationSeconds?: number | null;
}): Promise<void> {
  try {
    const existing = await loadIntakeByCallId(params.callId);
    if (!existing) return;

    const closed = existing.status === "completed"
      ? existing
      : (await completeIntakeSession(existing.publicToken)).row ?? existing;

    const extra = intakeExtraOf(closed);
    const match = (extra.match ?? {}) as Record<string, unknown>;
    const profile = (match["profile"] ?? {}) as Record<string, unknown>;
    extra.match = {
      ...match,
      profile: {
        ...profile,
        callId: params.callId,
        recordingUrl: params.recordingUrl ?? profile["recordingUrl"] ?? null,
        transcript: params.transcript ?? profile["transcript"] ?? null,
        callDurationSeconds: params.durationSeconds ?? profile["callDurationSeconds"] ?? null,
      },
    };

    const [row] = await db
      .update(candidateIntakesTable)
      .set({
        extra: extra as unknown as Record<string, unknown>,
        revision: sql`${candidateIntakesTable.revision} + 1`,
      })
      .where(eq(candidateIntakesTable.id, closed.id))
      .returning();
    if (row) emitIntakeChange(row.publicToken, row.revision);
  } catch (err) {
    logger.warn({ err, callId: params.callId }, "intake: could not attach call artifacts");
  }
}
