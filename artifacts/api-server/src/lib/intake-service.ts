/**
 * Intake form reads and writes, shared by the HTTP routes and the agent's
 * in-call tools. Both go through here so a value typed by a human and a value
 * spoken to the agent are normalized, versioned and broadcast identically.
 */
import crypto from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db, agentsTable, candidateIntakesTable, scheduledCallbacksTable, type CandidateIntake } from "@workspace/db";
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
import {
  mergeRecruiterProfile,
  parseRecruiterProfile,
  type RecruiterProfile,
} from "./recruiter-brain.js";
import {
  SCREEN_FLAG_KEYS,
  SCREEN_FLAG_TO_DISPOSITION,
  autoAnswersForDisposition,
  evaluateIntakeScreen,
  isBangalorePincode,
  isBangalorePlace,
  mergeScreenFlags,
  nonHiringAreaForPincode,
  parseLastCompany,
  parsePincode,
  parseScreenYesNo,
  parseTenure,
  type ScreenFlagKey,
} from "./intake-screen.js";
import { englishRatingForForm, updateEnglishRead, type EnglishTurnInput } from "./intake-english.js";
import { combineCallbackAt, findIntakeForCaller, lastTenDigits } from "./intake-call-context.js";
import { scheduleCallbackRequested, scheduleNetworkDropCallback } from "../services/autoRedial.js";

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
  if (existing) {
    if (!existing.phone && params.callerPhone) {
      const stamped = normalizeIntakePatch({ phone: params.callerPhone }).values;
      if (stamped.phone) {
        const [row] = await db
          .update(candidateIntakesTable)
          .set({
            phone: stamped.phone,
            revision: sql`${candidateIntakesTable.revision} + 1`,
          })
          .where(eq(candidateIntakesTable.id, existing.id))
          .returning();
        if (row) {
          emitIntakeChange(row.publicToken, row.revision);
          return row;
        }
      }
    }
    return existing;
  }

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

  // Same candidate calling back — keep filling the form they already have
  // instead of opening a blank one. Matched on last 10 digits so +91 and a
  // 10-digit mobile land on the same row.
  const prior = await findIntakeForCaller({ agentId: params.agentId, phone: params.callerPhone });
  if (prior) {
    const phone = params.callerPhone && !prior.phone
      ? normalizeIntakePatch({ phone: params.callerPhone }).values
      : {};
    const reopen = prior.dnd === "ACTIVATE" ? {} : { status: "in_progress" as const };
    const [row] = await db
      .update(candidateIntakesTable)
      .set({
        callId: params.callId,
        agentId: params.agentId,
        ...reopen,
        ...phone,
        revision: sql`${candidateIntakesTable.revision} + 1`,
      })
      .where(eq(candidateIntakesTable.id, prior.id))
      .returning();
    if (row) {
      emitIntakeChange(row.publicToken, row.revision);
      logger.info(
        { callId: params.callId, token: row.publicToken, priorCallId: prior.callId },
        "intake: resumed previous form for returning caller",
      );
      return row;
    }
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

  const cityForJob = String(values.city ?? existing.city ?? "");
  const jobCityEmpty = !(values.jobCity ?? existing.jobCity);
  if (jobCityEmpty && isBangalorePlace(cityForJob)) {
    values.jobCity = "BANGALORE";
  }

  const workStatus = values.workStatus ?? existing.workStatus;
  if (workStatus === "FRESHER" && values.totalCompanies == null && existing.totalCompanies == null) {
    values.totalCompanies = 0;
  }

  const screenPatch: Partial<Record<ScreenFlagKey, "yes" | "no">> = {};
  let pincodeValue: string | null = null;
  let pincodeError: string | null = null;
  let lastCompanyTouched = false;
  let lastCompanyValue: string | null = null;
  let lastCompanyError: string | null = null;
  let tenureTouched = false;
  let tenureValue: string | null = null;
  let tenureError: string | null = null;
  const restExtra: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(extraInput)) {
    if (key === "pincode" || key === "pinCode" || key === "pin") {
      pincodeValue = parsePincode(raw);
      if (!pincodeValue && String(raw ?? "").trim()) {
        pincodeError = "Pincode must be a 6-digit Indian PIN";
      }
      continue;
    }
    if (key === "lastCompany" || key === "companyName" || key === "currentCompany") {
      lastCompanyTouched = true;
      const text = String(raw ?? "").trim();
      if (!text) {
        lastCompanyValue = null;
      } else {
        lastCompanyValue = parseLastCompany(raw);
        if (!lastCompanyValue) lastCompanyError = "Company name looks empty or invalid";
      }
      continue;
    }
    if (key === "tenure" || key === "tenureYears" || key === "workingTenure") {
      tenureTouched = true;
      const text = String(raw ?? "").trim();
      if (!text) {
        tenureValue = null;
      } else {
        tenureValue = parseTenure(raw);
        if (!tenureValue) tenureError = "Tenure must look like 2 years or 18 months";
      }
      continue;
    }
    if ((SCREEN_FLAG_KEYS as readonly string[]).includes(key)) {
      const parsed = parseScreenYesNo(raw);
      if (parsed) screenPatch[key as ScreenFlagKey] = parsed;
      continue;
    }
    restExtra[key] = raw;
  }

  const extraResult = Object.keys(restExtra).length > 0
    ? applyDispositionPatch(intakeExtraOf(existing), restExtra)
    : { extra: intakeExtraOf(existing), written: [] as string[], errors: [] as FieldError[] };

  extraResult.extra.screen = mergeScreenFlags(extraResult.extra.screen, screenPatch);
  const fromDispositionPin = parsePincode(extraResult.extra.answers["non_hiring_zone"]?.["candidate_pincode"]);
  const pin = pincodeValue ?? fromDispositionPin ?? parsePincode(extraResult.extra.screen?.pincode);
  if (pin) {
    extraResult.extra.screen = mergeScreenFlags(extraResult.extra.screen, { pincode: pin });
    if (pincodeValue) extraResult.written.push("pincode");
  }
  if (pincodeError) extraResult.errors.push({ field: "pincode", message: pincodeError });
  if (lastCompanyTouched && !lastCompanyError) {
    extraResult.extra.screen = mergeScreenFlags(extraResult.extra.screen, { lastCompany: lastCompanyValue });
    extraResult.written.push("lastCompany");
  }
  if (lastCompanyError) extraResult.errors.push({ field: "lastCompany", message: lastCompanyError });
  if (tenureTouched && !tenureError) {
    extraResult.extra.screen = mergeScreenFlags(extraResult.extra.screen, { tenure: tenureValue });
    extraResult.written.push("tenure");
  }
  if (tenureError) extraResult.errors.push({ field: "tenure", message: tenureError });

  const mergedRow = {
    ...existing,
    ...values,
    city: (values.city ?? existing.city) as string | null,
    jobCity: (values.jobCity ?? existing.jobCity) as string | null,
    workStatus: (values.workStatus ?? existing.workStatus) as typeof existing.workStatus,
    dateOfBirth: (values.dateOfBirth ?? existing.dateOfBirth) as string | null,
    qualification: (values.qualification ?? existing.qualification) as typeof existing.qualification,
    shiftBase: (values.shiftBase ?? existing.shiftBase) as typeof existing.shiftBase,
  };

  if (pin && isBangalorePincode(pin)) {
    if (!mergedRow.city) {
      values.city = "BANGALORE";
      mergedRow.city = "BANGALORE";
    }
    if (!(values.jobCity ?? existing.jobCity)) {
      values.jobCity = "BANGALORE";
      mergedRow.jobCity = "BANGALORE";
    }
  }

  const relocateYes = extraResult.extra.answers["out_station_candidate"]?.["will_relocate"] === "Yes"
    || extraResult.extra.answers["non_hiring_zone"]?.["will_relocate"] === "Yes";
  if (relocateYes && (!mergedRow.jobCity || !isBangalorePlace(mergedRow.jobCity))) {
    values.jobCity = "BANGALORE";
    mergedRow.jobCity = "BANGALORE";
  }

  const openDisposition = (id: string) => {
    if (!extraResult.extra.dispositionIds.includes(id)) {
      extraResult.extra.dispositionIds = [...extraResult.extra.dispositionIds, id];
      extraResult.written.push("disposition");
    }
    const prefill = autoAnswersForDisposition(id, mergedRow, extraResult.extra);
    const bucket = { ...(extraResult.extra.answers[id] ?? {}) };
    for (const [k, v] of Object.entries(prefill)) {
      if (v !== null && v !== "" && bucket[k] == null) bucket[k] = v;
    }
    extraResult.extra.answers[id] = bucket;
  };

  for (const [flag, yn] of Object.entries(screenPatch) as Array<[ScreenFlagKey, "yes" | "no"]>) {
    extraResult.written.push(flag);
    if (yn === "yes") {
      const disp = SCREEN_FLAG_TO_DISPOSITION[flag];
      if (disp) openDisposition(disp);
    }
  }

  if (pin && !isBangalorePincode(pin)) {
    openDisposition("out_station_candidate");
    if (nonHiringAreaForPincode(pin)) openDisposition("non_hiring_zone");
  }
  if (mergedRow.jobCity && !isBangalorePlace(mergedRow.jobCity) && !relocateYes) {
    openDisposition("no_company");
  }
  if (mergedRow.shiftBase && !["US", "NIGHT_ONLY", "ANY", "ROTATIONAL", "UK", "AUS"].includes(mergedRow.shiftBase)) {
    openDisposition("shift_issues");
  }
  if (mergedRow.dateOfBirth) {
    const born = new Date(`${mergedRow.dateOfBirth}T00:00:00Z`);
    if (!Number.isNaN(born.getTime())) {
      const now = new Date();
      let age = now.getUTCFullYear() - born.getUTCFullYear();
      const md = now.getUTCMonth() - born.getUTCMonth();
      if (md < 0 || (md === 0 && now.getUTCDate() < born.getUTCDate())) age -= 1;
      if (age < 18 || age > 40) openDisposition("age_limit");
    }
  }

  const errors = [...typedErrors, ...extraResult.errors];
  const written = [...(Object.keys(values) as IntakeFieldKey[]), ...extraResult.written];
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
  const cue = evaluateIntakeScreen(forMatch, extra);
  const matched = cue.pitchAllowed
    ? matchIntakeJobs(forMatch, extra)
    : {
        proposed: null,
        alternatives: [],
        speakScript: null,
        talkingPoints: [] as string[],
        note: cue.killReason
          ? `Not eligible after screening (${cue.killReason}).`
          : "Screening is not complete — no job is pitched.",
        blocked: true,
      };
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
    void maybeScheduleIntakeFollowup({
      row: row ?? closed,
      callId: params.callId,
      callerPhone: (row ?? closed).phone,
    });
  } catch (err) {
    logger.warn({ err, callId: params.callId }, "intake: could not attach call artifacts");
  }
}

async function pendingFollowupExists(agentId: number, phone: string): Promise<boolean> {
  const tail = lastTenDigits(phone);
  if (!tail) return false;
  const [row] = await db
    .select({ id: scheduledCallbacksTable.id })
    .from(scheduledCallbacksTable)
    .where(and(
      eq(scheduledCallbacksTable.agentId, agentId),
      inArray(scheduledCallbacksTable.status, ["pending", "triggering"]),
      sql`right(regexp_replace(coalesce(${scheduledCallbacksTable.toNumber}, ''), '[^0-9]', '', 'g'), 10) = ${tail}`,
    ))
    .limit(1);
  return Boolean(row);
}

/**
 * Turns two dispositions into real outbound dials:
 *   busy_call_me_back → schedule_callback at the captured date/time
 *   call_disconnected → one immediate redial
 *
 * The LLM also has schedule_callback; this is the backstop so a recorded
 * outcome still produces a call even if the model never invoked the tool.
 */
export async function maybeScheduleIntakeFollowup(opts: {
  row: CandidateIntake;
  callId: number;
  callerPhone?: string | null;
}): Promise<void> {
  try {
    const agentId = opts.row.agentId;
    const toNumber = (opts.callerPhone ?? opts.row.phone ?? "").trim();
    if (!agentId || !toNumber) return;

    const extra = intakeExtraOf(opts.row);
    const answers = extra.answers;
    const userId = opts.row.userId ?? null;

    if (extra.dispositionIds.includes("busy_call_me_back")) {
      const at = combineCallbackAt(
        answers["busy_call_me_back"]?.callback_date,
        answers["busy_call_me_back"]?.callback_time,
      );
      if (at && !(await pendingFollowupExists(agentId, toNumber))) {
        const name = [opts.row.firstName, opts.row.lastName].filter(Boolean).join(" ");
        await scheduleCallbackRequested({
          agentId,
          toNumber,
          userId,
          callId: opts.callId,
          scheduledAt: at,
          notes: name
            ? `Intake callback for ${name} (form ${opts.row.publicToken})`
            : `Intake callback (form ${opts.row.publicToken})`,
        });
        logger.info({ callId: opts.callId, agentId, scheduledAt: at }, "intake: callback scheduled from busy_call_me_back");
      }
    }

    if (extra.dispositionIds.includes("call_disconnected")) {
      if (!(await pendingFollowupExists(agentId, toNumber))) {
        await scheduleNetworkDropCallback({
          agentId,
          toNumber,
          userId,
          callId: opts.callId,
        });
        logger.info({ callId: opts.callId, agentId }, "intake: redial scheduled from call_disconnected");
      }
    }
  } catch (err) {
    logger.warn({ err, callId: opts.callId }, "intake: follow-up scheduling failed");
  }
}

/**
 * Tester reset: next inbound from this number is a first call — no prior form,
 * no caller-memory block, no pending callback.
 */
export async function forgetIntakeCaller(opts: {
  agentId: number;
  phone: string;
  clerkId?: string | null;
}): Promise<{ intakes: number; callbacks: number; memoryKeys: string[] }> {
  const tail = lastTenDigits(opts.phone);
  if (!tail) {
    throw new Error("Need a phone number with at least 7 digits.");
  }
  const lastTen = sql`right(regexp_replace(coalesce(${candidateIntakesTable.phone}, ''), '[^0-9]', '', 'g'), 10) = ${tail}`;
  const callbackLastTen = sql`right(regexp_replace(coalesce(${scheduledCallbacksTable.toNumber}, ''), '[^0-9]', '', 'g'), 10) = ${tail}`;

  const intakeRows = await db
    .select({ id: candidateIntakesTable.id })
    .from(candidateIntakesTable)
    .where(and(eq(candidateIntakesTable.agentId, opts.agentId), lastTen));
  if (intakeRows.length > 0) {
    await db.delete(candidateIntakesTable).where(inArray(candidateIntakesTable.id, intakeRows.map((r) => r.id)));
  }

  const callbackRows = await db
    .select({ id: scheduledCallbacksTable.id })
    .from(scheduledCallbacksTable)
    .where(and(
      eq(scheduledCallbacksTable.agentId, opts.agentId),
      callbackLastTen,
      inArray(scheduledCallbacksTable.status, ["pending", "triggering"]),
    ));
  if (callbackRows.length > 0) {
    await db.update(scheduledCallbacksTable)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(inArray(scheduledCallbacksTable.id, callbackRows.map((r) => r.id)));
  }

  const { wipeCallerMemoryForPhone } = await import("../orchestration/caller-memory-wipe.js");
  const memory = await wipeCallerMemoryForPhone({
    agentId: opts.agentId,
    phone: opts.phone,
    clerkId: opts.clerkId,
  });
  logger.info({
    agentId: opts.agentId,
    tail,
    intakes: intakeRows.length,
    callbacks: callbackRows.length,
    memoryKeys: memory.keys,
  }, "intake: forgot caller for testing");
  return {
    intakes: intakeRows.length,
    callbacks: callbackRows.length,
    memoryKeys: memory.keys,
  };
}

export async function persistRecruiterProfile(
  callId: number,
  patch: Partial<RecruiterProfile>,
): Promise<RecruiterProfile | null> {
  const existing = await loadIntakeByCallId(callId);
  if (!existing) return null;
  const extra = intakeExtraOf(existing);
  const merged = mergeRecruiterProfile(parseRecruiterProfile(extra.recruiter), patch);
  extra.recruiter = merged;
  await db
    .update(candidateIntakesTable)
    .set({
      extra: extra as unknown as Record<string, unknown>,
      revision: sql`${candidateIntakesTable.revision} + 1`,
    })
    .where(eq(candidateIntakesTable.id, existing.id));
  return merged;
}
