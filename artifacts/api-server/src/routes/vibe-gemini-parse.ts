export interface GeminiVibeResponse {
  reply:  string;
  phase:  string;
  ready:  boolean;
  config: Record<string, unknown> | null;
}

function stripCodeFences(raw: string): string {
  let t = raw.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
  }
  return t;
}

function extractJsonObjectText(raw: string): string {
  const t = stripCodeFences(raw);
  if (t.startsWith("{")) return t;
  const match = t.match(/\{[\s\S]*\}/);
  return match?.[0] ?? t;
}

/** Best-effort parse for Gemini JSON output — tolerates fences and leading/trailing prose. */
export function parseVibeGeminiJson(raw: string): GeminiVibeResponse | null {
  const candidates = [stripCodeFences(raw), extractJsonObjectText(raw)];
  for (const text of [...new Set(candidates)]) {
    if (!text.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(text) as Partial<GeminiVibeResponse>;
      if (typeof parsed.reply !== "string" || !parsed.reply.trim()) continue;
      return {
        reply:  parsed.reply.trim(),
        phase:  typeof parsed.phase === "string" ? parsed.phase : "core",
        ready:  !!parsed.ready,
        config: parsed.config && typeof parsed.config === "object"
          ? parsed.config as Record<string, unknown>
          : null,
      };
    } catch { /* try next candidate */ }
  }
  return null;
}

export function extractGeminiResponseText(parts: Array<{ text?: string; thought?: boolean }>): string {
  const withText = parts.filter(p => typeof p.text === "string" && p.text!.length > 0);
  const visible  = withText.filter(p => !p.thought).map(p => p.text!).join("");
  if (visible.trim()) return visible;
  return withText.map(p => p.text!).join("");
}

/** Detect in-chat voice card picks from the dashboard Select message. */
export function parseVoicePick(text: string): { voiceId?: string; voiceName?: string } | null {
  const withId = text.match(/i'?ll go with\s+(.+?)\s*\(\s*voiceId\s*:\s*([^)]+?)\s*\)/i);
  if (withId) {
    return { voiceName: withId[1]!.trim(), voiceId: withId[2]!.trim() };
  }
  if (/i'?ll go with\s+/i.test(text)) {
    const m = text.match(/i'?ll go with\s+([^(.\n]+)/i);
    return m?.[1] ? { voiceName: m[1].trim() } : { voiceName: undefined };
  }
  return null;
}

export function looksLikePhoneAssign(text: string): boolean {
  return /^\s*assign\s+/i.test(text) || /\(\s*number id\s+\d+\s*\)/i.test(text);
}

export function looksLikePhoneSkip(text: string): boolean {
  return /skip the phone number/i.test(text);
}

export function replyAsksCallFlow(reply: string): boolean {
  return /walk me through|how should .+ handle|call (flow|script)|opening|main pitch/i.test(reply);
}

/** Short user nudges that mean "accept and continue" — not a substantive edit. */
export function looksLikeAffirmation(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!]+$/g, "").trim();
  if (!t || t.length > 100) return false;
  if (
    /^(yes|yep|yeah|yup|ok|okay|k|sure|fine|good|great|perfect|done|continue|next|proceed|then|alright|all right|go ahead|go next|use it|use it as-?is|looks good|sounds good|that works|no changes|nothing to change|accepted)([\s,.-]*(please|thanks|thank you)?)?$/i
      .test(t)
  ) {
    return true;
  }
  // "okay then", "ok then", "yes then", "alright then"
  if (/^(yes|yep|yeah|ok|okay|sure|alright|all right)([\s,]+then)+([\s,.-]*(please|thanks|thank you)?)?$/i.test(t)) {
    return true;
  }
  if (/^(yes|ok|okay|sure)[\s,]+(please\s+)?(continue|next|go|proceed|go ahead|go next|then)/i.test(t)) {
    return true;
  }
  if (/^(use it|keep it|ship it|let'?s (go|continue|move on))/i.test(t)) {
    return true;
  }
  return false;
}

/**
 * Broader than looksLikeAffirmation: short "continue / next" intents even when
 * wrapped in a brief status line ("I've added my KB docs. Continue.").
 */
export function looksLikeContinueIntent(text: string): boolean {
  if (looksLikeAffirmation(text)) return true;
  const t = text.trim().toLowerCase();
  if (!t || t.length > 180) return false;
  // Explicit continue/next as the action — not "don't continue" / edit requests.
  if (/\b(don'?t|do not|never)\b.{0,20}\b(continue|next)\b/i.test(t)) return false;
  if (/\b(change|edit|update|rewrite|make|add|remove|fix)\b/i.test(t) && !/\b(continue|next|go ahead)\s*\.?$/i.test(t)) {
    return false;
  }
  if (/\b(continue|go next|next step|move on|proceed)\b/i.test(t)) return true;
  return false;
}

/** Soft "none/skip" answers for optional steps (KB, compliance). */
export function looksLikeSoftSkip(text: string): boolean {
  const raw = text.trim().toLowerCase().replace(/[.!]+$/g, "").trim();
  return /^(skip|none|no|nope|no thanks|nothing|n\/a|no need|not needed|without|without compliance)$/i.test(raw);
}

function strField(cfg: Record<string, unknown>, key: string): string {
  const v = cfg[key];
  return typeof v === "string" ? v.trim() : "";
}

function replyConfirmsNoCompliance(reply: string): boolean {
  return /no compliance|without compliance|compliance.{0,40}(none|not applied|won'?t be applied|will not be applied)/i.test(reply);
}

/**
 * When the user only affirms, force the interviewer forward so it cannot
 * re-confirm the same step. Fills sensible call-flow defaults if still empty.
 */
export function applyAffirmationPhaseAdvance(
  parsed: GeminiVibeResponse,
  lastUserText: string,
): void {
  const raw = lastUserText.trim().toLowerCase();
  const isSkip = looksLikeSoftSkip(lastUserText);
  const wantsContinue = looksLikeContinueIntent(lastUserText) || isSkip;
  if (!wantsContinue) return;
  if (!parsed.config) return;
  const cfg = parsed.config as Record<string, unknown>;
  const name = strField(cfg, "agentName") || "your agent";
  const company = strField(cfg, "companyName") || "the business";
  let phase = (parsed.phase || "").trim();

  // Stuck-loop repair: model re-states "no compliance…" instead of advancing.
  if (replyConfirmsNoCompliance(parsed.reply) && (looksLikeContinueIntent(lastUserText) || isSkip)) {
    phase = "features_compliance";
    parsed.phase = "features_compliance";
  }

  // "skip"/"no" only auto-advances soft optional steps (KB / compliance), not call_flow.
  if (isSkip && phase !== "knowledge_base" && phase !== "features_compliance") return;

  const notes = strField(cfg, "callFlowNotes");
  let mandatory = strField(cfg, "mandatoryQuestions");
  let rules = strField(cfg, "agentRules");
  let callback = strField(cfg, "callbackGreeting");

  // ── call_flow: one "okay" accepts the draft and moves on ───────────────
  if (!isSkip && (phase === "call_flow" || phase === "voice_selection") && notes) {
    if (!mandatory) {
      cfg["mandatoryQuestions"] = [
        "1. Caller full name",
        "2. Reason for the call / what they need",
        "3. Preferred next step (appointment time, callback, or decision)",
      ].join("\n");
      mandatory = String(cfg["mandatoryQuestions"]);
    }
    if (!rules) {
      cfg["agentRules"] = [
        "1. Be warm, clear, and concise — one question at a time",
        `2. Never invent prices, availability, or policies for ${company}`,
        "3. Confirm the next step before ending the call",
      ].join("\n");
      rules = String(cfg["agentRules"]);
    }
    if (!callback) {
      cfg["callbackGreeting"] =
        `Quick re-intro: greet by name if known, briefly remind them you're ${name} from ${company}, then pick up on their last need.`;
      callback = String(cfg["callbackGreeting"]);
    }
    parsed.phase = "knowledge_base";
    if (!/knowledge\s*base/i.test(parsed.reply)) {
      parsed.reply =
        `Got it — call flow locked in for ${name}. Does ${name} need a knowledge base? ` +
        `What should ${name} know about ${company}'s products, services, pricing, or FAQs? ` +
        `Or say "skip" to continue.`;
    }
    return;
  }

  // ── knowledge_base → gender ────────────────────────────────────────────
  if (phase === "knowledge_base") {
    parsed.phase = "features_gender";
    if (!/sir|ma'?am|gender|male or female/i.test(parsed.reply)) {
      parsed.reply =
        `Okay. Should ${name} detect if the caller is male or female to address them as Sir or Ma'am?`;
    }
    return;
  }

  // ── gender → transfer ──────────────────────────────────────────────────
  if (phase === "features_gender") {
    parsed.phase = "features_transfer";
    if (!/transfer/i.test(parsed.reply)) {
      parsed.reply = `Got it. Should ${name} be able to transfer calls to a human agent?`;
    }
    return;
  }

  // ── transfer → voicemail ───────────────────────────────────────────────
  if (phase === "features_transfer") {
    parsed.phase = "features_voicemail";
    if (!/voicemail/i.test(parsed.reply)) {
      parsed.reply = `Okay. For unanswered outbound calls — should ${name} leave a voicemail?`;
    }
    return;
  }

  // ── voicemail → scheduling ─────────────────────────────────────────────
  if (phase === "features_voicemail") {
    parsed.phase = "features_scheduling";
    if (!/schedul|appoint/i.test(parsed.reply)) {
      parsed.reply = `Got it. Does ${name} need to book appointments or manage scheduling?`;
    }
    return;
  }

  // ── scheduling → compliance (when tools already set or scheduling off) ─
  if (phase === "features_scheduling") {
    const tools = cfg["schedulingTools"];
    const enabled = cfg["schedulingEnabled"] === true;
    const toolsReady = Array.isArray(tools) && tools.length > 0;
    if (!enabled || toolsReady) {
      if (!enabled) cfg["schedulingEnabled"] = false;
      parsed.phase = "features_compliance";
      if (!/compliance|dpdp|trai|irdai/i.test(parsed.reply)) {
        parsed.reply =
          `Okay. Any compliance standards for ${name}? Options: DPDP, TRAI, IRDAI — or none.`;
      }
    }
    return;
  }

  // ── compliance → dispositions ──────────────────────────────────────────
  if (phase === "features_compliance") {
    if (isSkip || /^(no|none)\b/i.test(raw)) {
      cfg["compliance"] = { dpdp: false, trai: false, irdai: false };
    }
    parsed.phase = "dispositions";
    if (!/hot|interested|outcome|disposition/i.test(parsed.reply) || replyConfirmsNoCompliance(parsed.reply)) {
      parsed.reply =
        `Got it — no compliance standards for ${name}. ` +
        `How would you define a HOT or Interested lead for ${name}? ` +
        `What does a caller say that means they're interested — and what means Not Interested?`;
    }
    return;
  }

  // ── dispositions affirmed → phone or build ─────────────────────────────
  if (phase === "dispositions") {
    const dispositions = cfg["dispositions"];
    const hasDisp = Array.isArray(dispositions) && dispositions.length > 0;
    if (hasDisp) {
      const direction = String(cfg["direction"] ?? "inbound");
      if (direction === "outbound") {
        parsed.phase = "build";
        parsed.ready = true;
        if (!/building/i.test(parsed.reply)) {
          parsed.reply = `Perfect — I have everything I need! Building ${name} now...`;
        }
      } else {
        parsed.phase = "phone_number";
        if (!/phone number|connect a number|skip for now/i.test(parsed.reply)) {
          parsed.reply =
            `Great. Since ${name} takes incoming calls, let's connect a phone number — ` +
            `pick one below, or skip for now.`;
        }
      }
    }
  }
}

