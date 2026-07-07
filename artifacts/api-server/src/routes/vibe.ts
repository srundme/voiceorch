import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth.js";
import {
  db, agentsTable, platformSettingsTable, schedulingCalendarsTable,
  platformListedVoicesTable, agentDispositionsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { logActivity } from "../lib/activity.js";

const router = Router();

const DEFAULT_MALE_VOICE_ID     = "2344e62d-2b68-4873-9ede-9fa64f6ec889";
const DEFAULT_FEMALE_VOICE_ID   = "a8adc74b-c9c1-45e0-aae7-9a60ba64bbee";
const DEFAULT_MALE_VOICE_NAME   = "Karthikeyan";
const DEFAULT_FEMALE_VOICE_NAME = "Gayathri";

const LANG_MAP: Record<string, { code: string; label: string; gemini: boolean }> = {
  "ta-IN": { code: "ta-IN", label: "Tamil",           gemini: true  },
  "hi-IN": { code: "hi-IN", label: "Hindi",           gemini: false },
  "te-IN": { code: "te-IN", label: "Telugu",          gemini: false },
  "kn-IN": { code: "kn-IN", label: "Kannada",         gemini: false },
  "ml-IN": { code: "ml-IN", label: "Malayalam",       gemini: false },
  "en-IN": { code: "en-IN", label: "English (India)", gemini: false },
  "en-US": { code: "en-US", label: "English (US)",    gemini: false },
};

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

async function getGeminiKey(): Promise<string | null> {
  try {
    const [row] = await db.select().from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, "managed_gemini_key"));
    return row?.value ?? process.env.GEMINI_API_KEY ?? null;
  } catch {
    return process.env.GEMINI_API_KEY ?? null;
  }
}

interface VibeChatMessage { role: "user" | "assistant"; content: string; }

export interface VibeVoice {
  voiceId:     string;
  voiceName:   string;
  gender:      string;
  language:    string;
  description: string;
}

interface VibeDisposition {
  category: string;
  outcomes: string[];
}

interface VibeConfig {
  agentName:    string;
  companyName:  string;
  language:     string;
  languageMode: "single" | "multi";
  multilingualLanguages: string[];
  hasTamil:     boolean;
  gender:       "male" | "female";
  direction:    "inbound" | "outbound";
  description:  string;
  voiceId:      string;
  voiceName:    string;
  genderDetectionEnabled: boolean;
  maleSalutation:         string;
  femaleSalutation:       string;
  callTransferEnabled:  boolean;
  transferPhoneNumber:  string;
  transferName:         string;
  voicemailEnabled: boolean;
  voicemailMessage: string;
  schedulingEnabled: boolean;
  compliance: { dpdp: boolean; trai: boolean; irdai: boolean };
  dispositions: VibeDisposition[];
}

interface GeminiVibeResponse {
  reply:  string;
  phase:  string;
  ready:  boolean;
  config: VibeConfig | null;
}

const VIBE_SYSTEM_PROMPT = `You are an expert AI agent builder for SnapServe, a voice AI platform. Guide the user through building a complete, production-ready voice agent through natural, friendly conversation.

CONVERSATION PHASES — complete IN ORDER, never skip:

PHASE "core"
Collect these 5 things:
1. Agent name (a real human-sounding name callers will hear)
2. Company/brand name
3. Primary language — use codes: ta-IN=Tamil, hi-IN=Hindi, te-IN=Telugu, kn-IN=Kannada, ml-IN=Malayalam, en-IN=English India, en-US=English US
4. Call direction: "inbound" (customers call in) or "outbound" (agent calls out)
5. Purpose/description (what the agent does, who it talks to)
→ Transition: once you have all 5, set phase="voice_selection"

PHASE "voice_selection"
Voice options are displayed in the right panel of the UI.
- Say: "The available voices are loaded on the right — take a look and hit Preview to hear a sample. Which one would you like?"
- When the user picks (by name or gender), set voiceId and voiceName exactly from the available options list.
→ Transition: once voice chosen, set phase="multilingual"

PHASE "multilingual"
- Ask: "Should [name] handle multiple languages, or just [primary language]?"
- If yes: ask which languages to add (Tamil/Hindi/Telugu/Kannada/Malayalam/English India/English US)
- Set languageMode="multi" if more than 1 language
- Set hasTamil=true if Tamil is primary or in the list
→ Transition: set phase="features_gender"

PHASE "features_gender"
- Ask: "Should [name] detect whether the caller is male or female, so it can address them as Sir or Ma'am?"
- If yes: record genderDetectionEnabled=true and ask for preferred salutations (defaults: Sir / Ma'am)
→ Transition: set phase="features_transfer"

PHASE "features_transfer"
- Ask: "Should [name] be able to transfer calls to a human agent when needed?"
- If yes: get the transfer phone number and recipient name (e.g. "Support Team")
→ Transition: set phase="features_voicemail"

PHASE "features_voicemail"
- Ask: "Should [name] leave a voicemail if the call goes unanswered?" (relevant for outbound agents)
- If yes: ask what the voicemail message should say
→ Transition: set phase="features_scheduling"

PHASE "features_scheduling"
- Ask: "Does [name] need to book appointments or manage scheduling?"
- If yes: record schedulingEnabled=true and mention a calendar will be set up automatically
→ Transition: set phase="features_compliance"

PHASE "features_compliance"
- Ask: "Any compliance standards to follow? Options: DPDP (India data protection), TRAI (telecom regulations), IRDAI (insurance rules). Choose any or none."
→ Transition: set phase="dispositions"

PHASE "dispositions"
- Based on the agent purpose/direction, AUTO-GENERATE 3–5 relevant call outcome categories.
- Examples for insurance sales: [{category:"Interested",outcomes:["Hot Lead","Warm Lead","Needs Follow-up"]},{category:"Not Interested",outcomes:["Price Concern","Already Insured","DNC"]},{category:"Callback",outcomes:["Requested Callback","No Answer","Voicemail Left"]}]
- Examples for lead qualification: [{category:"Qualified",outcomes:["Hot Prospect","Warm Prospect"]},{category:"Not Qualified",outcomes:["Budget Issue","Wrong Profile"]},{category:"Callback",outcomes:["Scheduled","No Answer"]}]
- Present them: "Here are the call outcomes I've set up for [name]: [brief list]. Does this look right?"
- Adjust if requested
→ Transition: set phase="build"

PHASE "build"
- Say: "I have everything I need! Building [name] now..."
- Set ready=true with the complete config

RULES:
- Friendly and conversational — max 2–3 sentences per reply
- NEVER ask about STT/LLM/TTS — handled automatically
- Always return the COMPLETE config with ALL previously collected fields in every response
- Only 1–2 questions per turn

RESPONSE FORMAT — always output ONLY valid JSON:
{
  "reply": "...",
  "phase": "core|voice_selection|multilingual|features_gender|features_transfer|features_voicemail|features_scheduling|features_compliance|dispositions|build",
  "ready": false,
  "config": {
    "agentName": "",
    "companyName": "",
    "language": "en-IN",
    "languageMode": "single",
    "multilingualLanguages": [],
    "hasTamil": false,
    "gender": "female",
    "direction": "inbound",
    "description": "",
    "voiceId": "",
    "voiceName": "",
    "genderDetectionEnabled": false,
    "maleSalutation": "Sir",
    "femaleSalutation": "Ma'am",
    "callTransferEnabled": false,
    "transferPhoneNumber": "",
    "transferName": "",
    "voicemailEnabled": false,
    "voicemailMessage": "",
    "schedulingEnabled": false,
    "compliance": {"dpdp": false, "trai": false, "irdai": false},
    "dispositions": []
  }
}`;

async function callGemini(key: string, messages: VibeChatMessage[]): Promise<GeminiVibeResponse> {
  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: VIBE_SYSTEM_PROMPT }] },
        contents,
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.7,
          maxOutputTokens: 2048,
        },
      }),
    },
  );

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Gemini ${resp.status}: ${txt.slice(0, 300)}`);
  }

  const data = await resp.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  return JSON.parse(text) as GeminiVibeResponse;
}

/* ── POST /agents/vibe-chat ──────────────────────────────────────────────── */

router.post("/agents/vibe-chat", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const {
    messages,
    voicesShown   = false,
    availableVoices = [] as VibeVoice[],
  } = req.body as {
    messages:        VibeChatMessage[];
    voicesShown?:    boolean;
    availableVoices?: VibeVoice[];
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages array required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const emit = (data: object): void => {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      (res as any).flush?.();
    } catch { /* client disconnected */ }
  };

  try {
    const geminiKey = await getGeminiKey();
    if (!geminiKey) {
      emit({ type: "error", message: "No AI key configured — contact the platform admin." });
      res.end();
      return;
    }

    // Inject voice context so AI knows which voice IDs map to which names
    let contextualMessages = [...messages];
    if (voicesShown && availableVoices.length > 0) {
      const voiceContext = `[VOICE OPTIONS DISPLAYED IN UI]\n${availableVoices.map(v =>
        `- ${v.voiceName} (voiceId: ${v.voiceId}, gender: ${v.gender}${v.description ? `, ${v.description}` : ""})`
      ).join("\n")}\n[END VOICE OPTIONS — when the user picks one, use the exact voiceId from above]`;
      contextualMessages = [
        { role: "user" as const, content: voiceContext },
        { role: "assistant" as const, content: JSON.stringify({ reply: "Got it — I can see the voice options in the UI.", phase: "voice_selection", ready: false, config: null }) },
        ...messages,
      ];
    }

    let parsed: GeminiVibeResponse;
    try {
      parsed = await callGemini(geminiKey, contextualMessages);
    } catch (err) {
      logger.warn({ err }, "vibe-chat: Gemini call failed");
      emit({ type: "error", message: "AI is temporarily unavailable. Please try again." });
      res.end();
      return;
    }

    const reply = (parsed.reply ?? "Tell me about the agent you want to build!").trim();
    for (const ch of reply) {
      emit({ type: "text", delta: ch });
      await sleep(10);
    }

    const cfg   = parsed.config;
    const phase = parsed.phase ?? "core";

    // Emit voice options when entering voice_selection phase for the first time
    if (phase === "voice_selection" && !voicesShown) {
      try {
        const rows = await db.select().from(platformListedVoicesTable)
          .where(eq(platformListedVoicesTable.isListed, true));
        const voiceList: VibeVoice[] = rows.length > 0
          ? rows.map(v => ({
              voiceId:     v.voiceId,
              voiceName:   v.voiceName,
              gender:      v.gender ?? "neutral",
              language:    v.language,
              description: v.description,
            }))
          : [
              { voiceId: DEFAULT_FEMALE_VOICE_ID, voiceName: DEFAULT_FEMALE_VOICE_NAME, gender: "female", language: "en-IN", description: "Indian English — warm female voice" },
              { voiceId: DEFAULT_MALE_VOICE_ID,   voiceName: DEFAULT_MALE_VOICE_NAME,   gender: "male",   language: "en-IN", description: "Indian English — clear male voice"  },
            ];
        emit({ type: "voice_options", voices: voiceList });
      } catch (err) {
        logger.warn({ err }, "vibe-chat: failed to fetch voices, using defaults");
        emit({ type: "voice_options", voices: [
          { voiceId: DEFAULT_FEMALE_VOICE_ID, voiceName: DEFAULT_FEMALE_VOICE_NAME, gender: "female", language: "en-IN", description: "Indian English — warm female voice" },
          { voiceId: DEFAULT_MALE_VOICE_ID,   voiceName: DEFAULT_MALE_VOICE_NAME,   gender: "male",   language: "en-IN", description: "Indian English — clear male voice"  },
        ]});
      }
    }

    if (!cfg || !cfg.agentName) {
      res.end();
      return;
    }

    // Resolve providers
    const langInfo    = LANG_MAP[cfg.language] ?? LANG_MAP["en-IN"]!;
    const isTamil     = cfg.hasTamil || langInfo.gemini ||
                        (cfg.multilingualLanguages ?? []).includes("ta-IN");
    const llmProvider = isTamil ? "google" : "groq";
    const llmModel    = isTamil ? "gemini-2.5-flash" : "llama-3.3-70b-versatile";
    const langCode    = cfg.languageMode === "multi" ? "en-IN" : langInfo.code;
    const langDisplay = cfg.languageMode === "multi" ? "Multi-language" : langInfo.label;

    // Core field events
    const coreFields = [
      { key: "name",      label: "Agent Name",     value: cfg.agentName,                                                         icon: "bot"      },
      { key: "company",   label: "Company",        value: cfg.companyName || "—",                                                icon: "building" },
      { key: "language",  label: "Language",       value: langDisplay,                                                           icon: "globe"    },
      { key: "direction", label: "Call Direction", value: cfg.direction === "inbound" ? "Inbound" : "Outbound",                  icon: "phone"    },
      { key: "llm",       label: "AI Brain",       value: isTamil ? "Gemini 2.5 Flash" : "Groq Llama 3.3 70B",                  icon: "cpu"      },
      { key: "stt",       label: "Speech-to-Text", value: "Sarvam Saaras v3",                                                    icon: "ear"      },
      { key: "tts",       label: "Voice Engine",   value: "Cartesia Sonic 3.5",                                                  icon: "speaker"  },
    ];
    if (cfg.voiceId) {
      coreFields.splice(3, 0, { key: "voice", label: "Voice", value: `${cfg.voiceName} — ${cfg.gender === "female" ? "Female" : "Male"}`, icon: "mic" });
    }
    for (const field of coreFields) {
      await sleep(180);
      emit({ type: "field", ...field });
    }

    // Language pills (multilingual)
    if (cfg.languageMode === "multi" && cfg.multilingualLanguages?.length) {
      for (const code of cfg.multilingualLanguages) {
        const info = LANG_MAP[code];
        if (info) emit({ type: "lang_pill", code, label: info.label });
      }
    }

    // Feature cards — emit for every phase past "core"
    const featurePhases = ["features_gender","features_transfer","features_voicemail",
      "features_scheduling","features_compliance","dispositions","build"];
    if (featurePhases.includes(phase) || parsed.ready) {
      const features: Array<{ key: string; label: string; enabled: boolean; icon: string; detail: string }> = [
        {
          key: "gender_detection", label: "Caller Gender Detection", icon: "user-check",
          enabled: !!cfg.genderDetectionEnabled,
          detail: cfg.genderDetectionEnabled
            ? `${cfg.maleSalutation || "Sir"} / ${cfg.femaleSalutation || "Ma'am"}`
            : "Disabled — callers addressed neutrally",
        },
        {
          key: "call_transfer", label: "Call Transfer to Human", icon: "phone-forwarded",
          enabled: !!cfg.callTransferEnabled,
          detail: cfg.callTransferEnabled
            ? `→ ${cfg.transferName || "Human Agent"} · ${cfg.transferPhoneNumber}`
            : "Disabled",
        },
        {
          key: "voicemail", label: "Voicemail", icon: "voicemail",
          enabled: !!cfg.voicemailEnabled,
          detail: cfg.voicemailEnabled
            ? (cfg.voicemailMessage ? `"${cfg.voicemailMessage.slice(0, 50)}${cfg.voicemailMessage.length > 50 ? "…" : ""}"` : "Leaves a message")
            : "Disabled",
        },
        {
          key: "scheduling", label: "Booking & Scheduling", icon: "calendar",
          enabled: !!cfg.schedulingEnabled,
          detail: cfg.schedulingEnabled ? "Calendar auto-configured" : "Disabled",
        },
        {
          key: "compliance", label: "Compliance", icon: "shield-check",
          enabled: !!(cfg.compliance?.dpdp || cfg.compliance?.trai || cfg.compliance?.irdai),
          detail: [
            cfg.compliance?.dpdp  && "DPDP",
            cfg.compliance?.trai  && "TRAI",
            cfg.compliance?.irdai && "IRDAI",
          ].filter(Boolean).join(" · ") || "None selected",
        },
      ];
      for (const f of features) {
        await sleep(120);
        emit({ type: "feature", ...f });
      }
    }

    // Disposition cards
    if (cfg.dispositions?.length) {
      await sleep(200);
      emit({ type: "section", id: "dispositions", title: "Call Outcomes" });
      for (const d of cfg.dispositions) {
        await sleep(80);
        emit({ type: "disposition_card", category: d.category, outcomes: d.outcomes });
      }
    }

    if (!parsed.ready) {
      res.end();
      return;
    }

    // ── Build phase ──────────────────────────────────────────────────────────
    await sleep(400);
    emit({ type: "status", message: "Generating system prompt…" });

    const resolvedVoiceId   = cfg.voiceId   || (cfg.gender === "female" ? DEFAULT_FEMALE_VOICE_ID   : DEFAULT_MALE_VOICE_ID);
    const resolvedVoiceName = cfg.voiceName || (cfg.gender === "female" ? DEFAULT_FEMALE_VOICE_NAME  : DEFAULT_MALE_VOICE_NAME);

    const fallback = `You are ${cfg.agentName}, a voice AI agent for ${cfg.companyName}. Your role is to ${cfg.description}. Be concise, friendly, and professional.${cfg.callTransferEnabled ? ` When the caller needs human help, transfer them to ${cfg.transferName || "our support team"} at ${cfg.transferPhoneNumber}.` : ""} Always introduce yourself at the start of each call.`;
    let systemPrompt = fallback;
    try {
      const sysInstr = buildPromptInstruction(cfg, langDisplay);
      const sysUser  = buildPromptUserContent(cfg, langDisplay);
      const pr = await Promise.race([
        fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: sysInstr }] },
              contents: [{ role: "user", parts: [{ text: sysUser }] }],
              generationConfig: { temperature: 0.7, maxOutputTokens: 1500 },
            }),
          },
        ),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("prompt_gen_timeout")), 25000)),
      ]);
      const pj = await (pr as Response).json() as any;
      const gen = pj?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (gen) systemPrompt = gen;
    } catch (err) {
      logger.warn({ err }, "vibe-chat: prompt gen failed, using fallback");
    }

    const preview = systemPrompt.slice(0, 300);
    for (const ch of preview) {
      emit({ type: "prompt_stream", delta: ch });
      await sleep(5);
    }
    if (systemPrompt.length > 300) emit({ type: "prompt_stream", delta: "…" });

    await sleep(500);
    emit({ type: "status", message: "Creating your agent…" });

    // Build agentConfig object
    const agentConfig: Record<string, unknown> = {
      recordingEnabled:     true,
      summarizationEnabled: true,
      languageAutoDetect:   cfg.languageMode === "multi",
      isMultilingual:       cfg.languageMode === "multi",
    };
    if (cfg.direction === "outbound") {
      agentConfig.autoRedial = { enabled: true, maxAttempts: 3 };
    }
    if (cfg.languageMode === "multi" && cfg.multilingualLanguages?.length) {
      agentConfig.multilingualLanguages = cfg.multilingualLanguages;
    }
    if (cfg.genderDetectionEnabled) {
      agentConfig.genderDetectionEnabled          = true;
      agentConfig.genderDetectionMaleSalutation   = cfg.maleSalutation   || "Sir";
      agentConfig.genderDetectionFemaleSalutation = cfg.femaleSalutation || "Ma'am";
    }
    if (cfg.voicemailEnabled) {
      agentConfig.voicemailDetection = true;
      agentConfig.voicemailAction    = "leave_message";
      agentConfig.voicemailMessage   = cfg.voicemailMessage || "";
    }
    if (cfg.schedulingEnabled) {
      agentConfig.schedulingGuardrails = true;
    }
    if (cfg.callTransferEnabled && cfg.transferPhoneNumber) {
      agentConfig.callTransferEnabled = true;
      agentConfig.transferPhoneNumber = cfg.transferPhoneNumber;
      agentConfig.transferName        = cfg.transferName || "Human Agent";
    }
    const comp = cfg.compliance ?? { dpdp: false, trai: false, irdai: false };
    if (comp.dpdp || comp.trai || comp.irdai) {
      agentConfig.compliance = comp;
    }

    // Greeting
    const greetingMessage = `Hello! I'm ${cfg.agentName} from ${cfg.companyName}. How can I help you today?`;

    // DB insert — agent
    let insertedAgent: { id: number; name: string };
    try {
      const [row] = await db.insert(agentsTable).values({
        userId:            clerkId,
        name:              cfg.agentName,
        asrProvider:       "sarvam",
        asrModel:          "saaras:v3",
        asrLanguage:       langCode,
        language:          langCode,
        llmProvider,
        llmModel,
        ttsProvider:       "cartesia",
        ttsModel:          "sonic-3.5",
        ttsVoice:          resolvedVoiceId,
        telephonyProvider: "vobiz",
        systemPrompt,
        greetingMessage,
        agentConfig:       agentConfig as any,
      } as any).returning();
      insertedAgent = row;
    } catch (dbErr) {
      logger.error({ dbErr }, "vibe-chat: agent DB insert failed");
      emit({ type: "error", message: "Failed to save agent. Please try again." });
      res.end();
      return;
    }

    // DB insert — dispositions
    if (cfg.dispositions?.length) {
      const taxonomy: Record<string, string[]> = {};
      for (const d of cfg.dispositions) {
        taxonomy[d.category] = d.outcomes;
      }
      db.insert(agentDispositionsTable)
        .values({ agentId: insertedAgent.id, taxonomy, domainFields: [], rules: [] })
        .onConflictDoNothing()
        .catch(err => logger.warn({ err }, "vibe-chat: disposition insert failed"));
    }

    // DB insert — scheduling calendar
    if (cfg.schedulingEnabled) {
      db.insert(schedulingCalendarsTable)
        .values({
          agentId:  insertedAgent.id,
          userId:   clerkId,
          name:     `${cfg.agentName} Calendar`,
          timezone: "Asia/Kolkata",
          isActive: true,
        })
        .onConflictDoNothing()
        .catch(() => {});
    }

    await logActivity({
      userId:       clerkId,
      eventType:    "agent.created",
      resourceType: "agent",
      resourceId:   String(insertedAgent.id),
      description:  `Agent "${insertedAgent.name}" created via Vibe Builder`,
    });

    emit({ type: "created", agentId: insertedAgent.id, agentName: cfg.agentName });
    res.end();

  } catch (err) {
    logger.error({ err }, "vibe-chat: unhandled error");
    try {
      emit({ type: "error", message: "Something went wrong. Please try again." });
      res.end();
    } catch { /* already closed */ }
  }
});

function buildPromptInstruction(cfg: VibeConfig, langDisplay: string): string {
  return `You are a senior voice AI prompt engineer. Write a complete, production-ready system prompt for a voice agent.

Requirements:
- Define the agent's name, company, goal, and personality
- Use short, natural spoken-language sentences (voice, not text/chat)
- Handle common objections and edge cases naturally
- Aim for 500–700 words
- Language: ${langDisplay}
${cfg.callTransferEnabled ? `- Include clear instructions for when to transfer to ${cfg.transferName || "a human agent"} at ${cfg.transferPhoneNumber}` : ""}
${cfg.genderDetectionEnabled ? `- Use {caller_salutation} placeholder for Sir/Ma'am once gender is detected` : ""}
${cfg.schedulingEnabled ? "- Include natural booking/appointment-scheduling dialogue" : ""}
${cfg.voicemailEnabled ? `- Include a brief note about leaving voicemail when calls go unanswered` : ""}
${cfg.compliance?.irdai ? "- Include IRDAI-compliant insurance disclosures and avoid mis-selling language" : ""}
${cfg.compliance?.dpdp ? "- Include DPDP consent language — inform caller about data collection at call start" : ""}
${cfg.compliance?.trai ? "- Follow TRAI regulations: respect DND status, state purpose of call clearly" : ""}

Output ONLY the system prompt text — no commentary, no markdown, no code fences.`;
}

function buildPromptUserContent(cfg: VibeConfig, langDisplay: string): string {
  const lines = [
    `Agent Name: ${cfg.agentName}`,
    `Company: ${cfg.companyName}`,
    `Direction: ${cfg.direction}`,
    `Language: ${langDisplay}`,
    `Purpose: ${cfg.description}`,
  ];
  if (cfg.callTransferEnabled) lines.push(`Call Transfer: Transfer to "${cfg.transferName}" at ${cfg.transferPhoneNumber} when human help is needed`);
  if (cfg.genderDetectionEnabled) lines.push(`Gender Detection: Enabled (male=${cfg.maleSalutation}, female=${cfg.femaleSalutation})`);
  if (cfg.schedulingEnabled) lines.push("Scheduling: Agent can book appointments");
  if (cfg.voicemailEnabled) lines.push(`Voicemail: "${cfg.voicemailMessage}"`);
  if (cfg.dispositions?.length) lines.push(`Dispositions: ${cfg.dispositions.map(d => `${d.category} (${d.outcomes.join(", ")})`).join("; ")}`);
  return lines.join("\n");
}

export default router;
