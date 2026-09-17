/**
 * Opening line + prior-form lookup for the intake agent.
 *
 * The stored greeting used to be a fixed first-call script that named Meera,
 * so a candidate who rang back heard the same "could I take your name?" even
 * when we already had their form, and an agent named Irfan still introduced
 * himself as Meera. Both the spoken name and the opener are decided here at
 * call start from the agent row and the last intake for this number.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db, candidateIntakesTable, type CandidateIntake } from "@workspace/db";
import { INTAKE_FIELD_KEYS, missingIntakeFields, type IntakeFieldKey } from "./candidate-intake-fields.js";
import { getIntakeDisposition, parseIntakeExtra } from "./intake-dispositions.js";

export type IntakeOpenKind = "first" | "return" | "resume" | "callback";

export function lastTenDigits(phone: string | null | undefined): string | null {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  return digits.slice(-10);
}

/** First token of the agent name — "Irfan Sharma" speaks as Irfan, not the full label. */
export function intakeSpokenName(agentName: string | null | undefined): string {
  const cleaned = String(agentName ?? "").trim();
  if (!cleaned) return "the recruitment team";
  const first = cleaned.split(/\s+/)[0]!;
  return first;
}

export function resolveIntakeOpenKind(opts: {
  hasPriorIntake: boolean;
  sourceCallbackReason?: string | null;
  isResumeDroppedCall?: boolean;
}): IntakeOpenKind {
  const reason = opts.sourceCallbackReason ?? "";
  if (opts.isResumeDroppedCall || reason === "network_drop") return "resume";
  if (reason === "callback_requested") return "callback";
  if (opts.hasPriorIntake) return "return";
  return "first";
}

export function renderIntakeGreeting(opts: {
  kind: IntakeOpenKind;
  agentName: string;
  callerName?: string | null;
  /** Next thing still missing from the previous screen, already worded as a question. */
  nextAsk?: string | null;
}): string {
  const me = intakeSpokenName(opts.agentName);
  const they = (opts.callerName ?? "").trim().split(/\s+/)[0] || "";
  const ask = (opts.nextAsk ?? "").trim();
  const help = "How can I help you today?";

  if (opts.kind === "resume") {
    const hi = they ? `Hi ${they}, this is ${me}` : `Hi, this is ${me}`;
    return ask
      ? `${hi} — we got disconnected. ${ask}`
      : `${hi} — we got disconnected. ${help}`;
  }
  if (opts.kind === "callback") {
    const hi = they
      ? `Hi ${they}, this is ${me} from the recruitment team`
      : `Hi, this is ${me} from the recruitment team`;
    return ask
      ? `${hi}. I'm calling you back — ${ask.charAt(0).toLowerCase()}${ask.slice(1)}`
      : `${hi}. I'm calling you back as we discussed. ${help}`;
  }
  if (opts.kind === "return") {
    const hi = they
      ? `Hi ${they}, this is ${me} from the recruitment team`
      : `Hi, this is ${me} from the recruitment team`;
    return ask
      ? `${hi} — good to hear from you again. ${ask}`
      : `${hi} — good to hear from you again. ${help}`;
  }
  return `Hello, this is ${me} from Jobshop. How may I assist you?`;
}

const SKIP_IN_RECAP: ReadonlySet<IntakeFieldKey> = new Set([
  "skillRole",
  "skill",
  "industry",
  "englishCommunication",
  "dnd",
  "gender",
  "phone",
]);

const ASK_NEXT: Record<string, string> = {
  firstName: "Could I take your name?",
  lastName: "And your surname?",
  email: "Could I take your email?",
  dateOfBirth: "What's your date of birth?",
  workStatus: "Are you a fresher, or have you worked before?",
  totalCompanies: "How many companies have you worked with?",
  city: "Which city are you in right now?",
  jobCity: "Which city do you want to work in?",
  qualification: "Are you a graduate or a post graduate?",
  shiftBase: "Can you do a US or night shift?",
};

/** The next screening question still open on this form, worded for speech. */
export function nextIntakeAsk(row: CandidateIntake): string | null {
  const missing = missingIntakeFields(row).filter((k) => !SKIP_IN_RECAP.has(k) && k !== "gender");
  const key = missing[0];
  return key ? (ASK_NEXT[key] ?? null) : null;
}

const RECAP_LABELS: Record<string, string> = {
  firstName: "first name",
  lastName: "last name",
  email: "email",
  dateOfBirth: "date of birth",
  workStatus: "work status",
  totalCompanies: "companies worked with",
  city: "city they live in",
  jobCity: "job city",
  qualification: "qualification",
  shiftBase: "shift",
};

export function intakeCallerName(row: CandidateIntake): string | null {
  const first = (row.firstName ?? "").trim();
  if (first) return first;
  const last = (row.lastName ?? "").trim();
  return last || null;
}

/**
 * Facts the agent already has, so a second call does not restart the screen.
 * Empty fields are omitted — listing blanks would make the model re-ask them
 * as if they were known.
 */
export function buildIntakeReturnBlock(row: CandidateIntake): string {
  const extra = parseIntakeExtra(row.extra);
  const known: string[] = [];
  for (const key of INTAKE_FIELD_KEYS) {
    if (SKIP_IN_RECAP.has(key)) continue;
    const value = row[key];
    if (value === null || value === undefined || value === "") continue;
    known.push(`- ${RECAP_LABELS[key] ?? key}: ${value}`);
  }
  const pin = extra.screen?.pincode
    ?? extra.answers["non_hiring_zone"]?.["candidate_pincode"];
  if (typeof pin === "string" && pin.trim()) known.push(`- pincode: ${pin}`);
  const lastCompany = extra.screen?.lastCompany?.trim();
  if (lastCompany) known.push(`- current or last company: ${lastCompany}`);
  const tenure = extra.screen?.tenure?.trim();
  if (tenure) known.push(`- working tenure: ${tenure}`);
  if (row.englishCommunication) known.push(`- English on the previous call: ${row.englishCommunication}`);

  const outcomes = extra.dispositionIds
    .map((id) => getIntakeDisposition(id)?.name ?? id)
    .filter(Boolean);
  const missing = missingIntakeFields(row).filter((k) => !SKIP_IN_RECAP.has(k) && k !== "gender");

  const lines = [
    "=== PREVIOUS INTAKE ===",
    `This is the same candidate. Status of their form: ${row.status}.`,
    known.length > 0
      ? `Already captured — do not re-ask unless they correct you:\n${known.join("\n")}`
      : "No details were captured last time.",
  ];
  if (outcomes.length > 0) {
    lines.push(`Outcomes already recorded: ${outcomes.join(", ")}. Keep these; add more only if something new applies.`);
  }
  if (missing.length > 0) {
    const ask = ASK_NEXT[missing[0]!] ?? missing[0];
    lines.push(`Still needed: ${missing.join(", ")}. The greeting already asked: "${ask}". Wait for the answer — do not repeat that question.`);
  } else {
    lines.push("Every required field is already captured. The greeting already asked how you can help. Listen, then respond to what they want.");
  }
  if (row.dnd === "ACTIVATE") {
    lines.push("DND is active on this candidate. Confirm they called us on purpose, then continue only if they want to proceed.");
  }
  lines.push(
    "The greeting already recognised them by name. Do not introduce yourself a second time, do not recap the last call, and do not ask their name again if it is listed above.",
  );
  lines.push("=== END PREVIOUS INTAKE ===");
  return lines.join("\n");
}

export async function findIntakeForCaller(opts: {
  agentId: number;
  phone?: string | null;
}): Promise<CandidateIntake | null> {
  const tail = lastTenDigits(opts.phone);
  if (!tail) return null;

  // Last-10 match so +91XXXXXXXXXX and 0XXXXXXXXXX hit the same row. Volume
  // per intake agent is small enough that a recent window is enough.
  const rows = await db
    .select()
    .from(candidateIntakesTable)
    .where(and(
      eq(candidateIntakesTable.agentId, opts.agentId),
      sql`right(regexp_replace(coalesce(${candidateIntakesTable.phone}, ''), '[^0-9]', '', 'g'), 10) = ${tail}`,
    ))
    .orderBy(desc(candidateIntakesTable.updatedAt))
    .limit(5);

  return rows[0] ?? null;
}

/**
 * Combines a stored callback date + time in Asia/Kolkata into an instant.
 * On-the-hour times come through as "10:00"; a date-only answer defaults to 11:00.
 */
export function combineCallbackAt(
  date: string | number | null | undefined,
  time: string | number | null | undefined,
  now = new Date(),
): Date | null {
  const day = String(date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const clock = String(time ?? "11:00").trim();
  const hm = clock.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!hm) return null;
  const iso = `${day}T${hm[1]!.padStart(2, "0")}:${hm[2]}:00+05:30`;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  if (at.getTime() < now.getTime() - 60_000) {
    // A date the model stored as today but the call ran past it — push an hour out.
    return new Date(now.getTime() + 60 * 60_000);
  }
  return at;
}
