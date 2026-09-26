/**
 * In-call execution for the candidate intake tools.
 *
 * Each handler returns a short sentence that goes back to the LLM as the tool
 * result. The wording matters: it is the only thing steering what the agent
 * asks next, so every result either names the next question or says the step
 * is done.
 */
import {
  type IntakeFieldKey,
} from "../lib/candidate-intake-fields.js";
import {
  expandDispositionToolArgs,
  getIntakeDisposition,
  missingDispositionFields,
} from "../lib/intake-dispositions.js";
import {
  applyIntakeWrite,
  completeIntakeSession,
  ensureIntakeForCall,
  intakeExtraOf,
  loadIntakeByToken,
  maybeScheduleIntakeFollowup,
} from "../lib/intake-service.js";
import { evaluateIntakeScreen } from "../lib/intake-screen.js";
import { logger } from "../lib/logger.js";

export interface IntakeToolContext {
  callId: number;
  agentId: number;
  callerPhone?: string | null;
}

/** Fields the operator never asks about — hidden from every tool result. */
const HIDDEN_FIELDS = new Set<IntakeFieldKey>([
  "skillRole",
  "skill",
  "industry",
  "englishCommunication",
  "gender",
  "phone",
]);

/** Call 35621 silently swapped a 2007 birth year for 2020 from a clipped "twenty". */
const CONFIRM_ON_CHANGE: readonly IntakeFieldKey[] = ["dateOfBirth", "email"];

const FIELD_LABELS: Record<string, string> = {
  firstName: "first name",
  lastName: "last name",
  phone: "mobile number",
  email: "email address",
  gender: "gender",
  dateOfBirth: "date of birth",
  workStatus: "fresher or experienced",
  totalCompanies: "number of companies worked with",
  city: "city they live in",
  jobCity: "city they want to work in",
  pincode: "pincode",
  lastCompany: "current or last company",
  tenure: "working tenure",
  qualification: "graduate or post graduate",
  shiftBase: "shift they can work",
};

function labelFor(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

function cueFor(row: Parameters<typeof intakeExtraOf>[0]) {
  return evaluateIntakeScreen(row, intakeExtraOf(row));
}

function speakNext(instruction: string): string {
  return `Next: ${instruction} Acknowledge what they just said, then pick this up in your own words — never read it as a form question.`;
}

async function resolveForm(ctx: IntakeToolContext) {
  const row = await ensureIntakeForCall({
    callId: ctx.callId,
    agentId: ctx.agentId,
    callerPhone: ctx.callerPhone ?? null,
  });
  if (!row) {
    logger.error({ callId: ctx.callId, agentId: ctx.agentId }, "intake tool: no form available for this call");
  }
  return row;
}

export async function executeIntakeWrite(
  ctx: IntakeToolContext,
  args: Record<string, unknown>,
): Promise<string> {
  const form = await resolveForm(ctx);
  if (!form) return "The form is not available right now. Keep talking to the candidate and try again.";

  const patch = Object.fromEntries(
    Object.entries(args ?? {}).filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== ""),
  );
  if (Object.keys(patch).length === 0) {
    const cue = cueFor(form);
    return `Nothing to save. ${speakNext(cue.instruction)}`;
  }

  const { row, written, errors } = await applyIntakeWrite(form.publicToken, patch, "agent");
  if (!row) {
    const why = errors.map((e) => `${labelFor(e.field)}: ${e.message}`).join("; ");
    return why
      ? `Could not save — ${why}. Ask the candidate again for that one.`
      : "Could not save those values. Ask the candidate again.";
  }

  const parts: string[] = [];
  const savedLabels = written.filter((k) => !HIDDEN_FIELDS.has(k as IntakeFieldKey)).map(labelFor);
  if (savedLabels.length > 0) parts.push(`Saved ${savedLabels.join(", ")}.`);
  for (const key of CONFIRM_ON_CHANGE) {
    const before = form[key];
    const after = row[key];
    if (written.includes(key) && before != null && String(before) !== "" && String(before) !== String(after)) {
      parts.push(
        `${labelFor(key)} changed from ${String(before)} to ${String(after)}. Read both back and ask which one is right before moving on.`,
      );
    }
  }
  if (errors.length > 0) {
    parts.push(`Rejected ${errors.map((e) => `${labelFor(e.field)} (${e.message})`).join("; ")} — ask for it again.`);
  }
  const cue = cueFor(row);
  parts.push(speakNext(cue.instruction));
  return parts.join(" ");
}

export async function executeIntakeDisposition(
  ctx: IntakeToolContext,
  args: Record<string, unknown>,
): Promise<string> {
  const form = await resolveForm(ctx);
  if (!form) return "The form is not available right now. Keep talking to the candidate and try again.";

  const patch = expandDispositionToolArgs(Object.fromEntries(
    Object.entries(args ?? {}).filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== ""),
  ));
  const hasOutcomeArg = Boolean(patch["disposition"] ?? patch["dispositionId"] ?? patch["dispositions"]);
  if (!hasOutcomeArg && intakeExtraOf(form).dispositionIds.length === 0) {
    return "No outcome given. Pass the outcome id in the `disposition` argument.";
  }

  const { row, errors } = await applyIntakeWrite(form.publicToken, patch, "agent");
  const current = row ?? (await loadIntakeByToken(form.publicToken));
  if (!current) return "Could not record the outcome. Try again.";

  const extra = intakeExtraOf(current);
  const recorded = extra.dispositionIds
    .map((id) => getIntakeDisposition(id))
    .filter((d): d is NonNullable<typeof d> => d != null);

  if (recorded.length === 0) {
    return errors.some((e) => e.field === "disposition")
      ? "That is not a valid outcome. Pick one of the listed outcome ids."
      : "No outcome recorded yet. Pass a valid outcome id in `disposition`.";
  }

  const parts = [`Outcomes on this call: ${recorded.map((d) => d.name).join(", ")}.`];
  if (errors.length > 0) {
    parts.push(`Rejected ${errors.map((e) => `${e.field} (${e.message})`).join("; ")}.`);
  }
  for (const d of recorded) {
    if (d.warning) parts.push(`Recruiter note on ${d.name} — do not read this to the candidate: ${d.warning}`);
  }

  // Namespaced so two outcomes that both have a `reason` stay distinguishable.
  const missing = missingDispositionFields(extra);
  if (missing.length > 0) {
    const questions = missing.map((key) => {
      const [dispId = "", fieldId = ""] = key.split(".");
      const spec = getIntakeDisposition(dispId);
      const field = spec?.fields.find((f) => f.id === fieldId);
      if (!spec || !field) return key;
      const options = field.options && field.options.length > 0
        ? ` (one of: ${field.options.join(" | ")})`
        : "";
      return `${spec.id}.${field.id} — "${field.label}"${options}`;
    });
    parts.push(
      `Still open: ${questions.join("; ")}. Work these into the conversation one at a time in your own words, then send them back through set_disposition using the dotted key.`,
    );
  } else if (current.status === "completed") {
    parts.push("The opening was already pitched. Do not call finish_intake again and do not say there is no opening. Confirm the next step, say goodbye, then end_call.");
  } else {
    const cue = cueFor(current);
    parts.push(`Every outcome question is answered. ${speakNext(cue.instruction)}`);
  }

  void maybeScheduleIntakeFollowup({
    row: current,
    callId: ctx.callId,
    callerPhone: ctx.callerPhone ?? current.phone,
  });
  if (extra.dispositionIds.includes("busy_call_me_back") && missing.length === 0) {
    parts.push("A callback has been queued for that date and time. Confirm it out loud, then end_call.");
  }
  return parts.join(" ");
}

export async function executeIntakeSubmit(ctx: IntakeToolContext): Promise<string> {
  const form = await resolveForm(ctx);
  if (!form) return "The form is not available right now. Keep talking to the candidate and try again.";

  const fresh = (await loadIntakeByToken(form.publicToken)) ?? form;
  if (fresh.status === "completed") {
    const prior = intakeExtraOf(fresh).match ?? {};
    const priorPoints = Array.isArray(prior["talkingPoints"])
      ? prior["talkingPoints"].filter((p: unknown): p is string => typeof p === "string" && p.trim().length > 0)
      : [];
    if (priorPoints.length > 0) {
      return "ALREADY_PITCHED: The opening was already pitched on this call. Do not pitch it again and do not say there is no opening. Confirm the next step, say goodbye, then end_call.";
    }
  }
  const cue = cueFor(fresh);
  if (!cue.canFinish) {
    return `Not ready to close. Screening is not complete. ${speakNext(cue.instruction)}`;
  }

  const result = await completeIntakeSession(form.publicToken);
  if (!result.row) return "Could not close the form. Try again in a moment.";

  const closed = cueFor(result.row);
  const match = intakeExtraOf(result.row).match ?? {};
  const note = typeof match["note"] === "string" ? match["note"].trim() : "";
  const points = Array.isArray(match["talkingPoints"])
    ? match["talkingPoints"].filter((p: unknown): p is string => typeof p === "string")
    : [];

  if (!closed.pitchAllowed || points.length === 0) {
    const say = (typeof match["speakScript"] === "string" && match["speakScript"].trim())
      || (note
        ? `${note} The team will review the profile and call back.`
        : "I don't have an opening that matches what we captured. The team will review the profile and call back.");
    return `SAY_BEFORE_HANGUP: ${say}\nSpeak that reason out loud now, in your own words. Do not call end_call until the candidate has heard why there is no opening.`;
  }

  // Recruiter facts, not labeled form rows. The first item is the opening hook
  // so the agent cannot get away with saying only the company name.
  return [
    "Form closed. This is the opening that matched — these are facts, not a script:",
    points.map((p: string) => `- ${p}`).join("\n"),
    "",
    "Pitch it like a recruiter on a live call, not a checklist. Your first spoken turn MUST include the company AND what the work is (process or role), then ask if that sounds like what they want. Never say only the company name. Then bring in shift, location and salary across the next couple of turns, pausing for their reaction. Use your own words. Keep every turn short.",
    "Answer their questions using only the facts above. If something is not there, say the recruitment team will confirm it. Never name another company, role or salary.",
  ].join("\n");
}
