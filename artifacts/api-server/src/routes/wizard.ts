import { Router, type IRouter } from "express";
import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { platformSettingsTable, platformListedVoicesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { logger } from "../lib/logger.js";
import { getActiveTemplate, generateAgentPrompt } from "../services/prompt-template.js";

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
const ARUSHI_VOICE = { id: "2ee87190-8f84-4925-97da-e52547f9462c", name: "Arushi", language: "en", description: "Warm Indian English female" };

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

// ── POST /wizard/generate-master-prompt ──────────────────────────────────────
//
// Calls Qwen with the active Master Prompt Template to produce a complete,
// production-ready system prompt from the user's call flow + agent details.
// Returns { systemPrompt: string } on success.
// Returns non-2xx + { error, reason } on failure — no silent fallbacks.

router.post("/wizard/generate-master-prompt", requireDbUser, async (req, res): Promise<void> => {
  const {
    callFlowDescription, agentName, companyName, useCase, selectedLanguages,
    role, agentDirection, serviceDescription,
  } = req.body as {
    callFlowDescription?: string;
    agentName?: string;
    companyName?: string;
    useCase?: string;
    selectedLanguages?: string[];
    role?: string;
    agentDirection?: string;
    serviceDescription?: string;
  };

  if (!callFlowDescription?.trim()) {
    res.status(400).json({ error: "callFlowDescription is required", reason: "validation" });
    return;
  }

  const activeTemplate = await getActiveTemplate().catch((err) => {
    req.log.warn({ err }, "getActiveTemplate failed during master prompt generation");
    return null;
  });

  if (!activeTemplate) {
    res.status(503).json({
      error: "No active master prompt template is configured. Ask your admin to upload and activate one.",
      reason: "no_active_template",
    });
    return;
  }

  try {
    const wizardInputs = {
      useCase,
      role,
      agentName,
      companyName,
      serviceDescription,
      agentDirection,
      callFlowDescription,
      languages: selectedLanguages,
    };
    const systemPrompt = await generateAgentPrompt(wizardInputs, activeTemplate.extractedText);
    res.json({ systemPrompt });
  } catch (err: unknown) {
    req.log.error({ err }, "Master prompt generation failed");
    const msg = (err as Error)?.message ?? "Prompt generation failed";
    if (msg.includes("Managed Qwen key not configured")) {
      res.status(503).json({ error: msg, reason: "qwen_key_missing" });
    } else {
      res.status(502).json({ error: msg, reason: "qwen_request_failed" });
    }
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

  const qwenKey = (await getSetting("managed_qwen_key") ?? "").trim() || (process.env["GROQ_API_KEY"] ?? "").trim();
  let callFlowSteps = "";

  if (qwenKey) {
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

      const qwenRes = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${qwenKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "qwen/qwen3-32b",
            temperature: 0.7,
            max_tokens: 1024,
            messages: [{ role: "user", content: systemMsg }],
          }),
        },
      );

      if (qwenRes.ok) {
        const qwenData = await qwenRes.json() as any;
        callFlowSteps = qwenData?.choices?.[0]?.message?.content ?? "";
      }
    } catch (err) {
      logger.warn({ err }, "Qwen call flow generation failed — using rule-based fallback");
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
// currently active admin master template (via Qwen). On success returns
// { nodes, flowText }. On failure returns a non-2xx status with a structured
// { error, reason } payload distinguishing: qwen_key_missing,
// no_active_template, qwen_request_failed, qwen_parse_failed.

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

  const qwenKey = (await getSetting("managed_qwen_key") ?? "").trim() || (process.env["GROQ_API_KEY"] ?? "").trim();
  if (!qwenKey) {
    req.log.warn("managed_qwen_key not set in admin — call-flow preview unavailable");
    res.status(503).json({
      error: "Qwen API key is not configured on the server.",
      reason: "qwen_key_missing",
    });
    return;
  }

  const activeTemplate = await getActiveTemplate().catch((err) => {
    req.log.warn({ err }, "getActiveTemplate failed during call-flow generation");
    return null;
  });

  if (!activeTemplate) {
    res.status(503).json({
      error: "No active master prompt template is configured.",
      reason: "no_active_template",
    });
    return;
  }

  const ag = agentName?.trim() || "the agent";
  const co = companyName?.trim() || "your company";

  function nodesToFlowText(nodes: FlowNode[]): string {
    return nodes
      .map((n, i) => `${n.branch ? "  →" : `${i + 1}.`} ${n.label}${n.badge ? ` [${n.badge}]` : ""}`)
      .join("\n");
  }

  function parseQwenNodes(text: string): FlowNode[] | null {
    // Strip markdown code fences (Qwen sometimes wraps even with response_format set)
    const stripped = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();

    let parsed: unknown;

    // Attempt 1: direct parse
    try { parsed = JSON.parse(stripped); } catch { /* fall through */ }

    // Attempt 2: extract first [...] block from raw text
    if (parsed === undefined) {
      const arrMatch = stripped.match(/\[[\s\S]*\]/);
      if (arrMatch) {
        try { parsed = JSON.parse(arrMatch[0]); } catch { /* fall through */ }
      }
    }

    // Attempt 3: Qwen may wrap array in an object {"nodes":[...]} or {"steps":[...]} etc.
    if (parsed !== undefined && !Array.isArray(parsed) && typeof parsed === "object" && parsed !== null) {
      const obj = parsed as Record<string, unknown>;
      for (const key of ["nodes", "steps", "flow", "callFlow", "call_flow", "items"]) {
        if (Array.isArray(obj[key])) { parsed = obj[key]; break; }
      }
    }

    if (!Array.isArray(parsed)) return null;

    const nodes: FlowNode[] = (parsed as unknown[])
      .map((n) => {
        const obj = (n ?? {}) as Record<string, unknown>;
        // label may be a string or number
        const rawLabel = obj.label ?? obj.step ?? obj.text ?? obj.description ?? "";
        const label = String(rawLabel).trim();
        const badgeRaw = typeof obj.badge === "string" ? obj.badge.trim()
          : typeof obj.type === "string" ? obj.type.trim() : "";
        return {
          label,
          ...(badgeRaw ? { badge: badgeRaw } : {}),
          branch: Boolean(obj.branch ?? obj.isBranch ?? obj.is_branch),
        };
      })
      .filter((n) => n.label.length > 0)
      .slice(0, 12);

    return nodes.length >= 2 ? nodes : null;
  }

  function buildFallbackNodes(): FlowNode[] {
    const isInbound = (agentDirection ?? "inbound") !== "outbound";
    const greeting = isInbound
      ? `Greet the caller, introduce ${ag} from ${co}, and ask how you can help today.`
      : `Call the contact, introduce ${ag} from ${co}, and ask if this is a good time to talk.`;

    const nodes: FlowNode[] = [
      { label: greeting, badge: "Greeting" },
    ];

    for (const a of nonEmpty.slice(0, 5)) {
      nodes.push({ label: a.answer, badge: "Flow" });
    }

    if (nodes.length < 4) {
      nodes.push({ label: "Handle any questions or objections calmly and clearly.", badge: "Handle Objections" });
      nodes.push({ label: "Confirm the next step or outcome with the caller.", badge: "Confirm" });
    }

    nodes.push({ label: `Thank the caller and close the conversation warmly.`, badge: "Close" });
    return nodes;
  }

  type QwenResult =
    | { ok: true; nodes: FlowNode[] }
    | { ok: false; reason: "qwen_request_failed" | "qwen_parse_failed"; detail: string };

  async function callQwen(extraEmphasis: string): Promise<QwenResult> {
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

    let r: globalThis.Response;
    try {
      r = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${qwenKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "qwen/qwen3-32b",
            temperature: 0.6,
            max_tokens: 2048,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: systemInstruction },
              { role: "user", content: userBlock },
            ],
          }),
        },
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      req.log.warn({ err }, "Qwen call-flow fetch threw");
      return { ok: false, reason: "qwen_request_failed", detail };
    }
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      req.log.warn({ status: r.status, errText: errText.slice(0, 300) }, "Qwen call-flow request failed");
      return { ok: false, reason: "qwen_request_failed", detail: `HTTP ${r.status}` };
    }
    let data: { choices?: Array<{ message?: { content?: string } }> };
    try {
      data = (await r.json()) as typeof data;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      req.log.warn({ err }, "Qwen call-flow JSON envelope parse failed");
      return { ok: false, reason: "qwen_parse_failed", detail };
    }
    const text = data?.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) {
      req.log.warn("Qwen call-flow returned empty text");
      return { ok: false, reason: "qwen_parse_failed", detail: "empty response" };
    }
    const nodes = parseQwenNodes(text);
    if (!nodes) {
      req.log.warn({ preview: text.slice(0, 300) }, "Qwen call-flow response failed to parse as nodes");
      return { ok: false, reason: "qwen_parse_failed", detail: "could not parse nodes" };
    }
    return { ok: true, nodes };
  }

  const first = await callQwen("");

  // If Qwen request itself failed (network/HTTP), surface that as an error.
  // But for parse failures, always fall back to rule-based nodes — never show the
  // "Couldn't parse Qwen's response" screen to the user.
  if (!first.ok && first.reason === "qwen_request_failed") {
    res.status(502).json({
      error: "Qwen API request failed.",
      reason: "qwen_request_failed",
    });
    return;
  }

  let nodes = first.ok ? first.nodes : buildFallbackNodes();

  if (first.ok && nonEmpty.length > 0) {
    const haystack = nodes.map((n) => n.label).join(" ").toLowerCase();
    const missing = nonEmpty.filter((a) => {
      const ans = a.answer.toLowerCase();
      const token =
        ans.split(/\s+/).find((w) => w.length >= 4 && /^[a-z0-9]+$/i.test(w)) ??
        ans.slice(0, Math.min(8, ans.length));
      return token.length > 0 && !haystack.includes(token);
    });
    if (missing.length > 0) {
      const retry = await callQwen(
        `\nCRITICAL: a previous attempt dropped these answers — every one MUST appear (verbatim or recognisably paraphrased) in the next output: ${missing
          .map((m) => JSON.stringify(m.answer))
          .join(", ")}.`,
      );
      if (retry.ok) nodes = retry.nodes;
      // If the retry fails we keep the first attempt's nodes — first attempt
      // already returned a valid (if imperfect) flow, no need to error out.
    }
  }

  res.json({ nodes, flowText: nodesToFlowText(nodes) });
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

// ── Admin: GET /admin/managed-phone-numbers ───────────────────────────────────

router.get("/admin/managed-phone-numbers", requireAdmin, async (_req, res): Promise<void> => {
  const [row] = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, "managed_phone_numbers"));
  const selected: string[] = row?.value ? (JSON.parse(row.value) as string[]) : [];

  // Fetch available numbers from master Vobiz account
  const authId    = process.env["VOBIZ_AUTH_ID"];
  const authToken = process.env["VOBIZ_AUTH_TOKEN"];
  let available: Array<{ number: string; numberType?: string; region?: string }> = [];

  if (authId && authToken) {
    try {
      const resp = await fetch(`https://api.vobiz.ai/api/v1/Account/${authId}/Number/`, {
        headers: { "X-Auth-ID": authId, "X-Auth-Token": authToken, "Accept": "application/json" },
      });
      if (resp.ok) {
        const data = await resp.json() as { objects?: Array<{ number: string; number_type?: string; region?: string }> };
        available = (data.objects ?? []).map(n => ({
          number:     n.number,
          numberType: n.number_type,
          region:     n.region,
        }));
      }
    } catch {
      // Non-fatal — return empty list
    }
  }

  res.json({ selected, available });
});

// ── Admin: POST /admin/managed-phone-numbers ──────────────────────────────────

router.post("/admin/managed-phone-numbers", requireAdmin, async (req, res): Promise<void> => {
  const { numbers } = req.body as { numbers?: unknown };
  if (!Array.isArray(numbers)) {
    res.status(400).json({ error: "numbers must be an array of phone number strings" });
    return;
  }
  const clean = (numbers as unknown[]).filter((n): n is string => typeof n === "string" && !!n.trim()).map(n => n.trim());
  await db
    .insert(platformSettingsTable)
    .values({ key: "managed_phone_numbers", value: JSON.stringify(clean) })
    .onConflictDoUpdate({ target: platformSettingsTable.key, set: { value: JSON.stringify(clean), updatedAt: new Date() } });
  res.json({ saved: clean.length, numbers: clean });
});

// ── Admin: GET /admin/managed-keys ────────────────────────────────────────────

const MANAGED_KEY_NAMES = [
  // LLM
  "managed_qwen_key",
  "managed_groq_key",
  "managed_gemini_key",
  "managed_openai_key",
  "managed_anthropic_key",
  "managed_mistral_key",
  "managed_cohere_key",
  "managed_deepseek_key",
  // STT
  "managed_deepgram_key",
  "managed_sarvam_key",
  "managed_assemblyai_key",
  "managed_azure_speech_key",
  "managed_azure_speech_region",
  // TTS
  "managed_cartesia_key",
  "managed_elevenlabs_key",
  // Telephony
  "managed_vobiz_auth_id",
  "managed_vobiz_auth_token",
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
