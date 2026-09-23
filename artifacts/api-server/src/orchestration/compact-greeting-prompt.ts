/**
 * Greeting-LLM system prompt. Returning callers must not replay FLOW / GREETING
 * first-time pitch — including outbound campaigns (the inbound instant "Hi {name}"
 * shortcut is a separate path).
 */

/** BCP-47 locale → display name used in the greeting-LLM language instruction. */
const LANG_DISPLAY_NAMES: Record<string, string> = {
  "hi-IN": "Hindi", "ta-IN": "Tamil", "te-IN": "Telugu", "kn-IN": "Kannada",
  "ml-IN": "Malayalam", "mr-IN": "Marathi", "bn-IN": "Bengali", "gu-IN": "Gujarati",
  "pa-IN": "Punjabi", "or-IN": "Odia", "ur-IN": "Urdu",
  "as-IN": "Assamese", "ne-IN": "Nepali", "kok-IN": "Konkani", "ks-IN": "Kashmiri",
  "sd-IN": "Sindhi", "sa-IN": "Sanskrit", "sat-IN": "Santali", "mni-IN": "Manipuri",
  "brx-IN": "Bodo", "mai-IN": "Maithili", "doi-IN": "Dogri",
  "en-IN": "English", "en-US": "English", "en-GB": "English",
  "fr-FR": "French", "de-DE": "German", "es-ES": "Spanish", "pt-BR": "Portuguese",
  "it-IT": "Italian", "ja-JP": "Japanese", "ko-KR": "Korean", "zh-CN": "Chinese",
  "ar-EG": "Arabic", "ru-RU": "Russian",
  "si-LK": "Sinhala", "si": "Sinhala",
};

/**
 * Prompts up to this size skip section-clipping and greet from the full system
 * prompt. Clipping remains only for very large prompts (huge baked KB blocks).
 */
const GREETING_FULL_PROMPT_MAX_CHARS = 12_000;

/** True when the compact-greeting memory clip is a returning caller, even with no stored name. */
export function isReturningCallerMemoryBlock(memoryBlock: string): boolean {
  return /THIS IS A RETURNING CALLER YOU ALREADY KNOW/i.test(memoryBlock)
    || /\bCalls:\s*[1-9]\d*/.test(memoryBlock);
}

export function buildCompactGreetingPrompt(
  fullSystemPrompt: string,
  language: string,
  resumeDropped = false,
  opts?: {
    callDirection?: "inbound" | "outbound" | string | null;
    agentName?: string | null;
    callerName?: string | null;
    memoryLanguagePref?: string | null;
    agentLanguage?: string | null;
    languageAutoDetect?: boolean;
    squadHandoffTakeover?: boolean;
    /** free_text agents: persona Call script only — no company/Identity stages. */
    scriptMode?: "free_text" | "structured" | string | null;
  },
): string {
  const memoryMatch = fullSystemPrompt.match(
    /=== CALLER MEMORY[\s\S]*?={20,}/,
  );
  const memoryBlock = memoryMatch?.[0] ?? "";
  // Section clips. The lazy terminator-anchored patterns fail entirely when a
  // prompt uses plain-text headings with no ===/---/[ boundary markers (call
  // 5198: both clips came back empty → the greeting LLM had NO identity and
  // hallucinated a fictional company). Each clip therefore falls back to a
  // greedy hard-capped grab, and if we STILL have nothing, we take the top of
  // the prompt body — identity is almost always written first.
  // 1600-char cap: real IDENTITY sections routinely run past 800 chars, and the
  // old 800 cap silently truncated opening rules written at the section's tail
  // (call 5246: the "hello already spoken / acknowledge returning caller" rules
  // were cut off → greeting re-greeted with வணக்கம் and ignored caller memory).
  const identityMatch = fullSystemPrompt.match(/\bIDENTITY\b[\s\S]{0,1600}?(?=\n---|\nCALL FLOW|\nFLOW\n|\nCALL PURPOSE|\nGREETING|\n===|$)/i)
    ?? fullSystemPrompt.match(/\bIDENTITY\b[\s\S]{0,1600}/i);
  const callFlowMatch = fullSystemPrompt.match(/\bCALL FLOW\b[\s\S]{0,2200}?(?=\n===|\n\[|$)/i)
    ?? fullSystemPrompt.match(/(?:^|\n)FLOW\n[\s\S]{0,2200}?(?=\n===|\n\[|$)/i)
    ?? fullSystemPrompt.match(/\bGREETING\b[\s\S]{0,1800}?(?=\n===|\n\[|$)/i)
    ?? fullSystemPrompt.match(/\bCALL FLOW\b[\s\S]{0,2200}/i)
    ?? fullSystemPrompt.match(/(?:^|\n)FLOW\n[\s\S]{0,2200}/i);
  let scriptBlock = [identityMatch?.[0], callFlowMatch?.[0]].filter(Boolean).join("\n\n");
  if (!scriptBlock) {
    // No recognizable sections at all — use the start of the prompt (after any
    // caller-memory prefix) so the opener at least knows who it works for.
    const body = memoryBlock ? fullSystemPrompt.slice(fullSystemPrompt.indexOf(memoryBlock) + memoryBlock.length) : fullSystemPrompt;
    scriptBlock = body.trim().slice(0, 1500);
  }
  const langName = LANG_DISPLAY_NAMES[language] ?? language;
  const languageInstruction = `[LANGUAGE] Respond in ${langName}.`;
  const outbound = opts?.callDirection === "outbound";
  const freeText = opts?.scriptMode === "free_text";
  const firstContactRule = freeText
    ? outbound
      ? "[FIRST-CONTACT UX] This is a phone call. Speak ONE short sentence only from the persona/opening in the script: " +
        "who you are and ask if they are free to talk (or how they are). " +
        "Do NOT invent a company, business, recruitment, verification, or sales reason. " +
        "Target 18 words or fewer when natural in this language. Then stop and listen."
      : "[FIRST-CONTACT UX] Speak ONE short sentence only from the persona/opening in the script. " +
        "Do NOT invent a company or business purpose. Then stop and listen."
    : outbound
      ? "[FIRST-CONTACT UX] This is a phone call, not a demo. The caller must understand who is calling before hearing a pitch. " +
        "Speak ONE short sentence only: your name/company exactly as scripted, a very brief reason for the call ONLY if that reason is written in the script, and ask permission to continue. " +
        "Target 18 words or fewer when natural in this language. Do NOT list features, benefits, prices, or multiple questions. Then stop and listen."
      : "[FIRST-CONTACT UX] Speak ONE short sentence only: greet briefly, identify the company exactly as scripted when available, and ask how you can help. " +
        "Target 18 words or fewer when natural in this language. Do NOT list features or ask multiple questions. Then stop and listen.";
  const handoffTakeover = opts?.squadHandoffTakeover === true;
  const isReturningCaller = !resumeDropped && !handoffTakeover && isReturningCallerMemoryBlock(memoryBlock);
  const squadHandoffMatch = fullSystemPrompt.match(
    /\[SQUAD HANDOFF[\s\S]*?(?=\n\[YOUR TEAM\]|\n===|$)/,
  );
  const openingLengthRule = resumeDropped
    ? "[OPENING — RESUME AFTER DROP] The previous call with this caller dropped mid-conversation. " +
      "Speak 1–2 short colloquial sentences only: (1) briefly acknowledge the call got cut/dropped " +
      "(natural phrasing in the caller's language — do NOT greet by name, do NOT say வணக்கம்/hello " +
      "as if starting fresh), (2) immediately continue from LAST EXCHANGES BEFORE THE CALL DROPPED " +
      "in CALLER MEMORY above — pick up the same topic mid-thread. Do NOT re-introduce yourself, " +
      "your company, or restart the sales pitch from the beginning."
    : handoffTakeover
      ? "[OPENING — SQUAD HANDOFF] You just took over this live call from a teammate. The caller is still on the line. " +
        "Speak 1–2 short colloquial sentences only: briefly acknowledge you are here and continue the pending topic. " +
        "Do NOT restart Welcome / CALL FLOW / GREETING. Do NOT introduce yourself as a new call. " +
        "Do NOT ask their name if it is already known."
    : isReturningCaller
      ? "[OPENING — RETURNING CALLER] Do NOT speak the GREETING / CALL FLOW / FLOW first-time pitch. " +
        "Do NOT re-introduce yourself, your company, or restart the sales script. " +
        "Speak 1 short sentence only: greet the caller (by name only if CALLER MEMORY has a real person name) " +
        "and ask if it is a good time to talk. Then wait. Do not recap the previous call."
    : scriptBlock
      ? "[OPENING] Use the GREETING / opening from CALL FLOW / FLOW / Call script above only as source material for the short first-contact line. " +
        "Use the caller's company/contact name when present. Do not deliver the full pitch yet."
      : "[OPENING LENGTH] Your opening line must be ONE short, natural sentence — a brief greeting only. Do not list services, ask multiple questions, or explain anything yet; wait for the caller to respond.";
  // Call 7943: agent display name "voiceathon new agent" leaked into spoken opener
  // as "Thanks for calling voiceathon" even though the prompt never named that brand.
  const agentLabel = (opts?.agentName ?? "").trim();
  const antiInventionRule =
    "[NEVER INVENT] Use ONLY names, brands, and reasons written in the scripted instructions above " +
    "(IDENTITY / CALL FLOW / GREETING / Call script). " +
    "If no company name is given there, greet WITHOUT naming any company — NEVER make up a company, product, or service. " +
    "NEVER invent verifying company/business details, நிறுவன விவரங்கள் சரிபார்த்தல், KYC, recruitment screening, " +
    "Quebec, or any BPO-style purpose that is not in the script (call 28926). " +
    "The agent/workspace display name is an internal label, NOT a company brand — never say " +
    `"thanks for calling <agent name>"` +
    (agentLabel ? ` (do not say "${agentLabel}" or a shortened form of it as the company).` : ".");
  const ownNameRule = agentLabel
    ? ` Your name is ${agentLabel}. Never greet or address the caller as ${agentLabel}, and never add Madam, Sir, or Ma'am because of your own name.`
    : "";
  const returningCallerRule = isReturningCaller
    ? "[RETURNING CALLER] Skip the first-time welcome even if GREETING / FLOW tells you to speak it. " +
      "If CALLER MEMORY has a real person name, greet with that name in ONE short clause. " +
      "Otherwise greet briefly without introducing the company. " +
      "Do NOT recap previous bookings, slots, times, or call summaries in the opener — wait for them to speak. " +
      "Never use a relative-time word as a name (நாளைக்கு, tomorrow, today, yesterday). " +
      "Reference ONLY facts explicitly written in the memory — never invent or infer details." +
      ownNameRule
    : "";
  if (fullSystemPrompt.length <= GREETING_FULL_PROMPT_MAX_CHARS) {
    // Full-prompt greeting: the model sees exactly what it sees on every
    // later turn, so the opener can no longer contradict the conversation.
    const fullOpeningRule = resumeDropped || handoffTakeover || isReturningCaller
      ? openingLengthRule
      : "[OPENING] Produce ONLY your first spoken line of this call, using the opening/greeting " +
        "instructions in your prompt above as source material. Do not deliver the full pitch yet.";
    return [
      fullSystemPrompt,
      languageInstruction,
      fullOpeningRule,
      resumeDropped || handoffTakeover || isReturningCaller ? "" : firstContactRule,
      returningCallerRule,
      antiInventionRule,
    ].filter(Boolean).join("\n\n");
  }
  const parts = [
    memoryBlock,
    squadHandoffMatch?.[0] ?? "",
    scriptBlock,
    languageInstruction,
    openingLengthRule,
    resumeDropped || handoffTakeover || isReturningCaller ? "" : firstContactRule,
    returningCallerRule,
    antiInventionRule,
  ].filter(Boolean);
  return parts.join("\n\n");
}

/**
 * Call 28926: greeting LLM invented "உங்கள் நிறுவனத்தின் விவரங்களை சரிபார்க்க…"
 * when the script never asked for company verification. Keep the identity/ask
 * clauses; drop the hallucinated BPO reason.
 */
const HALLUCINATED_COMPANY_VERIFY_RE =
  /(?:உங்கள்|உங்க)\s*நிறுவன(?:த்தின்)?\s*விவர(?:ங்களை)?\s*சரிபா|நிறுவன(?:த்தின்)?\s*விவர(?:ங்களை)?\s*சரிபார்க்க\s*அழை|verify(?:ing)?\s+(?:your\s+)?(?:company|business)\s+details|calling\s+to\s+(?:verify|confirm)\s+(?:your\s+)?(?:company|business)/iu;

export function scriptMentionsCompanyVerification(script: string): boolean {
  return HALLUCINATED_COMPANY_VERIFY_RE.test(script)
    || /\b(?:company\s+details|business\s+details|kyc|verify\s+the\s+company)\b/i.test(script);
}

export function stripHallucinatedCompanyVerifyGreeting(
  greeting: string,
  fullSystemPrompt: string,
): string {
  const text = greeting.trim();
  if (!text || scriptMentionsCompanyVerification(fullSystemPrompt)) return text;
  if (!HALLUCINATED_COMPANY_VERIFY_RE.test(text)) return text;

  // Keep clauses that do not look like company-verify; prefer the first identity line.
  const clauses = text
    .split(/(?<=[.?!\u0964\u0965])\s+|(?<=[.?!\u0964\u0965])(?=\S)/u)
    .map((c) => c.trim())
    .filter(Boolean);
  const kept = clauses.filter((c) => !HALLUCINATED_COMPANY_VERIFY_RE.test(c));
  if (kept.length > 0) return kept.join(" ").trim();

  // Whole greeting was the hallucination — fall back to first short clause before it.
  const cut = text.search(HALLUCINATED_COMPANY_VERIFY_RE);
  if (cut > 8) return text.slice(0, cut).replace(/[,.\s]+$/u, "").trim();
  return text;
}
