import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth.js";
import { db, agentsTable, platformSettingsTable, schedulingCalendarsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { logActivity } from "../lib/activity.js";


const router = Router();

const KARTHIKEYAN_VOICE_ID = "2344e62d-2b68-4873-9ede-9fa64f6ec889";
const GAYATHRI_VOICE_ID    = "a8adc74b-c9c1-45e0-aae7-9a60ba64bbee";

const LANG_MAP: Record<string, { code: string; label: string; gemini: boolean }> = {
  "ta-IN": { code: "ta-IN", label: "Tamil",            gemini: true  },
  "hi-IN": { code: "hi-IN", label: "Hindi",            gemini: false },
  "te-IN": { code: "te-IN", label: "Telugu",           gemini: false },
  "kn-IN": { code: "kn-IN", label: "Kannada",          gemini: false },
  "ml-IN": { code: "ml-IN", label: "Malayalam",        gemini: false },
  "en-IN": { code: "en-IN", label: "English (India)",  gemini: false },
  "en-US": { code: "en-US", label: "English (US)",     gemini: false },
  "multi": { code: "en-IN", label: "Multi-language",   gemini: false },
};

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

async function getGeminiKey(): Promise<string | null> {
  try {
    const [row] = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, "managed_gemini_key"));
    return row?.value ?? process.env.GEMINI_API_KEY ?? null;
  } catch {
    return process.env.GEMINI_API_KEY ?? null;
  }
}

interface VibeChatMessage { role: "user" | "assistant"; content: string; }

interface VibeConfig {
  agentName:    string;
  language:     string;
  languageMode: "single" | "multi";
  hasTamil:     boolean;
  gender:       "male" | "female";
  companyName:  string;
  direction:    "inbound" | "outbound";
  description:  string;
  knowledge?:   string;
}

interface GeminiParseResult {
  reply:   string;
  ready:   boolean;
  config?: VibeConfig;
}

const VIBE_SYSTEM_PROMPT = `You are a friendly AI agent builder for SnapServe, a voice AI platform. Help the user build a voice agent through a brief conversation.

Collect this information:
1. Agent name (what callers hear — a real human-sounding name)
2. Language: ta-IN (Tamil), hi-IN (Hindi), te-IN (Telugu), kn-IN (Kannada), ml-IN (Malayalam), en-IN (English India), en-US (English US), or "multi" for multilingual
3. Gender: male or female voice
4. Company/brand name
5. Call direction: inbound (customers call the agent) or outbound (agent calls customers)
6. What the agent talks about — its purpose and goal

Rules:
- Be friendly, brief, and conversational — like a helpful colleague
- Ask at most 1-2 questions per turn
- Once you have enough info, set ready=true immediately — don't over-ask
- NEVER ask about STT/LLM/TTS — you handle those automatically
- Default language to en-IN if unclear; direction to inbound if unclear; gender to male if unclear
- Keep replies under 3 sentences

Respond ONLY with valid JSON in this exact shape:
When still collecting info:
{"reply":"...your short conversational reply...","ready":false,"config":null}

When ready to build (have name, company, direction, description):
{"reply":"Perfect! I have everything I need. Building your agent now...","ready":true,"config":{"agentName":"Riya","language":"ta-IN","languageMode":"single","hasTamil":true,"gender":"female","companyName":"Galaxy Health","direction":"inbound","description":"Calls health insurance customers to explain wellness benefits and answer questions about the Gala Fit program"}}`;

async function callGeminiJson(key: string, messages: VibeChatMessage[]): Promise<GeminiParseResult> {
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
    throw new Error(`Gemini ${resp.status}: ${txt.slice(0, 200)}`);
  }

  const data = await resp.json() as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  return JSON.parse(text) as GeminiParseResult;
}

/* ── POST /agents/vibe-chat ──────────────────────────────────────────────── */

router.post("/agents/vibe-chat", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const { messages } = req.body as { messages: VibeChatMessage[] };

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

    let parsed: GeminiParseResult;
    try {
      parsed = await callGeminiJson(geminiKey, messages);
    } catch (err) {
      logger.warn({ err }, "vibe-chat: Gemini call failed");
      emit({ type: "error", message: "AI is temporarily unavailable. Please try again." });
      res.end();
      return;
    }

    // Stream the AI reply text char by char
    const reply = (parsed.reply ?? "Tell me about the agent you want to build!").trim();
    for (const ch of reply) {
      emit({ type: "text", delta: ch });
      await sleep(10);
    }

    if (!parsed.ready || !parsed.config) {
      res.end();
      return;
    }

    const cfg = parsed.config;
    await sleep(400);

    // Resolve LLM / voice / language
    const langInfo   = LANG_MAP[cfg.language] ?? LANG_MAP["en-IN"]!;
    const isTamil    = cfg.hasTamil || langInfo.gemini;
    const llmProvider = isTamil ? "google" : "groq";
    const llmModel    = isTamil ? "gemini-2.5-flash" : "llama-3.3-70b-versatile";
    const voiceId     = cfg.gender === "female" ? GAYATHRI_VOICE_ID : KARTHIKEYAN_VOICE_ID;
    const voiceName   = cfg.gender === "female" ? "Gayathri" : "Karthikeyan";
    const langCode    = cfg.languageMode === "multi" ? "en-IN" : langInfo.code;
    const langDisplay = cfg.languageMode === "multi"
      ? "Multi-language (auto-detect)"
      : langInfo.label;

    // Stream config fields one by one
    const fields = [
      { key: "name",      label: "Agent Name",     value: cfg.agentName,                                         icon: "bot"      },
      { key: "company",   label: "Company",        value: cfg.companyName,                                       icon: "building" },
      { key: "language",  label: "Language",       value: langDisplay,                                           icon: "globe"    },
      { key: "voice",     label: "Voice",          value: `${voiceName} — ${cfg.gender === "female" ? "Female" : "Male"}`, icon: "mic" },
      { key: "direction", label: "Call Direction", value: cfg.direction === "inbound" ? "Inbound" : "Outbound",  icon: "phone"    },
      { key: "llm",       label: "AI Brain",       value: isTamil ? "Gemini 2.5 Flash" : "Groq Llama 3.3 70B",  icon: "cpu"      },
      { key: "stt",       label: "Speech-to-Text", value: "Sarvam Saaras v3",                                    icon: "ear"      },
      { key: "tts",       label: "Voice Engine",   value: "Cartesia Sonic 3.5",                                  icon: "speaker"  },
    ];

    for (const field of fields) {
      await sleep(220);
      emit({ type: "field", ...field });
    }

    await sleep(500);
    emit({ type: "status", message: "Generating system prompt…" });

    // Generate system prompt via Gemini (same key — fast, reliable)
    const fallbackPrompt = `You are ${cfg.agentName}, a voice AI agent for ${cfg.companyName}. Your role is to ${cfg.description}. Be concise, friendly, and professional. Always introduce yourself at the start of every call.`;
    let systemPrompt = fallbackPrompt;
    try {
      const promptInstruction = `You are a senior voice AI prompt engineer. Write a complete, production-ready system prompt for a voice agent.
Requirements:
- Define the agent's name, company, goal, and personality clearly
- Use short, natural sentences suitable for voice (not text)
- Handle common objections and edge cases
- Aim for 400-600 words
- Language: ${langDisplay}
- Output ONLY the system prompt text — no commentary, no markdown fences`;

      const promptUser = `Agent Name: ${cfg.agentName}
Company: ${cfg.companyName}
Direction: ${cfg.direction}
Language: ${langDisplay}
Purpose: ${cfg.description}`;

      const promptResp = await Promise.race([
        fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: promptInstruction }] },
              contents: [{ role: "user", parts: [{ text: promptUser }] }],
              generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
            }),
          },
        ),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("prompt_timeout")), 25000)),
      ]);

      const promptJson = await (promptResp as Response).json() as any;
      const generated = promptJson?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (generated) systemPrompt = generated;
    } catch (err) {
      logger.warn({ err }, "vibe-chat: system prompt generation failed, using fallback");
    }

    // Stream system prompt preview (first 280 chars)
    const preview = systemPrompt.slice(0, 280);
    for (const ch of preview) {
      emit({ type: "prompt_stream", delta: ch });
      await sleep(5);
    }
    if (systemPrompt.length > 280) emit({ type: "prompt_stream", delta: "…" });

    await sleep(600);
    emit({ type: "status", message: "Creating your agent…" });

    // Create the agent in DB
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
        ttsVoice:          voiceId,
        telephonyProvider: "vobiz",
        systemPrompt,
        greetingMessage:   `Hello, I'm ${cfg.agentName} from ${cfg.companyName}. How can I help you today?`,
        agentConfig: {
          languageAutoDetect: cfg.languageMode === "multi",
          recordingEnabled: true,
          autoRedial: { enabled: true, maxAttempts: 3 },
        } as any,
      } as any).returning();
      insertedAgent = row;
    } catch (dbErr) {
      logger.error({ dbErr }, "vibe-chat: DB insert failed");
      emit({ type: "error", message: "Failed to save agent. Please try again." });
      res.end();
      return;
    }

    // Create default scheduling calendar (fire-and-forget)
    db.insert(schedulingCalendarsTable).values({
      agentId:  insertedAgent.id,
      userId:   clerkId,
      name:     `${cfg.agentName} Calendar`,
      timezone: "UTC",
      isActive: true,
    }).onConflictDoNothing().catch(() => {});

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
    } catch { /* already ended */ }
  }
});

export default router;
