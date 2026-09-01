/**
 * Per-call inbound/outbound behavior rules injected into the LLM prompt.
 *
 * Agents that handle BOTH directions cannot rely on a static system prompt —
 * the telephony stack already knows this call's direction, so we inject the
 * matching rule every turn (and on the greeting opener).
 */

export type CallDirectionKind = "inbound" | "outbound";

/** Map memory language_pref / BCP-47 / plain names → stable lang key. */
export function resolveOpeningLanguageKey(
  raw: string | null | undefined,
): string {
  const v = (raw ?? "").trim().toLowerCase().replace(/_/g, "-");
  if (!v) return "en";
  if (v === "en" || v.startsWith("en-") || v === "english") return "en";
  if (v === "ta" || v.startsWith("ta-") || v === "tamil") return "ta";
  if (v === "hi" || v.startsWith("hi-") || v === "hindi") return "hi";
  if (v === "te" || v.startsWith("te-") || v === "telugu") return "te";
  if (v === "kn" || v.startsWith("kn-") || v === "kannada") return "kn";
  if (v === "ml" || v.startsWith("ml-") || v === "malayalam") return "ml";
  if (v === "mr" || v.startsWith("mr-") || v === "marathi") return "mr";
  if (v === "bn" || v.startsWith("bn-") || v === "bengali" || v === "bangla") return "bn";
  if (v === "gu" || v.startsWith("gu-") || v === "gujarati") return "gu";
  if (v === "pa" || v.startsWith("pa-") || v === "punjabi") return "pa";
  if (v.length === 2) return v;
  const base = v.split("-")[0]!;
  return base.length === 2 ? base : "en";
}

const LANG_LABEL: Record<string, string> = {
  en: "English",
  ta: "Tamil",
  hi: "Hindi",
  te: "Telugu",
  kn: "Kannada",
  ml: "Malayalam",
  mr: "Marathi",
  bn: "Bengali",
  gu: "Gujarati",
  pa: "Punjabi",
};

/** Prefix greeting (+ optional remembered name) onto purpose-of-call tails.
 *  Use a period (not comma) so TTS plays two beats — greeting, then the
 *  purpose question — instead of rushing one long line. */
function withInboundGreeting(greet: string, name: string | null, tails: string[]): string[] {
  const n = name?.trim() || null;
  const head = n ? `${greet} ${n}. ` : `${greet}. `;
  return tails.map((t) => {
    const body = t.trim();
    // Latin tails need a capital after the period ("Hi. What are you…").
    const capped = /^[a-z]/.test(body) ? body[0]!.toUpperCase() + body.slice(1) : body;
    return `${head}${capped}`;
  });
}

/** Inbound Welcome — spoken first, then the caller, then the prompt. */
export const INBOUND_GREETING = "Hi, Tell me what you called about";

/** Slightly slower TTS for the opening Welcome (inbound and outbound). Later turns keep Sound speed. */
export function resolveInboundGreetingTtsSpeed(agentSpeed: number | null | undefined): number {
  const base = typeof agentSpeed === "number" && Number.isFinite(agentSpeed) && agentSpeed > 0
    ? agentSpeed
    : 1;
  return Math.round(Math.max(0.7, Math.min(1.2, base * 0.85)) * 100) / 100;
}

/** Purpose-of-call examples for inbound openers (with optional name). */
export function inboundPurposeExamples(langKey: string, name: string | null): string[] {
  const n = name?.trim() || null;
  switch (langKey) {
    case "ta":
      // Natural Tamil inbound variety — same intent as
      // "சொல்லுங்க என்ன விஷயமா கால் பண்ணிருக்கீங்க?"
      return withInboundGreeting("வணக்கம்", n, [
        "சொல்லுங்க என்ன விஷயமா கால் பண்ணிருக்கீங்க?",
        "சொல்லுங்க எதற்காக கால் பண்ணிருக்கீங்க?",
        "என்ன விஷயம் சொல்லுங்க?",
        "என்ன காரணமா கால் பண்ணிருக்கீங்க?",
      ]);
    case "hi":
      return withInboundGreeting("नमस्ते", n, [
        "बताइए आपने किस बारे में कॉल किया है?",
        "किस विषय में बात करनी है?",
        "मैं आपकी कैसे मदद कर सकती हूँ?",
        "बताइए, कैसे मदद करूँ?",
        "कौन सी सेवा के लिए कॉल किया है?",
      ]);
    case "te":
      return withInboundGreeting("నమస్కారం", n, [
        "ఏ విషయం మీద కాల్ చేశారు?",
        "ఏం సహాయం కావాలి?",
        "ఎలా సహాయం చేయాలి?",
        "ఏ సేవ కోసం కాల్ చేశారు?",
      ]);
    case "kn":
      return withInboundGreeting("ನಮಸ್ಕಾರ", n, [
        "ಯಾವ ವಿಷಯಕ್ಕಾಗಿ ಕರೆ ಮಾಡಿದ್ದೀರಿ?",
        "ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?",
        "ಏನು ಬೇಕು ಹೇಳಿ?",
        "ಯಾವ ಸೇವೆಗಾಗಿ ಕರೆ ಮಾಡಿದ್ದೀರಿ?",
      ]);
    case "ml":
      return withInboundGreeting("നമസ്കാരം", n, [
        "എന്ത് കാര്യത്തിനാണ് വിളിച്ചത്?",
        "എങ്ങനെ സഹായിക്കാം?",
        "എന്ത് സഹായമാണ് വേണ്ടത്?",
        "ഏത് സേവനത്തിനാണ് വിളിച്ചത്?",
      ]);
    case "mr":
      return withInboundGreeting("नमस्कार", n, [
        "कोणत्या विषयासाठी कॉल केला आहे?",
        "मी कशी मदत करू?",
        "काय मदत हवी आहे?",
        "कोणत्या सेवेसाठी कॉल केला?",
      ]);
    case "bn":
      return withInboundGreeting("নমস্কার", n, [
        "কোন বিষয়ে কল করেছেন?",
        "কীভাবে সাহায্য করতে পারি?",
        "কী সাহায্য লাগবে?",
        "কোন সেবার জন্য কল করেছেন?",
      ]);
    case "gu":
      return withInboundGreeting("નમસ્તે", n, [
        "કયા વિષય માટે કૉલ કર્યો છે?",
        "હું કેવી રીતે મદદ કરું?",
        "શું મદદ જોઈએ?",
        "કઈ સેવા માટે કૉલ કર્યો?",
      ]);
    case "pa":
      return withInboundGreeting("ਸਤ ਸ੍ਰੀ ਅਕਾਲ", n, [
        "ਕਿਹੜੇ ਮਾਮਲੇ ਲਈ ਕਾਲ ਕੀਤੀ ਹੈ?",
        "ਮੈਂ ਕਿਵੇਂ ਮਦਦ ਕਰਾਂ?",
        "ਕੀ ਮਦਦ ਚਾਹੀਦੀ ਹੈ?",
        "ਕਿਹੜੀ ਸੇਵਾ ਲਈ ਕਾਲ ਕੀਤੀ?",
      ]);
    default:
      return withInboundGreeting("Hi", n, [
        "what are you calling about?",
        "what can I help you with?",
        "how can I help you today?",
        "how may I assist you?",
        "which service do you need help with?",
      ]);
  }
}

export function outboundOpenExamples(langKey: string, name: string | null): string[] {
  const n = name?.trim() || null;
  switch (langKey) {
    case "ta":
      return n
        ? [
            `வணக்கம் ${n}, நான் [company]-ல இருந்து பேசுறேன் — ஒரு நிமிஷம் பேசலாமா?`,
          ]
        : [
            "வணக்கம், நான் [company]-ல இருந்து பேசுறேன் — ஒரு நிமிஷம் பேசலாமா?",
          ];
    case "hi":
      return n
        ? [`नमस्ते ${n}, मैं [company] से बात कर रही हूँ — क्या एक मिनट बात हो सकती है?`]
        : ["नमस्ते, मैं [company] से बात कर रही हूँ — क्या एक मिनट बात हो सकती है?"];
    default:
      return n
        ? [`Hi ${n}, this is [name] from [company] — do you have a minute?`]
        : ["Hi, this is [name] from [company] — do you have a minute?"];
  }
}

/**
 * Resolve opening language for this call.
 * - Prefer caller memory language_pref when present
 * - Else English when language auto-detect is on (or no agent language)
 * - Else the agent's configured language (fixed-language agents stay stable)
 */
export function resolveCallOpeningLanguage(opts: {
  memoryLanguagePref?: string | null;
  agentLanguage?: string | null;
  languageAutoDetect?: boolean;
}): { key: string; label: string; source: "memory" | "english_default" | "agent" } {
  const mem = (opts.memoryLanguagePref ?? "").trim();
  if (mem) {
    const key = resolveOpeningLanguageKey(mem);
    return { key, label: LANG_LABEL[key] ?? key, source: "memory" };
  }
  if (opts.languageAutoDetect || !(opts.agentLanguage ?? "").trim()) {
    return { key: "en", label: "English", source: "english_default" };
  }
  const key = resolveOpeningLanguageKey(opts.agentLanguage);
  return { key, label: LANG_LABEL[key] ?? key, source: "agent" };
}

export function buildCallDirectionRule(opts: {
  direction: CallDirectionKind | string | null | undefined;
  callerName?: string | null;
  memoryLanguagePref?: string | null;
  agentLanguage?: string | null;
  languageAutoDetect?: boolean;
  /** When true, opening already spoken — keep direction but ban re-greet / re-ask. */
  openingAlreadyDelivered?: boolean;
}): string {
  const direction: CallDirectionKind =
    opts.direction === "outbound" ? "outbound" : "inbound";
  const name = opts.callerName?.trim() || null;
  const lang = resolveCallOpeningLanguage({
    memoryLanguagePref: opts.memoryLanguagePref,
    agentLanguage: opts.agentLanguage,
    languageAutoDetect: opts.languageAutoDetect,
  });

  const langSourceNote =
    lang.source === "memory"
      ? `from caller memory (language_pref)`
      : lang.source === "english_default"
        ? `default English (no language_pref in memory)`
        : `agent configured language`;

  const langBlock =
    `[OPENING LANGUAGE]\n` +
    `Speak the opening in ${lang.label} (${langSourceNote}).\n` +
    `After the customer speaks, follow THEIR language if they switch — apply the same inbound/outbound meaning in that language.\n` +
    `Never invent a language the caller did not use or store.`;

  if (direction === "outbound") {
    const examples = outboundOpenExamples(lang.key, name).map((e) => `  • ${e}`).join("\n");
    const openPart = opts.openingAlreadyDelivered
      ? `The opening was already spoken — do NOT re-introduce or re-ask permission. Continue the outbound pitch/topic.`
      : [
          `Opening this call:`,
          `1) Brief greeting` + (name ? ` using the name "${name}"` : ""),
          `2) Who you are + company (from the script)`,
          `3) Why YOU called (one short sentence)`,
          `4) Ask permission to talk, then wait`,
          `Example openers (adapt to script; replace [name]/[company]):`,
          examples,
        ].join("\n");
    return [
      `[CALL DIRECTION — OUTBOUND]`,
      `YOU placed this call. The customer did NOT call you.`,
      `Never ask why they called / what they called about.`,
      `Forbidden (any language): "thanks for calling", "thank you for calling", "how can I help you today" as if they dialed in,`,
      `"sollunga ena vishiyama call panirukinga", "என்ன விஷயமா கால் பண்ணிருக்கீங்க", "आपने किस बारे में कॉल किया".`,
      openPart,
      langBlock,
    ].join("\n");
  }

  // inbound
  const examples = inboundPurposeExamples(lang.key, name).map((e) => `  • ${e}`).join("\n");
  const openPart = opts.openingAlreadyDelivered
    ? `The opening was already spoken — do NOT greet again or re-ask why they called unless they have not stated a reason yet and it is natural.`
    : [
        `Opening this call:`,
        `1) Brief greeting` + (name ? ` using the remembered name "${name}"` : " (no remembered name — do not invent one)"),
        `2) Ask why they called / how you can help — one short question, then wait`,
        `Natural inbound phrases (pick one close to the opening language; do not read the list aloud):`,
        examples,
      ].join("\n");

  return [
    `[CALL DIRECTION — INBOUND]`,
    `The customer called YOU.`,
    `Greet as an inbound receptionist. Ask what they need / why they called.`,
    `Do NOT say you are calling them or ask permission as if this were an outbound pitch.`,
    openPart,
    langBlock,
  ].join("\n");
}
