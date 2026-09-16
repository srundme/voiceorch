/**
 * In-call execution for the candidate intake tools.
 *
 * Each handler returns a short sentence that goes back to the LLM as the tool
 * result. The wording matters: it is the only thing steering what the agent
 * asks next, so every result either names the next question or says the step
 * is done.
 */
import {
  INTAKE_FIELD_KEYS,
  missingIntakeFields,
  type IntakeFieldKey,
} from "../lib/candidate-intake-fields.js";
import {
  getIntakeDisposition,
  missingDispositionFields,
} from "../lib/intake-dispositions.js";
import {
  applyIntakeWrite,
  completeIntakeSession,
  ensureIntakeForCall,
  intakeExtraOf,
  loadIntakeByToken,
} from "../lib/intake-service.js";
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
]);

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
  qualification: "graduate or post graduate",
  shiftBase: "shift they can work",
};

function labelFor(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

/** What the agent still has to ask, in interview order, excluding hidden fields. */
function remainingQuestions(fields: Record<IntakeFieldKey, string | number | null>): string[] {
  return missingIntakeFields(fields)
    .filter((key) => !HIDDEN_FIELDS.has(key))
    .map(labelFor);
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

function fieldsOf(row: { [k: string]: unknown }): Record<IntakeFieldKey, string | number | null> {
  return Object.fromEntries(
    INTAKE_FIELD_KEYS.map((key) => [key, (row[key] as string | number | null) ?? null]),
  ) as Record<IntakeFieldKey, string | number | null>;
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
    const left = remainingQuestions(fieldsOf(form));
    return left.length > 0
      ? `Nothing to save. Still needed: ${left.join(", ")}. Cover the next one in the conversation — do not announce it as a form field.`
      : "Nothing to save. All required details are already captured.";
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
  if (errors.length > 0) {
    parts.push(`Rejected ${errors.map((e) => `${labelFor(e.field)} (${e.message})`).join("; ")} — ask for it again.`);
  }

  const left = remainingQuestions(fieldsOf(row));
  parts.push(
    left.length > 0
      ? `Still needed: ${left.join(", ")}. Acknowledge what they just said, then weave in the next missing piece. Do not say "next question."`
      : `All required details captured. Stay in the conversation a beat if they have something to add, then call finish_intake.`,
  );
  return parts.join(" ");
}

export async function executeIntakeDisposition(
  ctx: IntakeToolContext,
  args: Record<string, unknown>,
): Promise<string> {
  const form = await resolveForm(ctx);
  if (!form) return "The form is not available right now. Keep talking to the candidate and try again.";

  const patch = Object.fromEntries(
    Object.entries(args ?? {}).filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== ""),
  );
  if (!patch["disposition"] && !patch["dispositionId"] && !intakeExtraOf(form).dispositionId) {
    return "No outcome given. Pass the outcome id in the `disposition` argument.";
  }

  const { row, errors } = await applyIntakeWrite(form.publicToken, patch, "agent");
  const current = row ?? (await loadIntakeByToken(form.publicToken));
  if (!current) return "Could not record the outcome. Try again.";

  const extra = intakeExtraOf(current);
  const spec = getIntakeDisposition(extra.dispositionId);
  if (!spec) {
    const known = errors.find((e) => e.field === "disposition");
    return known
      ? `That is not a valid outcome. Pick one of the listed outcome ids.`
      : "No outcome recorded yet. Pass a valid outcome id in `disposition`.";
  }

  const parts = [`Outcome recorded: ${spec.name}.`];
  if (errors.length > 0) {
    parts.push(`Rejected ${errors.map((e) => `${e.field} (${e.message})`).join("; ")}.`);
  }
  if (spec.warning) parts.push(`Note for the recruiter (do not read to the candidate): ${spec.warning}`);

  const missing = missingDispositionFields(extra);
  if (missing.length > 0) {
    const questions = missing.map((id) => {
      const field = spec.fields.find((f) => f.id === id);
      if (!field) return id;
      const options = field.options && field.options.length > 0
        ? ` (answer with one of: ${field.options.join(" | ")})`
        : "";
      return `${field.id} — "${field.label}"${options}`;
    });
    parts.push(`Cover these next, one at a time in your own words, then send the answers back through set_disposition: ${questions.join("; ")}`);
  } else {
    parts.push("No further outcome questions. Continue with the remaining candidate details or finish_intake.");
  }
  return parts.join(" ");
}

export async function executeIntakeSubmit(ctx: IntakeToolContext): Promise<string> {
  const form = await resolveForm(ctx);
  if (!form) return "The form is not available right now. Keep talking to the candidate and try again.";

  const fresh = (await loadIntakeByToken(form.publicToken)) ?? form;
  const left = remainingQuestions(fieldsOf(fresh));
  if (left.length > 0) {
    return `Not ready to close. Still needed: ${left.join(", ")}. Ask for those first, save them, then call finish_intake again.`;
  }

  const extra = intakeExtraOf(fresh);
  const missingOutcome = missingDispositionFields(extra);
  if (missingOutcome.length > 0) {
    return `Not ready to close. The outcome questions ${missingOutcome.join(", ")} are unanswered. Ask those, send them through set_disposition, then call finish_intake again.`;
  }

  const result = await completeIntakeSession(form.publicToken);
  if (!result.row) return "Could not close the form. Try again in a moment.";

  const match = intakeExtraOf(result.row).match ?? {};
  const script = typeof match["speakScript"] === "string" ? match["speakScript"].trim() : "";
  const note = typeof match["note"] === "string" ? match["note"].trim() : "";

  if (!script) {
    return note
      ? `No matching opening for this candidate. ${note} Tell the candidate the team will review their profile and call back, then end the call.`
      : "No matching opening for this candidate. Tell them the team will review their profile and call back, then end the call.";
  }

  const proposed = match["proposed"];
  const company = proposed && typeof proposed === "object" && "company" in proposed
    ? String((proposed as Record<string, unknown>)["company"])
    : null;

  return [
    "Form closed. Read this opening out to the candidate in your own words, then ask if they are interested:",
    script,
    company ? `Company: ${company}.` : "",
    "Do not mention any other company, role or salary. If they ask something not covered here, say the recruitment team will confirm it.",
  ].filter(Boolean).join(" ");
}
