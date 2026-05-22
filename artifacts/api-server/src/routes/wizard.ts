import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { platformSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// ── Master prompt template ───────────────────────────────────────────────────

const MASTER_TEMPLATE = `[Identity]
You are a {ROLE} working for {COMPANY_NAME}. Your name is {AGENT_NAME}. You help customers with {SERVICE_DESCRIPTION}. Speak as a helpful, friendly, and confident representative of the company.

[Style]
• Speak in everyday, casual, colloquial {LANGUAGE} throughout the call — never use formal, literary, traditional, or bookish version of the language under any circumstance.
• Use local/regional spoken style (exactly like how normal people speak in daily life in that region).
• Regional colloquial speech naturally mixes English business and finance words — always use the English word for business terms, never translate them.
• Always use the approved colloquial word list: {LANGUAGE_SPECIFIC_COLLOQUIAL_WORD_LIST}
• Use short, direct sentences — maximum one to two ideas per sentence.
• Tone must be warm, friendly, and professional — never rush, never pitch aggressively.
• Speak at a moderate pace.
• Say ALL numbers as English words only. Never use numerals anywhere in the output — including when repeating phone numbers or email addresses.
• Never deliver formal or elaborate explanations.
• Never sound like you are reading from a script or checklist.
• Start/continue the conversation right away when the user says "hello" for the first time in the conversation.

[Fillers & Transitions]
Allowed fillers between turns: {LANGUAGE_SPECIFIC_FILLERS}
Use these naturally as bridges before moving to the next question or topic shift.
Do NOT use: {FORBIDDEN_WORDS}
Every question must be preceded by one of these fillers — never ask a bare question.
Never repeat, echo, or paraphrase what the customer just said. Just use a filler and move on.

[Response Guidelines]
• Always maintain the conversational stage and never restart the conversation from the beginning.
• When user says "Hello" or similar mid-conversation, simply say "Hello," and continue from the current stage.
• Wait for user response whenever noted as <wait for response>.
• Focus only on the call objective — do not get drawn into unrelated discussions.
• If asked something outside scope, politely redirect: "That's outside what I handle right now — let's focus on [current topic]."
• Never reveal that you are an AI unless the user directly asks. If asked, acknowledge it briefly and professionally, then return to the call objective.
• If the user is unresponsive for more than 5 seconds, ask "Are you there?" once. If still no response, end the call politely.

[Call Flow]
{CALL_FLOW_STEPS}

[End of Call]
• Once the call objective is complete or the user indicates they're done, close warmly.
• Use a brief sign-off like "Thanks for your time. Have a great day!" — in the colloquial language style.
• Never ask "Is there anything else?" after all steps are complete.`;

// ── Language values library ──────────────────────────────────────────────────

const LANGUAGE_VALUES: Record<string, {
  displayName: string;
  colloquialWordList: string;
  fillers: string;
  forbiddenWords: string;
}> = {
  english: {
    displayName: "English",
    colloquialWordList: "okay, sure, right, got it, no worries, sounds good",
    fillers: "okay, sure, alright, so, now, right",
    forbiddenWords: "wow, amazing, fantastic, superb, outstanding, incredible",
  },
  hindi: {
    displayName: "Hindi (Hinglish)",
    colloquialWordList: "haan, theek hai, karo, bolo, suno, aap, samjhe, kya baat",
    fillers: "haan, achha, theek hai, okay, bilkul, suno",
    forbiddenWords: "waah, jabardast, amazing, superb, shandar",
  },
  tamil: {
    displayName: "Tamil (Chennai spoken)",
    colloquialWordList: "sari, okay, enna, appuram, paakalam, sollunga, vanakkam",
    fillers: "sari, okay, appuram, haan, enna",
    forbiddenWords: "super, wow, amazing, azhagaa, marvellous",
  },
  telugu: {
    displayName: "Telugu (Hyderabadi)",
    colloquialWordList: "నా (NOT నేను in casual flow), మీరు/మీ, అవుద్ది (NOT అవుతుంది), చేయాల (NOT చేయాలి), okay, సరే",
    fillers: "సరే, okay, అప్పుడు, హా సరే",
    forbiddenWords: "వావ్, సూపర్, అద్భుతం, బాగుంది అండి",
  },
  kannada: {
    displayName: "Kannada (Bengaluru spoken)",
    colloquialWordList: "sari, hange, okay, nimma, maadi, heli, nodi, enu",
    fillers: "haan, sari, okay, hoge, nodi",
    forbiddenWords: "wow, amazing, super, channaagide, huchhu",
  },
  marathi: {
    displayName: "Marathi (Mumbai spoken)",
    colloquialWordList: "ahe, karto, nahi, bagh, tumhi, tumhala, theek aahe, haan sanga",
    fillers: "achha, theek aahe, haan, bagh",
    forbiddenWords: "amazing, fantastic, superr, wah, अरे व्वा",
  },
  gujarati: {
    displayName: "Gujarati (Ahmedabad/Surat)",
    colloquialWordList: "che (NOT chhe formal), shu, aap, karo (add to English — call karo, check karo), male che, jaay che",
    fillers: "Haa, Bilkul, Acha, Okay, Samjhyaa, Sari vaat che",
    forbiddenWords: "Wow, Amazing, Super, Great, Jordar, Shabash",
  },
  bengali: {
    displayName: "Bengali (Kolkata spoken)",
    colloquialWordList: "haan, thik ache, bolo, shono, amra, tumi, ki, koro",
    fillers: "haan, thik ache, okay, shono, acha",
    forbiddenWords: "wow, amazing, darun, oshadharon, osadharon",
  },
  malayalam: {
    displayName: "Malayalam (Kerala spoken)",
    colloquialWordList: "aathe, sari, okay, ningal, cheyyu, parayoo, ennitt, enthaa",
    fillers: "aathe, okay, ennitt, ingane, sari",
    forbiddenWords: "wow, amazing, super, adipoli, kidu",
  },
};

// ── Hardcoded Cartesia voice fallback ────────────────────────────────────────

const FALLBACK_VOICES = [
  { id: "a0e99841-438c-4a64-b679-ae501e7d6091", name: "Priya", gender: "Female", description: "Warm Indian English female" },
  { id: "bf991597-6135-4d4d-a38c-2516e5d30000", name: "Aryan", gender: "Male", description: "Confident Indian English male" },
  { id: "79a125e8-cd45-4c13-8a67-188112f4dd22", name: "Sarah", gender: "Female", description: "Friendly US English female" },
  { id: "c45bc1d0-7a89-42de-b4b4-a7cbe5f4d4a1", name: "James", gender: "Male", description: "Professional US English male" },
  { id: "b7d50908-b17c-442d-ad8d-810c63997ed9", name: "Emma", gender: "Female", description: "Clear British English female" },
  { id: "f9836c6e-a0bd-460e-9d3c-f7299fa60f94", name: "Oliver", gender: "Male", description: "British English male" },
  { id: "726d5ae5-055f-4c3d-8355-d9677de68937", name: "Maya", gender: "Female", description: "Soft South Indian English female" },
  { id: "5c42302c-194b-4d0c-ba1a-8cb485c84ab9", name: "Kavya", gender: "Female", description: "Tamil/Telugu female voice" },
];

// ── Helper: get setting from DB ──────────────────────────────────────────────

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, key));
  return row?.value ?? null;
}

// ── GET /wizard/voices ────────────────────────────────────────────────────────

router.get("/wizard/voices", requireAuth, async (req, res): Promise<void> => {
  const cartesiaKey = await getSetting("managed_cartesia_key");

  if (!cartesiaKey) {
    res.json({ voices: FALLBACK_VOICES, source: "fallback" });
    return;
  }

  try {
    const response = await fetch("https://api.cartesia.ai/voices", {
      headers: {
        "X-API-Key": cartesiaKey,
        "Cartesia-Version": "2024-06-10",
      },
    });

    if (!response.ok) {
      res.json({ voices: FALLBACK_VOICES, source: "fallback" });
      return;
    }

    const data = await response.json() as any[];
    const voices = data.slice(0, 20).map((v: any) => ({
      id: v.id,
      name: v.name,
      gender: v.gender ?? "Neutral",
      description: v.description ?? "",
    }));

    res.json({ voices, source: "cartesia" });
  } catch (err) {
    logger.warn({ err }, "Cartesia voices fetch failed — returning fallback");
    res.json({ voices: FALLBACK_VOICES, source: "fallback" });
  }
});

// ── POST /wizard/preview-voice ────────────────────────────────────────────────

router.post("/wizard/preview-voice", requireAuth, async (req, res): Promise<void> => {
  const { voiceId, text } = req.body as { voiceId?: string; text?: string };

  if (!voiceId) {
    res.status(400).json({ error: "voiceId required" });
    return;
  }

  const cartesiaKey = await getSetting("managed_cartesia_key");
  if (!cartesiaKey) {
    res.status(503).json({ error: "Voice preview unavailable — Cartesia key not configured" });
    return;
  }

  const previewText = text?.slice(0, 200) ?? "Hello! I am your AI voice assistant. I am here to help you today. How can I assist you?";

  try {
    const response = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        "X-API-Key": cartesiaKey,
        "Cartesia-Version": "2024-06-10",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_id: "sonic-2",
        transcript: previewText,
        voice: { mode: "id", id: voiceId },
        output_format: { container: "wav", encoding: "pcm_f32le", sample_rate: 22050 },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      res.status(502).json({ error: `Cartesia error: ${err}` });
      return;
    }

    const audioBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(audioBuffer).toString("base64");
    res.json({ audio: base64, mimeType: "audio/wav" });
  } catch (err) {
    logger.error({ err }, "Voice preview failed");
    res.status(500).json({ error: "Voice preview failed" });
  }
});

// ── POST /wizard/generate-prompt ─────────────────────────────────────────────

router.post("/wizard/generate-prompt", requireAuth, async (req, res): Promise<void> => {
  const {
    useCase, role, companyName, agentName, serviceDescription,
    agentDirection, callFlowDescription, languages,
  } = req.body as {
    useCase?: string;
    role?: string;
    companyName?: string;
    agentName?: string;
    serviceDescription?: string;
    agentDirection?: string;
    callFlowDescription?: string;
    languages?: string[];
  };

  if (!callFlowDescription?.trim()) {
    res.status(400).json({ error: "callFlowDescription is required" });
    return;
  }

  const primaryLang = (languages?.[0] ?? "english").toLowerCase();
  const langValues = LANGUAGE_VALUES[primaryLang] ?? LANGUAGE_VALUES["english"]!;

  const geminiKey = await getSetting("managed_gemini_key");

  let callFlowSteps = "";

  if (geminiKey) {
    try {
      const systemMsg = `You are a professional AI voice agent prompt engineer. Based on the user's rough requirements (which may have grammatical errors or be informal), write clear and natural call flow steps for a voice AI agent.

Requirements:
- Agent Role: ${role ?? useCase ?? "AI assistant"}
- Company: ${companyName ?? "the company"}
- Agent Name: ${agentName ?? "Alex"}
- Service: ${serviceDescription ?? "general assistance"}
- Call Direction: ${agentDirection ?? "inbound"}
- User's Description: ${callFlowDescription}

Write ONLY numbered call flow steps (5-10 steps). Each step should be clear, natural, and conversational for a voice agent. No intro or explanation — just the numbered steps. Use <wait for response> where the agent should pause for the caller's reply.`;

      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: systemMsg }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
          }),
        },
      );

      if (geminiRes.ok) {
        const geminiData = await geminiRes.json() as any;
        callFlowSteps = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      }
    } catch (err) {
      logger.warn({ err }, "Gemini call failed — using rule-based fallback");
    }
  }

  if (!callFlowSteps.trim()) {
    callFlowSteps = generateFallbackCallFlow(useCase ?? "general", agentDirection ?? "inbound", callFlowDescription);
  }

  const prompt = MASTER_TEMPLATE
    .replace("{ROLE}", role ?? useCase ?? "AI assistant")
    .replace("{COMPANY_NAME}", companyName ?? "{COMPANY_NAME}")
    .replace("{AGENT_NAME}", agentName ?? "{AGENT_NAME}")
    .replace("{SERVICE_DESCRIPTION}", serviceDescription ?? callFlowDescription.slice(0, 120))
    .replace("{LANGUAGE}", langValues.displayName)
    .replace("{LANGUAGE_SPECIFIC_COLLOQUIAL_WORD_LIST}", langValues.colloquialWordList)
    .replace("{LANGUAGE_SPECIFIC_FILLERS}", langValues.fillers)
    .replace("{FORBIDDEN_WORDS}", langValues.forbiddenWords)
    .replace("{CALL_FLOW_STEPS}", callFlowSteps.trim());

  res.json({ prompt, callFlowSteps });
});

function generateFallbackCallFlow(useCase: string, direction: string, description: string): string {
  const isInbound = direction === "inbound" || direction === "both";
  const greeting = isInbound
    ? "1. Greet the caller warmly by name if known, or with a friendly opening. Introduce yourself and the company. <wait for response>"
    : "1. Greet the person, introduce yourself and the company, and briefly explain why you're calling. Ask if this is a good time. <wait for response>";

  return `${greeting}
2. Acknowledge their response and transition to the main topic naturally using a filler.
3. ${description.slice(0, 200)}. <wait for response>
4. Handle any questions or objections calmly. If they need more information, provide it briefly and clearly.
5. Confirm the next step or action to be taken. <wait for response>
6. Thank them for their time and close the call warmly.`;
}

// ── Admin: GET /admin/managed-keys ────────────────────────────────────────────

const MANAGED_KEY_NAMES = [
  "managed_gemini_key",
  "managed_deepgram_key",
  "managed_sarvam_key",
  "managed_cartesia_key",
  "managed_vobiz_auth_id",
  "managed_vobiz_auth_token",
  "managed_openai_key",
];

router.get("/admin/managed-keys", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(platformSettingsTable)
    .then(r => r.filter(row => MANAGED_KEY_NAMES.includes(row.key)));

  const result: Record<string, string> = {};
  for (const row of rows) {
    const v = row.value;
    result[row.key] = v.length > 8 ? `${v.slice(0, 4)}${"•".repeat(Math.min(v.length - 8, 20))}${v.slice(-4)}` : "••••••••";
  }

  res.json(result);
});

// ── Admin: PUT /admin/managed-keys ────────────────────────────────────────────

router.put("/admin/managed-keys", requireAdmin, async (req, res): Promise<void> => {
  const body = req.body as Record<string, string>;

  const updates: Promise<any>[] = [];

  for (const key of MANAGED_KEY_NAMES) {
    const val = body[key];
    if (typeof val === "string" && val.trim() && !val.includes("•")) {
      updates.push(
        db
          .insert(platformSettingsTable)
          .values({ key, value: val.trim() })
          .onConflictDoUpdate({ target: platformSettingsTable.key, set: { value: val.trim(), updatedAt: new Date() } }),
      );
    }
  }

  await Promise.all(updates);
  res.json({ saved: updates.length });
});

export default router;
