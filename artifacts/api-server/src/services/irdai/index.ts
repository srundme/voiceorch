/**
 * IRDAI (Insurance Regulatory and Development Authority of India) compliance
 * prompt check.
 * ─────────────────────────────────────────────────────────────────────────────
 * A purely informational, static analysis helper. It does NOT touch the
 * STT/LLM/TTS pipeline, conversation logic, live-call handling, or any other
 * Advanced tab settings. It never blocks saving, publishing, or calling.
 *
 * Given an agent's saved system prompt text, it runs case-insensitive
 * keyword/phrase matching against an IRDAI disclosure checklist and returns one
 * result per checklist item. The result is surfaced in the dashboard as an
 * advisory banner (missing items) or a quiet confirmation (all present).
 *
 * Pure function: no DB, no network. Never throws.
 */

export type IrdaiRequirement =
  | "insurer_identification"
  | "recording_disclosure"
  | "no_guaranteed_outcomes"
  | "indicative_quotes"
  | "grievance_redressal"
  | "human_handoff_claims"
  /** TRAI 1600-series outbound caller-ID mandate for BFSI/insurance service calls. */
  | "caller_number_1600";

export interface IrdaiComplianceItem {
  requirement: IrdaiRequirement;
  status: "present" | "missing";
  /** Plain-language label shown to the user when this item is missing. */
  detail: string;
}

/**
 * Each checklist item:
 *  - `detail` — the plain-language bullet shown when the item is missing.
 *  - `present(p)` — returns true when the requirement is satisfied. `p` is the
 *    lower-cased prompt text.
 *
 * Note on item 3 (no_guaranteed_outcomes): the requirement is satisfied
 * (`present`) when the prompt does NOT contain guaranteed-outcome language; it
 * is `missing` when such language IS present.
 */
const CHECKS: Array<{
  requirement: IrdaiRequirement;
  detail: string;
  present: (p: string) => boolean;
}> = [
  {
    requirement: "insurer_identification",
    detail: "No mention of which insurer the agent represents",
    present: (p) =>
      /\b(represent(ing)?|on behalf of|calling from|calling on behalf|i am (calling )?from|we are from|this is .{0,40}\bfrom\b|insurer|insurance company|company (you|i|we) (represent|work)|identify (yourself|the company|which insurer))\b/.test(
        p,
      ),
  },
  {
    requirement: "recording_disclosure",
    detail: "No disclosure that calls may be recorded",
    present: (p) =>
      /\b(call (is |may be |is being )?(being )?recorded|recording (this|the) call|this call (is|may be) (being )?recorded|may be recorded|recorded for (quality|training|compliance)|call recording|being recorded)\b/.test(
        p,
      ),
  },
  {
    requirement: "no_guaranteed_outcomes",
    detail: "Prompt may include language suggesting guaranteed claim outcomes",
    // Satisfied when NO guaranteed-outcome language is present.
    present: (p) =>
      !/\b(guarantee(d|s)?|assured (returns|approval|outcome)|100%\s*(approval|return|claim)|promise(d)?\s+(approval|return|claim|settlement)|definitely (approve|get|receive))\b/.test(
        p,
      ),
  },
  {
    requirement: "indicative_quotes",
    detail: "No mention that quotes/premiums are indicative",
    present: (p) =>
      /\b(indicative|subject to (final )?underwriting|pending underwriting|subject to underwriting|premiums? (are|may be) (indicative|estimates?)|quotes? (are|may be) (indicative|estimates?)|not final|estimate only)\b/.test(
        p,
      ),
  },
  {
    requirement: "grievance_redressal",
    detail: "No grievance redressal information for callers",
    present: (p) =>
      /\b(grievance|redressal|ombudsman|escalat(e|ion)|(file|lodge|raise|register) a complaint|complaint (cell|process|redressal|number)|how to (complain|escalate))\b/.test(
        p,
      ),
  },
  {
    requirement: "human_handoff_claims",
    detail: "No instruction to defer claim decisions to a human",
    present: (p) =>
      /\b(human (agent|representative|executive|officer)|transfer (you )?to (a |an )?(human|agent|representative|executive|specialist)|defer (the |final |claim )?(decision|approval|settlement)|final (claim )?(approval|decision|settlement) (is|rests|lies|will be) (made )?(by|with)|cannot (approve|decide|settle|guarantee) (the )?claim|claims? (team|department|officer|specialist|adjuster)|system of record)\b/.test(
        p,
      ),
  },
];

/**
 * Run the IRDAI disclosure checklist against a saved system prompt. Returns one
 * `IrdaiComplianceItem` per checklist item. Pure; never throws.
 *
 * @param systemPromptText The agent's saved system prompt.
 * @param fromNumber       Optional: the agent's configured outbound number.
 *   When provided, an additional `caller_number_1600` item is included that
 *   checks whether the number is a TRAI-mandated 1600-series service number.
 */
export function checkIrdaiCompliance(
  systemPromptText: string | null | undefined,
  fromNumber?: string | null,
): IrdaiComplianceItem[] {
  const p = (systemPromptText ?? "").toLowerCase();
  const results: IrdaiComplianceItem[] = CHECKS.map(({ requirement, detail, present }) => ({
    requirement,
    status: present(p) ? ("present" as const) : ("missing" as const),
    detail,
  }));

  // 1600-series number check — only included when a fromNumber is supplied.
  // TRAI mandates that BFSI/insurance service calls use a 1600-series caller ID
  // (not the 140-series promotional series). This is an operational requirement
  // that cannot be verified from the prompt alone — it depends on which number is
  // registered and assigned to the agent.
  if (fromNumber !== undefined && fromNumber !== null) {
    const digits = fromNumber.replace(/\D/g, "");
    const is1600 = digits.startsWith("1600");
    results.push({
      requirement: "caller_number_1600" as IrdaiRequirement,
      status: is1600 ? "present" : "missing",
      detail: is1600
        ? ""
        : `Outbound number (${fromNumber}) is not a 1600-series service number. TRAI requires BFSI/insurance service calls to originate from a 1600-prefix caller ID registered with your TRAI entity. Procurement must be completed with your telecom operator and registered on the TRAI DLT portal before going live.`,
    });
  }

  return results;
}

// ── Mandatory AI-identity disclosure injection ────────────────────────────────

/**
 * Inject the IRDAI/RBI-mandated AI-identity disclosure into a system prompt.
 *
 * IRDAI's 2024-25 guidelines and RBI's guidelines on automated customer
 * interactions both require that the AI disclose its nature at the very start
 * of every interaction. This function appends a mandatory, speech-optimised
 * instruction block so the LLM always opens with the required statement —
 * regardless of how the human-written prompt is worded.
 *
 * Must be applied AFTER any TRAI/DPDP disclosures so it sits last (nearest to
 * the conversation context), where modern LLMs weight it most strongly.
 *
 * Pure function. Never throws.
 *
 * @param basePrompt   The fully assembled system prompt (including any prior
 *                     DPDP/TRAI injections).
 * @param insurerName  Optional insurer or company name to include in the
 *                     disclosure. Defaults to "the company" when omitted.
 */
export function appendIrdaiAiDisclosure(basePrompt: string, insurerName?: string | null): string {
  const entity = (insurerName ?? "").trim() || "the company";
  return `${basePrompt}

[IRDAI/RBI COMPLIANCE — MANDATORY AI IDENTITY DISCLOSURE] At the VERY FIRST turn of this call — before any greeting, question, or sales pitch — you MUST say the following statement verbatim (adapt only the language/script if the caller speaks a different language, but preserve all required elements): "Hello. I am an AI-powered voice assistant calling on behalf of ${entity}. This call is being recorded for quality assurance, regulatory compliance, and grievance purposes as required by IRDAI guidelines. You may ask to speak with a human representative at any time." Do NOT proceed to any other topic until this disclosure has been delivered. If the caller immediately asks a question before you have spoken, deliver the disclosure first, then address their question.`;
}
