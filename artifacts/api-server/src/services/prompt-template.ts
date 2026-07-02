import { db, promptTemplatesTable, platformSettingsTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

export interface WizardInputs {
  useCase?: string;
  role?: string;
  companyName?: string;
  agentName?: string;
  serviceDescription?: string;
  agentDirection?: string;
  callFlowDescription?: string;
  languages?: string[];
  leadSourceType?: string;
  leadFields?: string[];
  productDetails?: string;
  /** Ordered question/answer pairs collected by the 5-question micro-wizard. */
  microAnswers?: Array<{ question: string; answer: string }>;
  /** Raw text content of any uploaded job description (candidate screening use case). */
  jdFileContent?: string;
  jdFileName?: string;
  // additional free-form fields
  [key: string]: unknown;
}

export const DUMMY_PREVIEW_PAYLOAD: WizardInputs = {
  useCase: "appointment_booking",
  role: "appointment booking specialist",
  companyName: "Acme Health Clinic",
  agentName: "Aria",
  serviceDescription: "patient appointment booking and confirmation",
  agentDirection: "inbound",
  callFlowDescription:
    "1. Greet the caller and confirm they want to book an appointment.\n2. Ask for the desired date and time.\n3. Confirm patient name and phone number.\n4. Read back the booking details and end the call warmly.",
  languages: ["english"],
};

export async function getActiveTemplate() {
  const [tpl] = await db
    .select()
    .from(promptTemplatesTable)
    .where(eq(promptTemplatesTable.isActive, true))
    .limit(1);
  return tpl ?? null;
}

export async function getNextVersion(): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(version), 0)` })
    .from(promptTemplatesTable);
  return Number(row?.max ?? 0) + 1;
}

export async function activateTemplate(id: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(promptTemplatesTable)
      .set({ isActive: false })
      .where(eq(promptTemplatesTable.isActive, true));
    await tx
      .update(promptTemplatesTable)
      .set({ isActive: true })
      .where(eq(promptTemplatesTable.id, id));
  });
}

export async function listTemplates() {
  return db
    .select({
      id: promptTemplatesTable.id,
      version: promptTemplatesTable.version,
      filename: promptTemplatesTable.filename,
      mimeType: promptTemplatesTable.mimeType,
      uploadedBy: promptTemplatesTable.uploadedBy,
      uploadedAt: promptTemplatesTable.uploadedAt,
      isActive: promptTemplatesTable.isActive,
    })
    .from(promptTemplatesTable)
    .orderBy(desc(promptTemplatesTable.version));
}

export async function extractTextFromUpload(
  buffer: Buffer,
  mimeType: string,
  filename: string,
): Promise<string> {
  const lower = filename.toLowerCase();
  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) {
    // pdf-parse is a CJS module; use default import shape that works under esbuild
    const mod = (await import("pdf-parse")) as unknown as {
      default: (b: Buffer) => Promise<{ text: string }>;
    };
    const parsed = await mod.default(buffer);
    return parsed.text.trim();
  }
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx")
  ) {
    const mammoth = (await import("mammoth")) as unknown as {
      extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }>;
    };
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  }
  throw new Error(`Unsupported file type: ${mimeType || filename}. Only PDF and DOCX are supported.`);
}

async function getManagedQwenKey(): Promise<string | null> {
  const [row] = await db
    .select()
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, "managed_qwen_key"));
  const dbValue = (row?.value ?? "").trim();
  if (dbValue) return dbValue;
  const envValue = (process.env["GROQ_API_KEY"] ?? "").trim();
  return envValue || null;
}

async function getManagedSarvamKey(): Promise<string | null> {
  const [row] = await db
    .select()
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, "managed_sarvam_key"));
  const dbValue = (row?.value ?? "").trim();
  if (dbValue) return dbValue;
  const envValue = (process.env["SARVAM_API_KEY"] ?? "").trim();
  return envValue || null;
}

/**
 * Indic-language detection for prompt-generation model routing.
 *
 * Qwen (the default generation model) skews heavily formal/literary for Indic
 * output — generated example lines then anchor the live call LLM into stilted
 * written register. When any selected language is Indic we route generation
 * through Sarvam's LLM (built for Indian languages, natural spoken register).
 * Accepts language names ("tamil", "Hinglish") and locale codes ("ta-IN", "hi").
 */
const INDIC_LANGUAGE_NAMES = new Set([
  "tamil", "hindi", "hinglish", "telugu", "kannada", "malayalam",
  "bengali", "bangla", "marathi", "gujarati", "punjabi", "odia", "oriya",
  "assamese",
]);
const INDIC_LANGUAGE_CODES = new Set([
  "ta", "hi", "te", "kn", "ml", "bn", "mr", "gu", "pa", "or", "od", "as",
]);

export function includesIndicLanguage(languages: unknown): boolean {
  const list = Array.isArray(languages) ? languages : languages != null ? [languages] : [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const norm = raw.trim().toLowerCase();
    if (!norm) continue;
    if (INDIC_LANGUAGE_NAMES.has(norm)) return true;
    const code = norm.split(/[-_]/)[0] ?? "";
    if (INDIC_LANGUAGE_CODES.has(code)) return true;
  }
  return false;
}

/**
 * Strip any Qwen reasoning ("thinking") and markdown fences from generated text.
 *
 * Qwen 3 is a reasoning model: even with `reasoning_format: "hidden"` requested,
 * provider behaviour can drift and leak `<think>…</think>` blocks (including
 * unclosed ones) or a reasoning preamble into the content field. That reasoning
 * must never survive into a saved system prompt, or the agent treats it as
 * instructions and speaks analysis-style text on live calls.
 */
export function stripReasoning(raw: string): string {
  let text = raw ?? "";

  // Remove complete <think>…</think> blocks (any casing, across newlines).
  text = text.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "");

  // Remove a dangling, unclosed <think> … (opened but never closed): drop
  // everything from the opening tag onward so no reasoning tail remains.
  text = text.replace(/<think\b[^>]*>[\s\S]*$/gi, "");

  // Remove a stray leading closing tag if the opener was suppressed upstream
  // (reasoning hidden, but the terminator still echoed): drop everything up to
  // and including the first </think>.
  text = text.replace(/^[\s\S]*?<\/think>/i, "");

  // Strip surrounding markdown code fences (```…``` or ```lang … ```).
  text = text.trim();
  const fence = text.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
  if (fence?.[1] != null) {
    text = fence[1];
  }

  return text.trim();
}

/** Optional per-call generation tuning shared by callQwen/callSarvam. */
export interface PromptGenerationOpts {
  temperature?: number;
  maxTokens?: number;
}

/**
 * Low-level Qwen (via Groq) chat call shared by every prompt-generation path.
 * Throws if the managed key is missing or the call fails/returns empty.
 * Requests Groq's reasoning suppression and defensively strips any reasoning
 * that still leaks through, so callers only ever receive the final prompt.
 * Pass `systemInstruction: null` to send a single user message only.
 */
async function callQwen(
  systemInstruction: string | null,
  userContent: string,
  opts?: PromptGenerationOpts,
): Promise<string> {
  const qwenKey = await getManagedQwenKey();
  if (!qwenKey) {
    throw new Error(
      "Managed Qwen key not configured — set managed_qwen_key in Admin → Managed Keys",
    );
  }

  const messages: Array<{ role: string; content: string }> = [];
  if (systemInstruction != null) messages.push({ role: "system", content: systemInstruction });
  messages.push({ role: "user", content: userContent });

  const res = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${qwenKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen/qwen3-32b",
        temperature: opts?.temperature ?? 0.4,
        max_tokens: opts?.maxTokens ?? 4096,
        // Suppress the reasoning model's thinking so it never reaches `content`.
        reasoning_format: "hidden",
        messages,
      }),
    },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    logger.error({ status: res.status, errText }, "Qwen prompt generation failed");
    throw new Error(`Qwen generation failed (HTTP ${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawText = data?.choices?.[0]?.message?.content?.trim() ?? "";
  if (!rawText) throw new Error("Qwen returned an empty prompt");

  const text = stripReasoning(rawText);
  if (!text) {
    throw new Error(
      "Qwen returned only reasoning with no usable prompt — try generating again",
    );
  }
  return text;
}

/**
 * Non-streaming Sarvam chat call — the Indic-language counterpart of callQwen.
 * Uses sarvam-105b (highest quality; prompt generation is not latency-sensitive)
 * with thinking explicitly disabled (`reasoning_effort: null` — Sarvam's default
 * is ON). Auth header is `api-subscription-key`. Throws if the managed key is
 * missing or the call fails/returns empty. Defensively strips leaked
 * `<|message|>`-style special tokens plus any reasoning/fences.
 * Pass `systemInstruction: null` to send a single user message only.
 */
export async function callSarvam(
  systemInstruction: string | null,
  userContent: string,
  opts?: PromptGenerationOpts,
): Promise<string> {
  const sarvamKey = await getManagedSarvamKey();
  if (!sarvamKey) {
    throw new Error(
      "Managed Sarvam key not configured — set managed_sarvam_key in Admin → Managed Keys",
    );
  }

  const messages: Array<{ role: string; content: string }> = [];
  if (systemInstruction != null) messages.push({ role: "system", content: systemInstruction });
  messages.push({ role: "user", content: userContent });

  const body: Record<string, unknown> = {
    model: "sarvam-105b",
    // Thinking is ON by default on Sarvam — disable it explicitly.
    reasoning_effort: null,
    max_tokens: opts?.maxTokens ?? 4096,
    messages,
  };
  // Omit temperature unless explicitly set so Sarvam applies its own default.
  if (typeof opts?.temperature === "number" && Number.isFinite(opts.temperature)) {
    body["temperature"] = opts.temperature;
  }

  const res = await fetch("https://api.sarvam.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "api-subscription-key": sarvamKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    logger.error({ status: res.status, errText: errText.slice(0, 300) }, "Sarvam prompt generation failed");
    throw new Error(`Sarvam generation failed (HTTP ${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawText = data?.choices?.[0]?.message?.content?.trim() ?? "";
  if (!rawText) throw new Error("Sarvam returned an empty prompt");

  // Strip leaked internal special tokens (e.g. <|message|>) before the shared
  // reasoning/fence stripper.
  const text = stripReasoning(rawText.replace(/<\|[a-zA-Z_]+\|>/g, ""));
  if (!text) {
    throw new Error("Sarvam returned no usable prompt text — try generating again");
  }
  return text;
}

/**
 * Language-routed prompt generation shared by every generation path.
 * Indic-language selections go to Sarvam (natural spoken register); on a
 * missing Sarvam key or any Sarvam failure it logs and falls back to the
 * existing Qwen path. English-only selections go straight to Qwen unchanged.
 */
export async function generatePromptText(params: {
  systemInstruction: string | null;
  userContent: string;
  /** Selected language(s) — string, string[], or undefined. */
  languages?: unknown;
  opts?: PromptGenerationOpts;
}): Promise<string> {
  const { systemInstruction, userContent, languages, opts } = params;
  if (includesIndicLanguage(languages)) {
    try {
      const text = await callSarvam(systemInstruction, userContent, opts);
      logger.info({ model: "sarvam-105b" }, "Indic prompt generation served by Sarvam");
      return text;
    } catch (err) {
      logger.warn({ err }, "Sarvam Indic prompt generation failed — falling back to Qwen");
    }
  }
  return callQwen(systemInstruction, userContent, opts);
}

/**
 * Single helper used by both wizard submit and admin regenerate.
 * Sends the active template (as system instruction) + the user's wizard inputs
 * (as a user-message context block) to Qwen via Groq, returns the generated prompt text.
 * Throws if Qwen key missing or call fails.
 */
export async function generateAgentPrompt(
  wizardInputs: WizardInputs,
  templateText: string,
): Promise<string> {
  const systemInstruction = `You are a senior AI voice agent prompt engineer. Use the master template below as the exact structure for the system prompt you produce. Substitute placeholders with the user's inputs, expand the call-flow section into a clear, natural multi-step flow, and keep the rest of the structure intact. If the wizard inputs include a "microAnswers" array (the user's raw answers to the 5 wizard micro-questions), EVERY non-empty answer MUST be reflected in the final prompt using the user's actual words or recognisably paraphrased — do not drop or replace them with generic filler. Output only the final system prompt, with no surrounding commentary or markdown fences.

=== MASTER TEMPLATE ===
${templateText}
=== END MASTER TEMPLATE ===`;

  const inputsBlock = `Generate the agent's final system prompt using the master template above and the following wizard inputs:\n\n${JSON.stringify(
    wizardInputs,
    null,
    2,
  )}`;

  return generatePromptText({
    systemInstruction,
    userContent: inputsBlock,
    languages: wizardInputs.languages,
  });
}

export interface LayeredPromptInput {
  /** Foundation layer — LOCKED, universal rules that must never be contradicted. */
  foundationText: string;
  /** Domain layer text (empty string for the Custom / Other path). */
  domainText: string;
  /** Domain display name (or "Custom / Other"). */
  domainName: string;
  /** Optional Client Details structure layer. */
  clientDetailsText?: string;
  /** Raw form inputs collected by the modal. */
  formInputs: Record<string, unknown>;
}

/**
 * Layered generation for the dashboard "Generate System Prompt" modal.
 * Assembles Foundation (locked) → Domain → Client Details structure → form inputs
 * and asks Qwen to produce the final system prompt. The Foundation layer's rules
 * are declared non-negotiable; the Domain/inputs may only specialise, never override.
 */
export async function generateLayeredAgentPrompt(input: LayeredPromptInput): Promise<string> {
  const { foundationText, domainText, domainName, clientDetailsText, formInputs } = input;

  const layers: string[] = [
    `=== FOUNDATION (LOCKED — universal rules that MUST NOT be contradicted or removed) ===\n${foundationText}\n=== END FOUNDATION ===`,
  ];
  if (domainText.trim()) {
    layers.push(`=== DOMAIN: ${domainName} (specialises the Foundation — never overrides it) ===\n${domainText}\n=== END DOMAIN ===`);
  }
  if (clientDetailsText && clientDetailsText.trim()) {
    layers.push(`=== CLIENT DETAILS STRUCTURE (how to weave the client's specifics in) ===\n${clientDetailsText}\n=== END CLIENT DETAILS STRUCTURE ===`);
  }

  const systemInstruction = `You are a senior AI voice agent prompt engineer. Produce the final system prompt for a voice agent by layering the sections below in order of authority.

RULES OF ASSEMBLY:
1. The FOUNDATION section is LOCKED. Every rule in it (identity/AI-honesty, salutation protocol, spoken-form rules, silent tool-call handling, off-script/silence/closing/opt-out behaviour) MUST be preserved verbatim in intent. Never weaken, contradict, or drop a Foundation rule.
2. The DOMAIN section specialises the Foundation for this use case. It may add specifics but must never override a Foundation rule. When a DOMAIN section is present you MUST carry its machinery through completely:
   a. Reproduce EVERY numbered step of the DOMAIN's conversation flow in the final prompt's Conversation Flow section — specialised with the client's details, never dropped, merged, or summarised away. If the DOMAIN has more steps than the client's call-flow description, keep ALL domain steps and weave the client's flow into them.
   b. Steps containing mandatory or regulatory requirements (eligibility/needs checks, disclosures such as IRDAI/KYC/consent, verification) are NON-NEGOTIABLE: they must each appear as an explicit, detailed step. Mandatory-disclosure steps may NEVER be summarised away or folded into another step.
   c. Include the DOMAIN's "Defined Outcomes" list in the final prompt VERBATIM — every backtick-quoted outcome value exactly as written (e.g. \`interested\`, \`not_eligible\`), including any "pick exactly one per call" instruction.
   d. Preserve every requirement of the DOMAIN's Compliance Note / compliance guardrails (e.g. never guarantee claims or returns, no fear-based pressure, required regulatory disclosures) in the final prompt's Compliance & Disclosures section.
3. The CLIENT DETAILS STRUCTURE (if present) tells you how to weave the client's concrete inputs into the prompt.
4. Substitute the user's form inputs (company, agent name, direction, language(s), call flow, key knowledge) into the appropriate places and expand the call flow into a clear, natural multi-step conversation.
5. MANDATORY OUTPUT STRUCTURE — the final prompt MUST contain ALL of the following sections, using these EXACT headings, each filled with detailed, specific content (multiple sentences or bullet points — never a one-line placeholder):
   - Agent Identity & Role
   - Language & Communication Style
   - Conversation Flow  (numbered steps; when a DOMAIN is present this carries every domain step per rule 2a)
   - Objection Handling
   - Escalation & Transfer Rules
   - Compliance & Disclosures
   - Defined Outcomes  (mandatory when a DOMAIN section is present — verbatim per rule 2c; when no DOMAIN is present, include it with sensible outcomes derived from the call flow)
   - Variables Used
   - Response Guidelines
6. Output ONLY the final system prompt — no commentary, no markdown fences.

${layers.join("\n\n")}`;

  const inputsBlock = `Generate the agent's final system prompt by layering the sections above and applying these form inputs:\n\n${JSON.stringify(
    formInputs,
    null,
    2,
  )}`;

  // The modal collects a primary `language` plus an optional `selectedLanguages`
  // list — either can flag an Indic selection.
  const languages: unknown[] = [];
  if (typeof formInputs["language"] === "string") languages.push(formInputs["language"]);
  if (Array.isArray(formInputs["selectedLanguages"])) languages.push(...(formInputs["selectedLanguages"] as unknown[]));

  return generatePromptText({
    systemInstruction,
    userContent: inputsBlock,
    languages,
  });
}
