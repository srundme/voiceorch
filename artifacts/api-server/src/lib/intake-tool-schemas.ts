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
 * Fields the agent asks for on the call. `skillRole`, `skill` and `industry`
 * are fixed per campaign and `englishCommunication` is scored afterwards by a
 * human, so none of them are exposed to the model.
 */
const ASKABLE_FIELDS: Record<string, { type: string; description: string }> = {
  firstName: { type: "string", description: "Candidate's first name, as spelled." },
  lastName: { type: "string", description: "Candidate's last name / surname, as spelled." },
  phone: { type: "string", description: "Mobile number in digits, e.g. 9876543210 or +919876543210." },
  email: { type: "string", description: "Email address, e.g. name@example.com." },
  gender: { type: "string", description: "Male, Female or Other." },
  dateOfBirth: { type: "string", description: "Date of birth as the candidate said it, e.g. 20 July 2000 or 20/07/2000." },
  workStatus: { type: "string", description: "Fresher or Experienced." },
  totalCompanies: { type: "string", description: "How many companies the candidate has worked with. Use 0 for a fresher." },
  city: { type: "string", description: "City the candidate currently lives in." },
  jobCity: { type: "string", description: "City the candidate wants to work in. Defaults to Bangalore." },
  qualification: { type: "string", description: "Graduate or Post Graduate." },
  shiftBase: { type: "string", description: "Shift the candidate can work, e.g. US Shift, UK Shift, Day Shift, Rotational." },
  dnd: { type: "string", description: "Activate only when the candidate asks never to be contacted again. Otherwise leave empty." },
};

export const INTAKE_WRITE_SCHEMA: JsonSchema = {
  type: "object",
  properties: ASKABLE_FIELDS,
  required: [],
};

/** Every distinct follow-up field id across all dispositions, with its label. */
function dispositionAnswerProperties(): Record<string, { type: string; description: string }> {
  const props: Record<string, { type: string; description: string }> = {};
  for (const disposition of INTAKE_DISPOSITIONS) {
    for (const field of disposition.fields) {
      const options = field.options && field.options.length > 0
        ? ` One of: ${field.options.join(" | ")}.`
        : "";
      const existing = props[field.id];
      if (existing) {
        // Shared ids such as `reason` mean different things per disposition;
        // keep the first label and let the tool result name the live question.
        continue;
      }
      props[field.id] = {
        type: "string",
        description: `${field.label} (${disposition.name}).${options}`,
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
      description: "The call outcome.",
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
