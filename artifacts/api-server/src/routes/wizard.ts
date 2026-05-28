import { Router, type IRouter } from "express";
import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { platformSettingsTable, platformListedVoicesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { logger } from "../lib/logger.js";
import { getActiveTemplate } from "../services/prompt-template.js";

interface FlowNode { label: string; badge?: string; branch?: boolean }

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
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
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

// ── POST /wizard/generate-call-flow ──────────────────────────────────────────
//
// Generates a contextual call flow from the wizard's 5 micro-answers + the
// currently active admin master template (via Gemini). Returns
// { source: "gemini" | "fallback", nodes, flowText, reason? }. On any missing
// dependency or parse failure, returns source: "fallback" so the client can
// render its built-in rule-based preview.

router.post("/wizard/generate-call-flow", requireDbUser, async (req, res): Promise<void> => {
  const {
    useCase, role, companyName, agentName, agentDirection,
    languages, microAnswers, jdFileContent, jdFileName,
  } = req.body as {
    useCase?: string;
    role?: string;
    companyName?: string;
    agentName?: string;
    agentDirection?: string;
    languages?: string[];
    microAnswers?: Array<{ question?: string; answer?: string }>;
    jdFileContent?: string;
    jdFileName?: string;
  };

  if (!Array.isArray(microAnswers) || microAnswers.length === 0) {
    res.status(400).json({ error: "microAnswers (array of {question, answer}) is required" });
    return;
  }

  const cleaned = microAnswers
    .map((a) => ({
      question: (a?.question ?? "").trim(),
      answer: (a?.answer ?? "").trim(),
    }))
    .filter((a) => a.question.length > 0);

  const nonEmpty = cleaned.filter((a) => a.answer.length > 0);

  const [activeTemplate, geminiKey] = await Promise.all([
    getActiveTemplate().catch((err) => {
      logger.warn({ err }, "getActiveTemplate failed during call-flow generation");
      return null;
    }),
    getSetting("managed_gemini_key"),
  ]);

  if (!activeTemplate) {
    res.json({ source: "fallback", reason: "no_active_template", nodes: null, flowText: "" });
    return;
  }
  if (!geminiKey) {
    res.json({ source: "fallback", reason: "no_gemini_key", nodes: null, flowText: "" });
    return;
  }

  const ag = agentName?.trim() || "the agent";
  const co = companyName?.trim() || "your company";

  function nodesToFlowText(nodes: FlowNode[]): string {
    return nodes
      .map((n, i) => `${n.branch ? "  →" : `${i + 1}.`} ${n.label}${n.badge ? ` [${n.badge}]` : ""}`)
      .join("\n");
  }

  function parseGeminiNodes(text: string): FlowNode[] | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      const match = text.match(/\[[\s\S]*\]/);
      if (!match) return null;
      try { parsed = JSON.parse(match[0]); } catch { return null; }
    }
    if (!Array.isArray(parsed)) return null;
    const nodes: FlowNode[] = parsed
      .map((n) => {
        const obj = (n ?? {}) as Record<string, unknown>;
        const label = typeof obj.label === "string" ? obj.label.trim() : "";
        const badgeRaw = typeof obj.badge === "string" ? obj.badge.trim() : "";
        return {
          label,
          ...(badgeRaw ? { badge: badgeRaw } : {}),
          branch: Boolean(obj.branch),
        };
      })
      .filter((n) => n.label.length > 0)
      .slice(0, 12);
    return nodes.length >= 3 ? nodes : null;
  }

  async function callGemini(extraEmphasis: string): Promise<FlowNode[] | null> {
    const systemInstruction = `You are a senior AI voice agent call-flow designer.
Use the MASTER TEMPLATE below as the STRUCTURAL guide — the ordering and intent of sections (greeting → purpose / qualification → data collection → confirmation → close, or whatever the template prescribes) must be respected.
Produce a concrete, contextual call flow as a JSON array of 5-10 step objects.
Each step object has shape: { "label": string, "badge"?: string, "branch"?: boolean }.
- "label" must be a complete natural sentence describing what the agent does at that step, using the user's actual words and details.
- "badge" is an optional short tag like "Greeting", "Purpose", "Data Collect", "Close".
- "branch": true marks an alternative / fallback path (e.g. "If the caller is busy → ...").
EVERY non-empty user answer below MUST be reflected somewhere in the flow using the user's actual words or recognisably paraphrased — do NOT replace them with generic filler. The optional answer (Q5) may be blank — only include it when given.${extraEmphasis}
Return ONLY the JSON array. No commentary, no markdown fences.

=== MASTER TEMPLATE ===
${activeTemplate!.extractedText}
=== END MASTER TEMPLATE ===`;

    const userBlock = [
      `Agent name: ${ag}`,
      `Company: ${co}`,
      `Use case: ${useCase ?? "general"}`,
      `Role: ${role ?? "AI voice assistant"}`,
      `Call direction: ${agentDirection ?? "inbound"}`,
      `Languages: ${(languages ?? ["english"]).join(", ")}`,
      jdFileName ? `Job description file: ${jdFileName}` : "",
      jdFileContent ? `Job description content:\n${jdFileContent.slice(0, 2000)}` : "",
      "",
      "Micro-questions and the user's answers:",
      ...cleaned.map((a, i) =>
        `Q${i + 1}: ${a.question}\nA${i + 1}: ${a.answer || "(blank — omit this step or use sensible default handling)"}`,
      ),
    ].filter(Boolean).join("\n");

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiKey!)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: "user", parts: [{ text: userBlock }] }],
          generationConfig: {
            temperature: 0.6,
            maxOutputTokens: 2048,
            responseMimeType: "application/json",
          },
        }),
      },
    );
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      logger.warn({ status: r.status, errText: errText.slice(0, 300) }, "Gemini call-flow request failed");
      return null;
    }
    const data = (await r.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    if (!text) return null;
    return parseGeminiNodes(text);
  }

  try {
    let nodes = await callGemini("");

    if (nodes && nonEmpty.length > 0) {
      const haystack = nodes.map((n) => n.label).join(" ").toLowerCase();
      const missing = nonEmpty.filter((a) => {
        const ans = a.answer.toLowerCase();
        const token =
          ans.split(/\s+/).find((w) => w.length >= 4 && /^[a-z0-9]+$/i.test(w)) ??
          ans.slice(0, Math.min(8, ans.length));
        return token.length > 0 && !haystack.includes(token);
      });
      if (missing.length > 0) {
        const retry = await callGemini(
          `\nCRITICAL: a previous attempt dropped these answers — every one MUST appear (verbatim or recognisably paraphrased) in the next output: ${missing
            .map((m) => JSON.stringify(m.answer))
            .join(", ")}.`,
        );
        if (retry) nodes = retry;
      }
    }

    if (!nodes) {
      res.json({ source: "fallback", reason: "gemini_parse_failed", nodes: null, flowText: "" });
      return;
    }

    res.json({ source: "gemini", nodes, flowText: nodesToFlowText(nodes) });
  } catch (err) {
    logger.warn({ err }, "Call-flow generation threw — returning fallback");
    res.json({ source: "fallback", reason: "gemini_call_failed", nodes: null, flowText: "" });
  }
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
