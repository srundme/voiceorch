import { Router } from "express";
import type { Request, Response } from "express";
import { db } from "@workspace/db";
import { platformSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router = Router();

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, key));
  return row?.value ?? null;
}

const SYSTEM_PROMPT = `You are Orcha, a friendly AI voice assistant built into the VoiceOrch platform — an AI voice agent orchestration SaaS. You help users navigate and use the platform through natural voice conversation.

YOUR BEHAVIOR:
- Keep every response SHORT (1-3 sentences max) — this is voice, not text.
- Ask only ONE question at a time.
- Be warm, clear, and conversational.
- Guide users step by step through whatever they want to accomplish.

PLATFORM ROUTES & FEATURES:
- /app — Dashboard: overview stats (agents, calls today, success rate, avg duration), call volume chart, status breakdown
- /app/agents — Agents: create and manage AI voice agents; each agent has ASR + LLM + TTS + telephony pipeline config; can be toggled active/inactive
- /app/calls — Call Logs: full call history, filter by status (queued, in_progress, completed, failed), view transcripts
- /app/providers — Providers: manage your own API keys for ASR (Deepgram, Azure, Whisper), LLM (OpenAI, Anthropic, DeepSeek, Mistral, Cohere), TTS (ElevenLabs, Cartesia, AWS Polly, Azure, Deepgram), Telephony (Twilio, Plivo, Vonage)
- /app/analytics — Analytics: performance metrics, usage trends
- /app/scheduling — Scheduling: hub for the booking engine
- /app/scheduling/calendars — Calendars: create booking calendars linked to agents, connect Google Calendar
- /app/scheduling/event-types — Event Types: configure meeting types (15 min quick chat, 30 min demo, etc.) with public booking pages at /book/your-slug
- /app/scheduling/availability — Availability: set weekly available hours and date overrides (holidays, special hours)

HOW TO CREATE AN AGENT (step-by-step guidance):
1. Go to Providers → add API keys for ASR, LLM, TTS, Telephony
2. Go to Agents → click "+ New Agent"
3. Fill in: name, description, ASR provider, LLM provider, TTS provider, Telephony provider, system prompt
4. Save and toggle it active

NAVIGATION:
When you navigate the user somewhere, include the "navigate" field with the exact path. Only navigate when it clearly helps the user accomplish their goal.

RESPONSE FORMAT — always respond with valid JSON (no markdown, no code fences):
{"message":"Your short spoken response here","navigate":"/app/agents"}

The "navigate" field is optional. Include it only when you are actually sending the user to a specific page.`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// ── POST /assistant/chat ──────────────────────────────────────────────────────

router.post("/assistant/chat", async (req: Request, res: Response): Promise<void> => {
  const dbUser = (req as any).dbUser;
  if (!dbUser) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { message, history, userName, isFirst } = req.body as {
    message: string;
    history?: ChatMessage[];
    userName?: string;
    isFirst?: boolean;
  };

  if (!message?.trim()) { res.status(400).json({ error: "message required" }); return; }

  const displayName = (userName || dbUser.name || dbUser.email?.split("@")[0] || "there").trim();

  const userContent = isFirst
    ? `[The user's name is "${displayName}". This is the FIRST message — greet them warmly by first name, welcome them to VoiceOrch, and ask what they need help with today.]\n${message}`
    : message;

  const messages: ChatMessage[] = [
    ...(history ?? []),
    { role: "user", content: userContent },
  ];

  function parseResponse(raw: string): { text: string; navigate: string | null } {
    const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim();
    try {
      const parsed = JSON.parse(cleaned) as { message?: string; navigate?: string };
      return { text: parsed.message ?? raw, navigate: parsed.navigate ?? null };
    } catch {
      return { text: raw, navigate: null };
    }
  }

  // ── Try Gemini ──────────────────────────────────────────────────────────────
  const geminiKey = await getSetting("managed_gemini_key");
  if (geminiKey) {
    try {
      const contents = messages.map(m => ({
        role: m.role === "user" ? "user" : "model",
        parts: [{ text: m.content }],
      }));

      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents,
            generationConfig: { temperature: 0.75, maxOutputTokens: 256 },
          }),
        },
      );

      if (geminiRes.ok) {
        const data = await geminiRes.json() as any;
        const raw: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        if (raw) { res.json(parseResponse(raw)); return; }
      }
    } catch (err) {
      logger.warn({ err }, "assistant: Gemini failed, trying OpenAI");
    }
  }

  // ── Try OpenAI ──────────────────────────────────────────────────────────────
  const openaiKey = await getSetting("managed_openai_key");
  if (openaiKey) {
    try {
      const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...messages,
          ],
          max_tokens: 256,
          temperature: 0.75,
          response_format: { type: "json_object" },
        }),
      });

      if (openaiRes.ok) {
        const data = await openaiRes.json() as any;
        const raw: string = data.choices?.[0]?.message?.content ?? "";
        if (raw) { res.json(parseResponse(raw)); return; }
      }
    } catch (err) {
      logger.warn({ err }, "assistant: OpenAI failed");
    }
  }

  // ── Fallback ────────────────────────────────────────────────────────────────
  const fallback = isFirst
    ? `Hi ${displayName}! I'm Orcha, your VoiceOrch assistant. What would you like help with today?`
    : "I'm here to help! You can ask me to navigate to Agents, Calls, Providers, or Scheduling.";
  res.json({ text: fallback, navigate: null });
});

// ── POST /assistant/tts ───────────────────────────────────────────────────────

router.post("/assistant/tts", async (req: Request, res: Response): Promise<void> => {
  const dbUser = (req as any).dbUser;
  if (!dbUser) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { text, voiceId } = req.body as { text: string; voiceId?: string };
  if (!text?.trim()) { res.status(400).json({ error: "text required" }); return; }

  const cartesiaKey = await getSetting("managed_cartesia_key");
  if (!cartesiaKey) {
    res.status(503).json({ error: "TTS unavailable — Cartesia key not configured" });
    return;
  }

  try {
    const ttsRes = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        "X-API-Key": cartesiaKey,
        "Cartesia-Version": "2026-03-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_id: "sonic-3.5",
        transcript: text.slice(0, 500),
        voice: {
          mode: "id",
          id: voiceId ?? "a0e99841-438c-4a64-b679-ae501e7d6091",
        },
        output_format: { container: "wav", encoding: "pcm_f32le", sample_rate: 22050 },
      }),
    });

    if (!ttsRes.ok) {
      const err = await ttsRes.text();
      logger.warn({ err }, "assistant: Cartesia TTS error");
      res.status(502).json({ error: `Cartesia error: ${err}` });
      return;
    }

    const audio = await ttsRes.arrayBuffer();
    res.set("Content-Type", "audio/wav");
    res.set("Cache-Control", "no-store");
    res.send(Buffer.from(audio));
  } catch (err) {
    logger.error({ err }, "assistant: TTS request failed");
    res.status(500).json({ error: "TTS failed" });
  }
});

export default router;
