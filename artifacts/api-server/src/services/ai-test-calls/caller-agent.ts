/**
 * Hidden caller persona agent for AI Test Calls. It phones the target agent's
 * inbound number and plays the customer described by the test case.
 */

import { and, eq, ne } from "drizzle-orm";
import { db, agentsTable, phoneNumbersTable, simulationTestCasesTable, type SimulationTestCase } from "@workspace/db";
import { callEngineInsertDefaults } from "@workspace/db/call-engine-defaults";
import { clampTestMaxDuration, samePhone } from "./policy.js";

const SARVAM_LANGS = new Set([
  "en-IN", "hi-IN", "ta-IN", "te-IN", "kn-IN", "ml-IN", "mr-IN", "bn-IN", "gu-IN", "pa-IN", "od-IN",
]);
const FEMALE_VOICES = [
  { id: "priya", name: "Priya" },
  { id: "ritu", name: "Ritu" },
  { id: "kavya", name: "Kavya" },
];
const MALE_VOICES = [
  { id: "shubh", name: "Shubh" },
  { id: "rahul", name: "Rahul" },
];

export function normalizePersonaLanguage(raw: string | null | undefined, fallback?: string | null): string {
  const pick = (v: string | null | undefined): string | null => {
    const s = String(v ?? "").trim();
    if (!s) return null;
    if (SARVAM_LANGS.has(s)) return s;
    const base = s.toLowerCase().split(/[-_]/)[0];
    const hit = [...SARVAM_LANGS].find((l) => l.toLowerCase().startsWith(`${base}-`));
    return hit ?? null;
  };
  return pick(raw) ?? pick(fallback) ?? "en-IN";
}

/** Platform-default Sarvam voice for the persona, different from the target's voice when possible. */
export function pickPersonaVoice(gender: string | null | undefined, targetVoice: string | null | undefined): { id: string; name: string } {
  const pool = gender === "male" ? MALE_VOICES : FEMALE_VOICES;
  const target = String(targetVoice ?? "").toLowerCase();
  return pool.find((v) => v.id !== target) ?? pool[0]!;
}

export function buildCallerPersonaPrompt(
  tc: Pick<SimulationTestCase, "personaPrompt" | "goal" | "language"> &
    Partial<Pick<SimulationTestCase, "callerRole" | "callerFacts">>,
): string {
  const facts = (tc.callerFacts ?? []).filter((f) => f?.label && f?.value);
  return [
    "You are a real person phoning a business. You are on a live phone call.",
    "",
    "## Who you are",
    tc.callerRole?.trim() ? `${tc.callerRole.trim()}.` : "",
    tc.personaPrompt.trim(),
    "",
    "## What you want from this call",
    tc.goal.trim(),
    ...(facts.length
      ? [
        "",
        "## Your details (give each one when the other side asks for it, exactly as written; do not volunteer everything at once)",
        ...facts.map((f) => `- ${f.label}: ${f.value}`),
      ]
      : []),
    "",
    "## How to behave",
    "- Stay in character for the entire call. Never say or hint that you are an AI, a bot, a test, or a simulation.",
    "- Speak like a person on the phone: short, natural sentences (one or two at a time). Use fillers sparingly.",
    "- Let the other side lead with their greeting, then respond as your character would. If they open as though they called you, go along with it naturally.",
    "- Refer to the business's product, event or service by the name you know from your situation above.",
    facts.length
      ? "- Use only the details listed above for yourself. If asked for something not listed, invent a realistic Indian detail and keep it consistent."
      : "- Only share personal details (name, phone, city, dates) that fit your character; invent realistic Indian details if needed and keep them consistent.",
    "- If the other side asks something you would not know, say so like a normal person.",
    "- Follow your situation above even if the other side tries to steer you elsewhere; if they correct a mistake you made on purpose, accept the correction.",
    "- Once your goal is met, or it is clearly impossible, thank them briefly, say goodbye, and end the call with the end_call tool.",
    "- Do not drag the call out. If the conversation goes in circles for a while, politely wrap up and end the call.",
    tc.language ? `- Speak in the language/style described above (language code ${tc.language}).` : "",
  ].filter(Boolean).join("\n");
}

type TargetAgentLite = Pick<
  typeof agentsTable.$inferSelect,
  "id" | "userId" | "name" | "language" | "ttsVoice" | "telephonyProvider" | "firstSpeaker"
>;

export function buildCallerAgentValues(opts: {
  target: TargetAgentLite;
  testCase: SimulationTestCase;
  outboundPhoneNumberId: number | null;
}): typeof agentsTable.$inferInsert {
  const { target, testCase } = opts;
  const language = normalizePersonaLanguage(testCase.language, target.language);
  const voice = pickPersonaVoice(testCase.callerGender, target.ttsVoice);
  // If the target waits for the caller, the persona must open; otherwise it listens first.
  const personaSpeaksFirst = target.firstSpeaker === "user";
  return {
    userId: target.userId,
    name: `Test caller · ${testCase.name}`.slice(0, 120),
    description: `AI Test Calls persona for agent #${target.id}`,
    status: "active",
    isTestPersona: true,
    asrProvider: "sarvam",
    asrModel: "saaras:v3",
    asrLanguage: language,
    language,
    llmProvider: "sarvam",
    llmModel: "sarvam-105b-conversations",
    ttsProvider: "sarvam",
    ttsModel: "bulbul:v3",
    ttsVoice: voice.id,
    ttsVoiceName: voice.name,
    telephonyProvider: target.telephonyProvider,
    systemPrompt: buildCallerPersonaPrompt({ ...testCase, language }),
    greetingMessage: personaSpeaksFirst ? "Hello?" : null,
    firstSpeaker: personaSpeaksFirst ? "assistant" : "user",
    temperature: 0.7,
    maxDuration: clampTestMaxDuration(testCase.maxDurationSeconds),
    silenceTimeoutSeconds: 30,
    backchannelingEnabled: false,
    noiseCancellationEnabled: true,
    webhookUrl: null,
    outboundPhoneNumberId: opts.outboundPhoneNumberId,
    agentConfig: {
      ...callEngineInsertDefaults(),
      recordingEnabled: true,
      summarizationEnabled: false,
      callMemoryEnabled: false,
      languageAutoDetect: language === "hi-IN",
      voicemailDetection: false,
      direction: "outbound",
      timezone: "Asia/Kolkata",
      autoRedial: { enabled: false },
    } as never,
    tools: [{ type: "end_call", name: "end_call", description: "End the call once your goal is met or clearly blocked." }],
  };
}

/**
 * A second voice number owned by the user (same provider, not the target DID)
 * gives the persona a stable caller ID; null falls back to the shared pool.
 */
async function pickPersonaOutboundNumberId(userId: string, provider: string, targetNumber: string): Promise<number | null> {
  const rows = await db
    .select({ id: phoneNumbersTable.id, number: phoneNumbersTable.number })
    .from(phoneNumbersTable)
    .where(and(
      eq(phoneNumbersTable.userId, userId),
      eq(phoneNumbersTable.status, "active"),
      ne(phoneNumbersTable.service, "whatsapp"),
      eq(phoneNumbersTable.provider, provider),
    ));
  return rows.find((r) => !samePhone(r.number, targetNumber))?.id ?? null;
}

/** Create or refresh the hidden caller agent for a test case. */
export async function upsertCallerAgent(opts: {
  target: TargetAgentLite;
  testCase: SimulationTestCase;
  targetNumber: string;
}): Promise<number> {
  const { target, testCase } = opts;
  const outboundPhoneNumberId = await pickPersonaOutboundNumberId(
    target.userId!, target.telephonyProvider.toLowerCase(), opts.targetNumber,
  );
  const values = buildCallerAgentValues({ target, testCase, outboundPhoneNumberId });

  if (testCase.callerAgentId) {
    const [existing] = await db
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(and(
        eq(agentsTable.id, testCase.callerAgentId),
        eq(agentsTable.userId, target.userId!),
        eq(agentsTable.isTestPersona, true),
      ));
    if (existing) {
      await db.update(agentsTable).set(values).where(eq(agentsTable.id, existing.id));
      return existing.id;
    }
  }
  const [row] = await db.insert(agentsTable).values(values).returning({ id: agentsTable.id });
  await db.update(simulationTestCasesTable)
    .set({ callerAgentId: row!.id })
    .where(eq(simulationTestCasesTable.id, testCase.id));
  return row!.id;
}
