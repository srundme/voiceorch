import { Router, type IRouter } from "express";
import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { platformSettingsTable, platformListedVoicesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// Wizard routes run after provisionUser which sets req.dbUser on authenticated requests.
function requireDbUser(req: Request, res: Response, next: NextFunction): void {
  if (!(req as any).dbUser) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// ── Known-good Cartesia voice IDs (verified real) ────────────────────────────
// Only Arushi is used as fallback — all others come from live Cartesia API.
const ARUSHI_VOICE = { id: "2ee87190-8f84-4925-97da-e52547f9462c", name: "Arushi", gender: "Female", language: "en", description: "Warm Indian English female" };

// Indian language codes recognised by Cartesia
const INDIAN_LANGS = new Set(["hi", "ta", "te", "kn", "ml", "bn", "mr", "gu", "pa", "or", "as", "en-IN"]);

// ── Helper: get setting from DB ──────────────────────────────────────────────

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, key));
  return row?.value ?? null;
}

// ── GET /wizard/voices ────────────────────────────────────────────────────────

router.get("/wizard/voices", requireDbUser, async (req, res): Promise<void> => {
  const { language: langFilter } = req.query as { language?: string };

  // ── Step 1: Check whitelist — if admin has listed voices, return only those ──
  try {
    const listedRows = await db
      .select()
      .from(platformListedVoicesTable)
      .where(eq(platformListedVoicesTable.isListed, true));

    if (listedRows.length > 0) {
      const voices = listedRows.map(r => ({
        id: r.voiceId,
        name: r.voiceName,
        gender: r.gender,
        language: r.language,
        description: r.description,
      }));
      res.json({ voices, source: "whitelist" });
      return;
    }
  } catch (err) {
    logger.warn({ err }, "Whitelist DB query failed — falling through to Cartesia fetch");
  }

  // ── Step 2: No whitelist — existing full-fetch + ranking fallback ─────────
  const cartesiaKey = await getSetting("managed_cartesia_key");

  if (!cartesiaKey) {
    res.json({ voices: [ARUSHI_VOICE], source: "fallback" });
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
      res.json({ voices: [ARUSHI_VOICE], source: "fallback" });
      return;
    }

    const data = await response.json() as any[];

    const INDIAN_NAMES = new Set(["arushi","priya","ananya","kavya","maya","pooja","shruti","riya",
      "neha","divya","meera","rani","aisha","rohan","arjun","vikram","raj","rahul","amit","nikhil"]);

    // Voices for the requested language (exact match)
    const langMatches = (langFilter && INDIAN_LANGS.has(langFilter))
      ? data.filter((v: any) => v.language === langFilter)
      : [];

    // All other Indian-language voices (non-English Indic)
    const otherIndic = data.filter((v: any) =>
      v.language && INDIAN_LANGS.has(v.language as string) && v.language !== langFilter
    );

    // Indian-accented English voices
    const indianEnglish = data.filter((v: any) =>
      (v.language === "en" || !v.language) &&
      INDIAN_NAMES.has((v.name as string || "").toLowerCase().split(" ")[0]!)
    );

    // Combine: language-match first, then other Indic, then Indian English
    const seen = new Set<string>();
    const combined: any[] = [];
    for (const v of [...langMatches, ...otherIndic, ...indianEnglish]) {
      if (!seen.has(v.id)) { seen.add(v.id); combined.push(v); }
    }

    // Only prepend Arushi when no language-specific voices were found
    if (langMatches.length === 0 && !seen.has(ARUSHI_VOICE.id)) combined.unshift(ARUSHI_VOICE);

    const voices = combined.map((v: any) => ({
      id: v.id,
      name: v.name,
      gender: (v.gender ?? "Neutral") as string,
      language: (v.language ?? "en") as string,
      description: (v.description ?? "") as string,
    }));

    res.json({ voices, source: "cartesia" });
  } catch (err) {
    logger.warn({ err }, "Cartesia voices fetch failed — returning fallback");
    res.json({ voices: [ARUSHI_VOICE], source: "fallback" });
  }
});

// ── POST /wizard/preview-voice ────────────────────────────────────────────────

const PREVIEW_VALID_MODELS = new Set([
  "sonic-3.5", "sonic-3.5-2026-05-04", "sonic-latest",
  "sonic-3", "sonic-3-2026-01-12", "sonic-3-latest",
  "sonic-2", "sonic-2-2025-03-07", "sonic-2-2025-04-16", "sonic-2-2025-05-08", "sonic-2-2025-06-11",
  "sonic-turbo", "sonic-turbo-2025-03-07", "sonic-turbo-2025-06-04",
  "sonic-english", "sonic-multilingual",
]);

router.post("/wizard/preview-voice", requireDbUser, async (req, res): Promise<void> => {
  const { voiceId, text, modelId } = req.body as { voiceId?: string; text?: string; modelId?: string };

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
  // Use the caller-supplied model (so the preview matches the agent's model), default to sonic-3.5
  const model = (modelId && PREVIEW_VALID_MODELS.has(modelId)) ? modelId : "sonic-3.5";

  try {
    const response = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        "X-API-Key": cartesiaKey,
        "Cartesia-Version": "2026-03-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_id: model,
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
    res.set("Content-Type", "audio/wav");
    res.send(Buffer.from(audioBuffer));
  } catch (err) {
    logger.error({ err }, "Voice preview failed");
    res.status(500).json({ error: "Voice preview failed" });
  }
});

// ── POST /wizard/generate-prompt ─────────────────────────────────────────────
//
// Returns ONLY a human-readable call flow (5–10 numbered steps) for the dashboard
// to preview. The full system prompt is generated server-side from the admin
// master template on agent create — never exposed to dashboard users.

router.post("/wizard/generate-prompt", requireDbUser, async (req, res): Promise<void> => {
  const {
    useCase, role, companyName, agentName, serviceDescription,
    agentDirection, callFlowDescription,
  } = req.body as {
    useCase?: string;
    role?: string;
    companyName?: string;
    agentName?: string;
    serviceDescription?: string;
    agentDirection?: string;
    callFlowDescription?: string;
  };

  if (!callFlowDescription?.trim()) {
    res.status(400).json({ error: "callFlowDescription is required" });
    return;
  }

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
      logger.warn({ err }, "Gemini call flow generation failed — using rule-based fallback");
    }
  }

  if (!callFlowSteps.trim()) {
    callFlowSteps = generateFallbackCallFlow(useCase ?? "general", agentDirection ?? "inbound", callFlowDescription);
  }

  // Return only the human-readable call flow. The orchestration-grade system
  // prompt is generated server-side from the admin master template at agent
  // create time and is never exposed to dashboard users.
  res.json({ callFlowSteps: callFlowSteps.trim() });
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
