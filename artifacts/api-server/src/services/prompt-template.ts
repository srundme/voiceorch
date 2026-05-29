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

async function getManagedGeminiKey(): Promise<string | null> {
  const [row] = await db
    .select()
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, "managed_gemini_key"));
  const dbValue = (row?.value ?? "").trim();
  if (dbValue) return dbValue;
  const envValue = (process.env["GEMINI_API_KEY"] ?? "").trim();
  return envValue || null;
}

/**
 * Single helper used by both wizard submit and admin regenerate.
 * Sends the active template (as system instruction) + the user's wizard inputs
 * (as a user-message context block) to Gemini, returns the generated prompt text.
 * Throws if Gemini key missing or call fails.
 */
export async function generateAgentPrompt(
  wizardInputs: WizardInputs,
  templateText: string,
): Promise<string> {
  const geminiKey = await getManagedGeminiKey();
  if (!geminiKey) {
    throw new Error(
      "Managed Gemini key not configured — set managed_gemini_key in Admin → Managed Keys",
    );
  }

  const systemInstruction = `You are a senior AI voice agent prompt engineer. Use the master template below as the exact structure for the system prompt you produce. Substitute placeholders with the user's inputs, expand the call-flow section into a clear, natural multi-step flow, and keep the rest of the structure intact. If the wizard inputs include a "microAnswers" array (the user's raw answers to the 5 wizard micro-questions), EVERY non-empty answer MUST be reflected in the final prompt using the user's actual words or recognisably paraphrased — do not drop or replace them with generic filler. Output only the final system prompt, with no surrounding commentary or markdown fences.

=== MASTER TEMPLATE ===
${templateText}
=== END MASTER TEMPLATE ===`;

  const inputsBlock = `Generate the agent's final system prompt using the master template above and the following wizard inputs:\n\n${JSON.stringify(
    wizardInputs,
    null,
    2,
  )}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: inputsBlock }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
      }),
    },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    logger.error({ status: res.status, errText }, "Gemini prompt generation failed");
    throw new Error(`Gemini generation failed (HTTP ${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
  if (!text) throw new Error("Gemini returned an empty prompt");
  return text;
}
