/**
 * LLM function schemas for the candidate intake tools.
 *
 * Generated from the intake field and disposition catalogues rather than
 * hand-written, so adding a disposition or a field cannot leave the agent with
 * a schema that no longer matches what the form accepts.
 */
import { INTAKE_DISPOSITIONS } from "./intake-dispositions.js";

type JsonSchema = {
  type: "object";
  properties: Record<string, { type: string; description?: string; enum?: string[] }>;
  required?: string[];
};

/**
 * Fields the agent asks for on the call.
 *
 * `skillRole`, `skill` and `industry` are fixed per campaign. `gender` is read
 * off the candidate's name server-side, `phone` is the inbound caller ID, and
 * `englishCommunication` is scored from how they speak during the call —
 * asking for any of those out loud is exactly what we do not want, so none
 * of them are exposed to the model.
 */
const ASKABLE_FIELDS: Record<string, { type: "string"; description: string }> = {
  firstName: { type: "string", description: "Candidate's first name, as spelled." },
  lastName: { type: "string", description: "Candidate's last name / surname, as spelled." },
  email: { type: "string", description: "Email address, e.g. name@example.com." },
  dateOfBirth: { type: "string", description: "Date of birth as the candidate said it, e.g. 20 July 2000 or 20/07/2000." },
  workStatus: { type: "string", description: "Fresher or Experienced." },
  totalCompanies: { type: "string", description: "How many companies the candidate has worked with. Use 0 for a fresher." },
  city: { type: "string", description: "City the candidate currently lives in." },
  jobCity: { type: "string", description: "City the candidate wants to work in. Defaults to Bangalore." },
  pincode: { type: "string", description: "6-digit Indian pincode where the candidate lives. Hiring zone is decided from this. Repeat the digits back." },
  lastCompany: { type: "string", description: "Experienced only. Current or last company name, as the candidate said it." },
  tenure: { type: "string", description: "Experienced only. How long they have worked there, e.g. 2 years or 18 months." },
  qualification: { type: "string", description: "Graduate or Post Graduate." },
  shiftBase: { type: "string", description: "Shift the candidate can work, e.g. US Shift, UK Shift, Day Shift, Rotational." },
  dnd: { type: "string", description: "Activate only when the candidate asks never to be contacted again. Otherwise leave empty." },
  servingNotice: { type: "string", description: "Experienced only. yes if they are currently serving notice, no otherwise." },
  wantsWfh: { type: "string", description: "yes if they need work from home, no if office in Bangalore is fine." },
  needsWeekendOff: { type: "string", description: "yes if they must have Saturday-Sunday off, no if rotational week-offs are fine." },
  hasCareerGap: { type: "string", description: "Experienced only. yes if they have a career gap, no if not." },
  otherDomain: { type: "string", description: "Experienced only. yes if their experience is not voice/BPO, no if it is voice/BPO." },
  missingEduDocs: { type: "string", description: "yes if they cannot share education documents, no if they can." },
  missingExpDocs: { type: "string", description: "Experienced only. yes if they cannot share experience letters, no if they can." },
};

export const INTAKE_WRITE_SCHEMA: JsonSchema = {
  type: "object",
  properties: ASKABLE_FIELDS,
  required: [],
};

/**
 * Follow-up answers, keyed `<disposition>.<field>`.
 *
 * Dotted rather than bare because ids repeat across outcomes — `reason` and
 * `date_of_birth` each appear under three — and a candidate can carry several
 * outcomes at once, so a bare key has no single owner.
 */
function dispositionAnswerProperties(): Record<string, { type: string; description: string }> {
  const props: Record<string, { type: string; description: string }> = {};
  for (const disposition of INTAKE_DISPOSITIONS) {
    for (const field of disposition.fields) {
      const options = field.options && field.options.length > 0
        ? ` One of: ${field.options.join(" | ")}.`
        : "";
      props[`${disposition.id}.${field.id}`] = {
        type: "string",
        description: `${disposition.name} — ${field.label}.${options}`,
      };
    }
  }
  return props;
}

export const INTAKE_DISPOSITION_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    disposition: {
      type: "string",
      description:
        "The outcome you are recording. A candidate can have several outcomes on one call — call this tool once per outcome. Previously recorded outcomes are kept.",
      enum: INTAKE_DISPOSITIONS.map((d) => d.id),
    },
    ...dispositionAnswerProperties(),
  },
  required: ["disposition"],
};

export const INTAKE_SUBMIT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {},
  required: [],
};
