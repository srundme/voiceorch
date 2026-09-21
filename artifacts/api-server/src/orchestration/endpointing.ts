import { clampSemanticTurnStopMs } from "./semantic-turn-gate.js";
import {
  openingHello,
  resolveOpeningLanguageKey,
} from "./call-direction-rules.js";

/**
 * Adaptive endpointing — replaces the flat VAD_SILENCE_MS constant with a
 * context-sensitive silence window that adapts to what the caller is saying
 * and what the agent last asked for.
 *
 * Used by both pipeline.ts (batch telephony path) and webcall.ts (browser WS).
 *
 * Priority order (highest wins):
 *  1. Email-collection context  — agent asked for an address → wait 800 ms+
 *  2. Digit-collection context  — agent asked for policy/phone/OTP → wait 800 ms+
 *  3. Partial transcript text   — streaming STT supplied a partial to analyse
 *  4. Audio duration proxy      — batch path: short burst → fast, long → base
 *  5. baseSilenceMs fallback    — agent-configured override or module default
 */

// ── Named threshold constants ─────────────────────────────────────────────────
/** Snappy flush: "yes", "no", ends in "." / "?" */
export const ENDPOINT_FAST_MS = 150;
/** Neutral baseline — snappier default endpointing window (was 250ms). */
export const ENDPOINT_DEFAULT_MS = 150;
/** Mid-thought: ends in conjunction / filler word ("and", "so", "um"). */
export const ENDPOINT_LONG_MS = 600;
/** Digit-collection: caller is reading a policy/phone/OTP number. */
export const ENDPOINT_DIGIT_MS = 800;
/** Digit-collection AND partial transcript ends in a digit (still reading). */
export const ENDPOINT_DIGIT_TRAIL_MS = 900;
/** Email-collection: caller is spelling an address token-by-token. */
export const ENDPOINT_EMAIL_MS = 800;
/** Email-collection AND the partial still looks like an unfinished address. */
export const ENDPOINT_EMAIL_TRAIL_MS = 900;

export interface EndpointDecision {
  ms: number;
  /** Short label for the turn_latency log — no PII, no raw text. */
  reason: string;
}

// ── Digit-collection keyword list ─────────────────────────────────────────────
// When the AGENT's last utterance contains any of these phrases, we enter
// digit-collection mode: the silence window is held long so the caller can
// read out a number slowly, pausing between digits.
const DIGIT_KEYWORDS = [
  "policy number",
  "phone number",
  "mobile number",
  "contact number",
  "date of birth",
  "dob",
  "otp",
  "one-time password",
  "pin",
  "passcode",
  "id number",
  "account number",
  "card number",
  "aadhaar",
  "aadhar",
  "reference number",
  "registration number",
  "vehicle number",
  "claim number",
  "zip code",
  "postal code",
  "pincode",
  "pin code",
  "6-digit",
  "six digit",
  "passport number",
  "license number",
  "membership number",
  "booking id",
  "ticket number",
  "pan number",
  "gstin",
  "vin number",
  "vehicle identification",
  "employee id",
  "student id",
  "order number",
  "invoice number",
  "tracking number",
  "case number",
  "folio number",
  "application number",
  "verification code",
  "otp code",
  "last four",
  "last 4",
  "security code",
  "cvv",
  // ── Indic native-script digit-collection keywords ─────────────────────────
  // Tamil
  "பாலிசி நம்பர்", "போன் நம்பர்", "மொபைல் நம்பர்", "ஆதார்", "ஓடிபி",
  "பின் நம்பர்", "பிறந்த தேதி",
  // Hindi
  "पॉलिसी नंबर", "फोन नंबर", "मोबाइल नंबर", "आधार", "ओटीपी", "पिन",
  "जन्म तिथि", "जन्मतिथि", "खाता संख्या",
  // Telugu
  "పాలసీ నంబర్", "ఫోన్ నంబర్", "మొబైల్ నంబర్", "ఆధార్", "ఓటీపీ",
  "పుట్టిన తేదీ",
  // Kannada
  "ಪಾಲಿಸಿ ನಂಬರ್", "ಫೋನ್ ನಂಬರ್", "ಮೊಬೈಲ್ ನಂಬರ್", "ಆಧಾರ್", "ಓಟಿಪಿ",
  "ಹುಟ್ಟಿದ ದಿನಾಂಕ",
  // Bengali
  "পলিসি নম্বর", "ফোন নম্বর", "মোবাইল নম্বর", "আধার", "ওটিপি",
  "জন্ম তারিখ",
  // Malayalam
  "പോളിസി നമ്പർ", "ഫോൺ നമ്പർ", "മൊബൈൽ നമ്പർ", "ആധാർ", "ഒടിപി",
  "ജനനത്തീയതി",
];

/**
 * Returns true when the agent's last utterance appears to be requesting
 * a number the caller will read digit-by-digit.
 */
export function isDigitCollectionContext(lastAgentText: string): boolean {
  const lower = lastAgentText.toLowerCase();
  for (const kw of DIGIT_KEYWORDS) {
    if (lower.includes(kw)) return true;
  }
  return false;
}

const EMAIL_KEYWORDS = [
  "email id", "email-id", "email address", "e-mail id", "e-mail address",
  "mail id", "mailid", "mail address", "your email", "your mail", "your e-mail",
  "gmail id", "gmail address", "g mail",
  "ईमेल", "मेल आईडी", "मेल आई डी", "ई-मेल",
  "மின்னஞ்சல்", "மெயில் ஐடி", "இமெயில்", "ஈமெயில்",
  "ఈమెయిల్", "ఇమెయిల్", "ಇಮೇಲ್", "ഇമെയിൽ", "ইমেইল", "ઈમેલ",
];

/** Mentioning an already-collected address is not a request to spell a new one. */
const EMAIL_MENTION_NOT_ASK_RE =
  /\b(same email|that email|this email|the email|registered email|அந்த email|இந்த email|அந்த மெயில்|இந்த மெயில்)\b/i;
const EMAIL_ASK_HINT_RE =
  /(சொல்லு|share|what is|tell me|enter|give me|your email|email id|mail id|மின்னஞ்சல்)/i;

export function isEmailCollectionContext(lastAgentText: string): boolean {
  const lower = lastAgentText.toLowerCase();
  if (EMAIL_MENTION_NOT_ASK_RE.test(lower) && !EMAIL_ASK_HINT_RE.test(lower)) {
    return false;
  }
  for (const kw of EMAIL_KEYWORDS) {
    if (lower.includes(kw)) return true;
  }
  return false;
}

export type CollectionKind = "none" | "digit" | "email";

export function isCallerOfferingEmail(text: string): boolean {
  const t = text.toLowerCase();
  if (!t.trim()) return false;
  return /(மெயில்\s*ஐடி|மின்னஞ்சல்|mail\s*id|email\s*id|என்னுடைய\s*மெயில்|my email)/i.test(t)
    && /(சொல்|tell|share|note|நோட்|give)/i.test(t);
}

/**
 * Collection kind is exclusive — never digit AND email at once.
 *
 * Precedence when prompts overlap (e.g. "phone or email", or an email
 * local-part that looks like a number): **email wins**. Digit-like tokens are
 * legal inside addresses; treating them as OTP would commit "98765" mid-gmail.
 * Digit collection is only used when the agent is not in email context.
 * A fourth collection type must declare where it sits in this list — do not
 * add a parallel timer.
 */
export function resolveCollectionKind(lastAgentText: string, lastUserText = ""): CollectionKind {
  if (isEmailCollectionContext(lastAgentText) || isCallerOfferingEmail(lastUserText) || isCallerOfferingEmail(lastAgentText)) {
    return "email";
  }
  if (isDigitCollectionContext(lastAgentText)) return "digit";
  return "none";
}

/** Spoken English/Hinglish digits and grouping words used when reading IDs aloud. */
const SPELLED_DIGIT_RE =
  /^(zero|oh|o|nought|naught|one|two|three|four|five|six|seven|eight|nine|ten|double|triple|hundred|thousand|and)$/i;

/**
 * True when the pending transcript looks like an in-progress number/ID, not a
 * finished answer. Used so OTP / Aadhaar / phone readouts are not committed
 * after the first syllable ("nine" / "9") just because Smart Turn heard a pause.
 *
 * A compact run of 10+ digits is treated as complete (Indian mobile). Empty
 * text is "still collecting" only when the caller is in digit-collection context.
 */
export function isDigitLikeUtterance(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  const compact = t.replace(/[\s\-./,]/g, "");
  const digitCount = (compact.match(/\d/g) ?? []).length;
  if (digitCount >= 10) return false;
  // Complete Indian PIN — do not keep holding (call 25244: 560005).
  if (/^[1-8]\d{5}$/.test(compact)) return false;
  if (digitCount > 0 && /^[0-9A-Za-z]+$/.test(compact) && compact.length <= 16) {
    const letters = (compact.match(/[A-Za-z]/g) ?? []).length;
    if (letters <= 2) return true;
  }
  const tokens = t.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 8) return false;
  let digitish = 0;
  for (const raw of tokens) {
    const tok = raw.replace(/[,.]+$/u, "");
    if (!tok) continue;
    if (/^\d+$/.test(tok) || SPELLED_DIGIT_RE.test(tok)) digitish++;
  }
  // Six spoken digits is a finished PIN readout, not a mid-spell pause.
  if (digitish >= 6) return false;
  return digitish >= 1 && digitish >= tokens.length - 1;
}

const EMAIL_TLD_RE = /\b(com|in|co\.in|org|net|io|ai|co)\b|காம்/i;
const EMAIL_AT_RE = /@|\b(at|attherate|at the rate)\b|அட்\s*த\s*ரேட்|அட்\s*தரேட்|ஆட்\s*த\s*ரேட்/i;
const EMAIL_DOT_RE = /\b(dot|daat)\b|டாட்/i;
const EMAIL_ADDR_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const EMAIL_DOMAIN_WORD_RE = /\b(gmail|yahoo|hotmail|outlook|rediff|rediffmail|icloud|proton)\b|ஜிமெயில்|ஜிமெய்ல்|ஜீமெயில்/i;
const EMAIL_PUNCT_WORD_RE = /\b(underscore|dash|hyphen|dot|at)\b/;

export function isCompleteEmailUtterance(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (EMAIL_ADDR_RE.test(t)) return true;
  if (EMAIL_AT_RE.test(t) && EMAIL_DOT_RE.test(t) && EMAIL_TLD_RE.test(t)) return true;
  return false;
}

const EMAIL_ACK_RE =
  /^(yes|yeah|yep|ok|okay|no|nope|sure|haan|han|aamaa?|ஆமா|சரி|clear|cleara)([\s,.!]+(madam|ma'?am|sir|ji|மேடம்|சார்))*[\s,.!]*$/iu;
const EMAIL_HONORIFIC_RE = /^(madam|ma'?am|sir|ji|மேடம்|சார்)$/iu;

/**
 * In-progress email spelling: "karthik at", "k a r", "gmail dot".
 * A finished address (local@domain.tld or "at … dot com") is not in-progress.
 */
export function isEmailLikeUtterance(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (looksLikeSpokenEmailSpelling(t) && !isCompleteEmailUtterance(t)) return true;
  if (isCompleteEmailUtterance(t)) return false;
  if (EMAIL_ACK_RE.test(t)) return false;
  if (EMAIL_AT_RE.test(t) || EMAIL_DOT_RE.test(t) || EMAIL_DOMAIN_WORD_RE.test(t)) return true;
  if (EMAIL_PUNCT_WORD_RE.test(t.toLowerCase())) return true;
  const tokens = t.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 12) return false;
  if (tokens.some((tok) => EMAIL_HONORIFIC_RE.test(tok.replace(/[,.]$/, "")))) return false;
  const spelled = tokens.filter((tok) => /^[a-z]$/i.test(tok.replace(/[,.]$/, "")));
  if (spelled.length >= 1 && spelled.length >= tokens.length - 1) return true;
  // Single token local-part while the agent asked for email: "karthikeyan"
  if (tokens.length === 1 && /^[a-z0-9._-]{3,}$/i.test(tokens[0]!)) return true;
  return false;
}

/** Spoken fillers STT glues onto the local-part ("vandhukarthikeyan@gmail.com"). */
const EMAIL_LOCAL_FILLERS = [
  "vandhu", "vanthu", "vandu", "irukken", "irukku", "iruken",
  "emailid", "mailid", "email", "mail", "enna", "naan", "seri", "sari",
].sort((a, b) => b.length - a.length);

export function sanitizeSpokenEmailAddress(addr: string): string {
  const at = addr.lastIndexOf("@");
  if (at <= 0) return addr;
  let local = addr.slice(0, at);
  const domain = addr.slice(at + 1);
  let changed = true;
  while (changed && local.length > 3) {
    changed = false;
    const lower = local.toLowerCase();
    for (const filler of EMAIL_LOCAL_FILLERS) {
      if (lower.startsWith(filler) && local.length - filler.length >= 3) {
        local = local.slice(filler.length);
        changed = true;
        break;
      }
    }
  }
  // STT often prefixes "www." when the caller spells W / "double-u" (call 17701).
  if (local.toLowerCase().startsWith("www.") && local.length > 7) {
    local = local.slice(4);
  }
  return `${local}@${domain}`;
}

export function sanitizeSpokenEmailsInTranscript(text: string): string {
  return text.replace(EMAIL_ADDR_RE, (addr) => sanitizeSpokenEmailAddress(addr));
}

/** Tamil / English letter names used when callers spell an address aloud. */
const SPOKEN_EMAIL_LETTER: Record<string, string> = {
  "கே": "k", "ஆர்": "r", "பி": "b", "சி": "c", "டி": "d", "டீ": "t",
  "ஈ": "e", "எஃப்": "f", "ஜி": "g", "எச்": "h", "ஐ": "i", "ஜே": "j",
  "எல்": "l", "எம்": "m", "என்": "n", "ஓ": "o", "பீ": "p", "க்யூ": "q",
  "எஸ்": "s", "யூ": "u", "வி": "v", "டபிள்யூ": "w", "எக்ஸ்": "x", "ஒய்": "y",
  "இசட்": "z", "ஏய்": "a", "ஏ": "a",
};

const SPOKEN_EMAIL_DOMAIN: Record<string, string> = {
  gmail: "gmail", yahoo: "yahoo", hotmail: "hotmail", outlook: "outlook",
  "ஜிமெயில்": "gmail", "ஜிமெய்ல்": "gmail", "ஜீமெயில்": "gmail",
};

const SPOKEN_EMAIL_DIGIT: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4",
  five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  "ज़ीरो": "0", "जीरो": "0", "वन": "1", "टू": "2", "थ्री": "3",
  "फोर": "4", "फाइव": "5", "सिक्स": "6", "सेवन": "7", "नाइन": "9",
};

function spokenEmailLetter(tok: string): string | null {
  const t = tok.replace(/[.,]/g, "");
  if (SPOKEN_EMAIL_LETTER[t]) return SPOKEN_EMAIL_LETTER[t]!;
  if (/^[a-z]$/i.test(t)) return t.toLowerCase();
  return null;
}

export function looksLikeSpokenEmailSpelling(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (EMAIL_AT_RE.test(t) || EMAIL_DOT_RE.test(t) || EMAIL_DOMAIN_WORD_RE.test(t)) return true;
  const tokens = t.split(/\s+/).filter(Boolean);
  const letters = tokens.filter((tok) => spokenEmailLetter(tok) !== null);
  return letters.length >= 3;
}

/**
 * Turn "கே ஏ ஆர் … அட் த ரேட் ஜிமெயில் டாட் காம்" / "k a r at gmail dot com"
 * into a compact address. Returns null when there is not enough to assemble one.
 */
export function reconstructSpokenEmail(text: string): string | null {
  const compact = text.match(EMAIL_ADDR_RE);
  const assembled = assembleSpokenEmailTokens(text);
  if (compact) {
    const cleaned = sanitizeSpokenEmailAddress(compact[0]);
    if (assembled) {
      const aLocal = assembled.slice(0, assembled.lastIndexOf("@"));
      const cLocal = cleaned.slice(0, cleaned.lastIndexOf("@"));
      const aDom = assembled.slice(assembled.lastIndexOf("@"));
      const cDom = cleaned.slice(cleaned.lastIndexOf("@"));
      // Prefer assembled only when it *completes* the compact STT fragment
      // (call 20113: kishorekumarr307 vs 307). A longer local that does not
      // end with the compact address swallowed speech ("no no it's wrong").
      if (aDom === cDom && aLocal.length > cLocal.length + 1 && aLocal.endsWith(cLocal)) {
        return assembled;
      }
    }
    return cleaned;
  }
  return assembled;
}

function assembleSpokenEmailTokens(text: string): string | null {
  const tokens = text.replace(/@/g, " @ ").split(/\s+/).filter(Boolean);
  let local = "";
  let domain = "";
  let tld = "";
  let seenAt = false;
  for (const raw of tokens) {
    // Keep "gmail.com" intact — stripping "." turned the domain into "gmailcom"
    // and assemble() returned null (call 20113 / "R A J R gmail.com").
    const dotted = raw.match(/^([a-z0-9-]+)\.([a-z]{2,})$/i);
    const tok = raw.replace(/[.,]/g, "");
    const lower = tok.toLowerCase();
    if (!tok && !dotted) continue;
    // Single letters ("A") must not match the "at" alternative — that dropped
    // the spelled local-part before 307@gmail.com (call 20113).
    if (tok === "@" || tok === "அட்" || tok === "ஆட்" || (tok.length > 1 && EMAIL_AT_RE.test(tok))) {
      seenAt = true;
      continue;
    }
    if (/ரேட்|rate/i.test(tok)) continue;
    if (/^(no|nope|nah|wrong|it'?s|its|www|use|again|please|my|the|email|mail|id|is|and)$/i.test(tok)) continue;
    if (dotted && (SPOKEN_EMAIL_DOMAIN[dotted[1]!.toLowerCase()] || seenAt || local.length >= 2)) {
      seenAt = true;
      domain = (SPOKEN_EMAIL_DOMAIN[dotted[1]!.toLowerCase()] ?? dotted[1]!.toLowerCase());
      tld = dotted[2]!.toLowerCase();
      continue;
    }
    const mappedDomain = SPOKEN_EMAIL_DOMAIN[tok] ?? SPOKEN_EMAIL_DOMAIN[lower];
    if (mappedDomain && (seenAt || local.length >= 2)) {
      seenAt = true;
      domain = mappedDomain;
      continue;
    }
    const spokenDigit = SPOKEN_EMAIL_DIGIT[lower] ?? SPOKEN_EMAIL_DIGIT[tok];
    const letter = spokenEmailLetter(tok);
    if (!seenAt) {
      if (spokenDigit) local += spokenDigit;
      else if (letter) local += letter;
      else if (/^[a-z0-9._-]+$/i.test(tok) && tok.length > 1) local += tok.toLowerCase();
      continue;
    }
    if (EMAIL_DOT_RE.test(tok) || tok === "டாட்") continue;
    if (dotted) {
      domain = dotted[1]!.toLowerCase();
      tld = dotted[2]!.toLowerCase();
      continue;
    }
    if ((spokenDigit || /^[a-z0-9._-]+$/i.test(tok)) && !domain) {
      local += spokenDigit ?? tok.toLowerCase();
      continue;
    }
    if (EMAIL_TLD_RE.test(tok) || tok === "காம்") {
      tld = /காம்/i.test(tok) ? "com" : lower.replace(/^co\.in$/i, "co.in");
      continue;
    }
    if (letter && !domain) local += letter;
  }
  if (local.length >= 3 && domain && tld) return sanitizeSpokenEmailAddress(`${local}@${domain}.${tld}`);
  return null;
}

/**
 * Trust the committed STT final when it already has a real address.
 * Call 20284: final `KARETHIAEYAN@gmail.com` must not lose to a longer
 * letter-salad partial (`R T H I K E Y A N.@they might`), and
 * `(spelled …)` dual addresses make the LLM pick the wrong one.
 */
export function preferEmailTranscript(partial: string | undefined, final: string): string {
  const cleanedFinal = sanitizeSpokenEmailsInTranscript(final);
  const fromFinal = reconstructSpokenEmail(cleanedFinal);
  if (fromFinal) {
    return EMAIL_ADDR_RE.test(cleanedFinal)
      ? cleanedFinal.replace(EMAIL_ADDR_RE, fromFinal)
      : fromFinal;
  }
  if (EMAIL_ADDR_RE.test(cleanedFinal)) return cleanedFinal;
  const fromPartial = partial?.trim() ? reconstructSpokenEmail(partial) : null;
  if (fromPartial) return fromPartial;
  return cleanedFinal;
}

/**
 * Timeout fail-open is only safe for already-finished short turns.
 * Long sentences and collection fragments wait for the incomplete-hold instead.
 */
export function looksSnapComplete(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isCompleteEmailUtterance(t)) return true;
  const compact = t.replace(/[\s\-./,]/g, "");
  if ((compact.match(/\d/g) ?? []).length >= 10) return true;
  if (/^(yes|yeah|yep|yup|no|nope|ok|okay|sure|right|haan|han|சரி|ஆமா|हां|हाँ)([,.]|\s+(madam|ma'?am|sir|there|ji|जी))?\.?$/iu.test(t)) {
    return true;
  }
  if (/[.?!।]$/u.test(t) && !/[…]|\.{2,}/.test(t) && t.split(/\s+/).length <= 6) return true;
  return false;
}

/**
 * Happy-path Fast turns ("yes" / "சரி" / a finished 10-digit number) must not
 * wait out the Smart Turn eval budget. HOLD never runs on COMPLETE+veto-pass
 * anyway — the remaining sequential cost on acks is ONNX. Collection fragments
 * still go through Smart Turn + HOLD.
 */
export function shouldSkipSmartTurnEval(opts: {
  pending: string;
  textLooksIncomplete: boolean;
  collectionKind: CollectionKind;
}): boolean {
  if (opts.textLooksIncomplete) return false;
  if (opts.collectionKind !== "none") return false;
  return looksSnapComplete(opts.pending);
}

export type StreamingTurnHold = {
  incomplete: boolean;
  reason: "text_continuation" | "digit_collection" | "email_collection" | null;
  digitCollection: boolean;
  emailCollection: boolean;
  collectionKind: CollectionKind;
  trailingDigit: boolean;
  trailingFragment: boolean;
};

/**
 * Live-path turn hold — same adaptive rules as computeEndpointMs, applied to
 * Smart Turn + text veto. Batch silence flush already used digit-collection;
 * Saaras realtime did not, so "what is your phone number?" was answering after
 * the first digit. Email spelling has the same pause-between-tokens problem.
 */
export function resolveStreamingTurnHold(opts: {
  pending: string;
  lastAgentText: string;
  lastUserText?: string;
  textLooksIncomplete: boolean;
}): StreamingTurnHold {
  let collectionKind = resolveCollectionKind(opts.lastAgentText, opts.lastUserText ?? "");
  const pending = opts.pending.trim();
  if (collectionKind === "none" && looksLikeSpokenEmailSpelling(pending)) {
    collectionKind = "email";
  }
  const digitCollection = collectionKind === "digit";
  const emailCollection = collectionKind === "email";
  const trailingDigit = pending.length > 0 && (/\d\s*$/.test(pending) || isDigitLikeUtterance(pending));
  const spellingInProgress = looksLikeSpokenEmailSpelling(pending)
    && !EMAIL_ADDR_RE.test(pending)
    && !isCompleteEmailUtterance(pending);
  const trailingEmail = emailCollection && (
    isEmailLikeUtterance(pending)
    || spellingInProgress
    || (isDigitLikeUtterance(pending) && !isCompleteEmailUtterance(pending) && !EMAIL_ACK_RE.test(pending))
  );
  const trailingFragment = (digitCollection && isDigitLikeUtterance(pending)) || trailingEmail;
  if (emailCollection && trailingEmail) {
    return {
      incomplete: true,
      reason: "email_collection",
      digitCollection: false,
      emailCollection: true,
      collectionKind,
      trailingDigit: false,
      trailingFragment,
    };
  }
  if (digitCollection && isDigitLikeUtterance(pending)) {
    return {
      incomplete: true,
      reason: "digit_collection",
      digitCollection: true,
      emailCollection: false,
      collectionKind,
      trailingDigit,
      trailingFragment,
    };
  }
  if (opts.textLooksIncomplete) {
    return {
      incomplete: true,
      reason: "text_continuation",
      digitCollection,
      emailCollection,
      collectionKind,
      trailingDigit: false,
      trailingFragment: false,
    };
  }
  if (endsWithDanglingConnector(pending)) {
    return {
      incomplete: true,
      reason: "text_continuation",
      digitCollection,
      emailCollection,
      collectionKind,
      trailingDigit: false,
      trailingFragment: false,
    };
  }
  return {
    incomplete: false,
    reason: null,
    digitCollection,
    emailCollection,
    collectionKind,
    trailingDigit: false,
    trailingFragment: false,
  };
}

/** Extra incomplete-hold after VAD when the caller is still mid-sentence. */
const TEXT_INCOMPLETE_HOLD_MS = 1100;
/** Extra incomplete-hold after VAD when the caller is still reading digits. */
const DIGIT_HOLD_MS = 1200;
const DIGIT_TRAIL_HOLD_MS = 1600;
/** Email spelling is slower than digits — "k a r … at gmail dot com". */
const EMAIL_HOLD_MS = 1400;
const EMAIL_TRAIL_HOLD_MS = 1800;

/**
 * One HOLD clock (`_eouTimer`). Collection floors it; they never race.
 * `collectionKind` is already exclusive (email > digit), so overlapping
 * prompts take the email floor. Trailing fragments use the trail floor.
 */
export function resolveIncompleteHoldMs(opts: {
  baseStopMs: number;
  collectionKind?: CollectionKind;
  /** @deprecated Prefer collectionKind. Kept so existing tests still compile. */
  digitCollection?: boolean;
  trailingDigit?: boolean;
  trailingFragment?: boolean;
  textIncomplete?: boolean;
}): number {
  const base = clampSemanticTurnStopMs(opts.baseStopMs);
  const kind = opts.collectionKind ?? (opts.digitCollection ? "digit" : "none");
  const trailing = opts.trailingFragment ?? opts.trailingDigit ?? false;
  if (kind === "email") {
    const floor = trailing ? EMAIL_TRAIL_HOLD_MS : EMAIL_HOLD_MS;
    return clampSemanticTurnStopMs(Math.max(base, floor));
  }
  if (kind === "digit") {
    const floor = trailing ? DIGIT_TRAIL_HOLD_MS : DIGIT_HOLD_MS;
    return clampSemanticTurnStopMs(Math.max(base, floor));
  }
  if (opts.textIncomplete) {
    return clampSemanticTurnStopMs(Math.max(base, TEXT_INCOMPLETE_HOLD_MS));
  }
  return base;
}

/** Saaras Fast default is 300 ms; collection floors stretch VAD before the next pause. */
export const COLLECTION_VAD_SILENCE_MIN_MS = 150;
export const COLLECTION_VAD_SILENCE_MAX_MS = 1500;
export const COLLECTION_VAD_DIGIT_FLOOR_MS = 1200;
export const COLLECTION_VAD_EMAIL_FLOOR_MS = 1400;

export function resolveCollectionVadSilenceMs(baseMs: number, kind: CollectionKind): number {
  const raw = Number.isFinite(baseMs) ? Math.round(baseMs) : 300;
  const base = Math.max(
    COLLECTION_VAD_SILENCE_MIN_MS,
    Math.min(COLLECTION_VAD_SILENCE_MAX_MS, raw),
  );
  if (kind === "email") {
    return Math.min(COLLECTION_VAD_SILENCE_MAX_MS, Math.max(base, COLLECTION_VAD_EMAIL_FLOOR_MS));
  }
  if (kind === "digit") {
    return Math.min(COLLECTION_VAD_SILENCE_MAX_MS, Math.max(base, COLLECTION_VAD_DIGIT_FLOOR_MS));
  }
  return base;
}

/**
 * Extra silence to merge STT fragments while the caller is still reading a
 * PIN / OTP / Gmail address. 0 when the utterance is already complete so a
 * finished 6-digit PIN is not delayed.
 */
export function collectionHoldMsForTranscript(opts: {
  lastAgentText: string;
  transcript: string;
}): number {
  const hold = resolveStreamingTurnHold({
    pending: opts.transcript,
    lastAgentText: opts.lastAgentText,
    lastUserText: opts.transcript,
    textLooksIncomplete: false,
  });
  if (hold.reason !== "digit_collection" && hold.reason !== "email_collection" && hold.reason !== "text_continuation") {
    return 0;
  }
  if (!hold.incomplete) return 0;
  return resolveIncompleteHoldMs({
    baseStopMs: 800,
    collectionKind: hold.collectionKind,
    trailingFragment: hold.trailingFragment,
    textIncomplete: hold.reason === "text_continuation",
  });
}

// ── Dangling / mid-utterance words ────────────────────────────────────────────
// If the partial transcript ends with one of these the caller is likely
// mid-sentence — wait longer before flushing to STT.
const DANGLING_WORDS = new Set([
  "and",
  "so",
  "but",
  "or",
  "my",
  "the",
  "a",
  "an",
  "its",
  "it's",
  "to",
  "of",
  "in",
  "for",
  "with",
  "um",
  "uh",
  "er",
  "like",
  "i",
  "because",
  "if",
  "when",
  "while",
  "as",
  "then",
  "also",
  "well",
  "this",
  "that",
  "these",
  "those",
  "there",
  "here",
  "we",
  "you",
  "they",
  "he",
  "she",
  "is",
  "was",
  "are",
  "were",
  "will",
  "would",
  "can",
  "could",
  "should",
  "what",
  "which",
  "who",
  "how",
  "where",
  "plus",
  "however",
  "actually",
  "basically",
  // Tamil mid-sentence connectors (Indian PSTN)
  "எனக்கு",
  "வந்து",
  "ஆனா",
  "ஆனால்",
  "அதனால",
  "அதனால்",
  "இன்னும்",
  "அப்புறம்",
  "கிட்ட",
]);

/** True when the last token is a dangling connector / incomplete cue. */
export function endsWithDanglingConnector(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const last = t.split(/\s+/).filter(Boolean).pop()?.toLowerCase().replace(/[^\p{L}\p{N}]+$/gu, "") ?? "";
  if (!last) return false;
  return DANGLING_WORDS.has(last);
}

// ── Turn safety-net constants (env-configurable) ──────────────────────────────
// These guard against the "Listening…" hang where streaming STT emits partial
// transcripts (or nothing usable) but never delivers a final, so the turn never
// closes. Two independent timers — see TurnSafetyNet below.
function envInt(name: string, def: number): number {
  const raw = process.env[name];
  if (!raw) return def;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : def;
}
/** Tight timer: partials arriving but no final → force-close using the best partial.
 *  Default 0 — trust provider finals. Override with env FORCE_FINALIZE_MS. */
export const FORCE_FINALIZE_MS = envInt("FORCE_FINALIZE_MS", 0);
/** Loose backstop: no usable transcript at all since we entered "Listening…" →
 *  recovery reprompt. Default 0 — no SnapServe “I didn’t catch that”.
 *  Override with env STALL_BACKSTOP_MS. */
export const STALL_BACKSTOP_MS = envInt("STALL_BACKSTOP_MS", 0);
/** Shorter stall window after greeting on outbound calls (caller may need a beat to respond).
 *  Kept closer to inbound so we don't rush "can't hear" / hangup after a stub opener. */
export const OUTBOUND_POST_GREETING_STALL_MS = envInt("OUTBOUND_POST_GREETING_STALL_MS", 0);
/** Even shorter when resuming a dropped callback — expect a quick "hello?" back. */
export const RESUME_DROP_POST_GREETING_STALL_MS = envInt("RESUME_DROP_POST_GREETING_STALL_MS", 0);
/** Max consecutive stall reprompts before ending the call. Override with env
 *  STALL_MAX_REPROMPTS. */
export const STALL_MAX_REPROMPTS = envInt("STALL_MAX_REPROMPTS", 2);

/** Reason a user turn closed — emitted in the turn_latency log line. */
export type TurnCloseReason =
  | "stt_final"
  | "force_finalized"
  | "stall_reprompt"
  | "coalesced_fragment"
  | "barge_recovery";

// Language-aware recovery reprompt spoken when the stall backstop fires.
const RECOVERY_REPROMPTS: Record<string, string> = {
  en: "Sorry, I didn't catch that — could you say that again?",
  hi: "माफ़ कीजिए, मैं समझ नहीं पाया — क्या आप दोबारा कह सकते हैं?",
  ta: "சாரி, சரியா கேட்கல — மறுபடி சொல்லுவீங்களா?",
  te: "క్షమించండి, నాకు అర్థం కాలేదు — మళ్ళీ చెప్పగలరా?",
  kn: "ಕ್ಷಮಿಸಿ, ನನಗೆ ಅರ್ಥವಾಗಲಿಲ್ಲ — ಇನ್ನೊಮ್ಮೆ ಹೇಳಬಹುದೇ?",
  mr: "माफ करा, मला समजलं नाही — तुम्ही पुन्हा सांगू शकता का?",
  gu: "માફ કરશો, મને સમજાયું નહીં — ફરી કહી શકશો?",
  bn: "দুঃখিত, আমি বুঝতে পারিনি — আবার বলবেন কি?",
  ml: "ക്ഷമിക്കണം, എനിക്ക് മനസ്സിലായില്ല — ഒന്നുകൂടി പറയാമോ?",
};
/** Recovery reprompt text for a BCP-47 / language code (falls back to English). */
export function recoveryReprompt(lang?: string | null): string {
  const prefix = (lang ?? "en").split("-")[0] ?? "en";
  return RECOVERY_REPROMPTS[prefix] ?? RECOVERY_REPROMPTS["en"]!;
}

// Voice Memory — forced spoken challenge when mid-call speaker handoff is detected.
const SPEAKER_HANDOFF_CHALLENGES: Record<string, string> = {
  en: "Sorry — who am I speaking with now?",
  hi: "माफ़ कीजिए — अभी मैं किससे बात कर रहा हूँ?",
  ta: "சாரி — இப்போ நான் யாருடன் பேசுகிறேன்?",
  te: "క్షమించండి — ఇప్పుడు నేను ఎవరితో మాట్లాడుతున్నాను?",
  kn: "ಕ್ಷಮಿಸಿ — ಈಗ ನಾನು ಯಾರೊಂದಿಗೆ ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ?",
  mr: "माफ करा — आता मी कोणाशी बोलत आहे?",
  gu: "માફ કરશો — હું હવે કોની સાથે વાત કરું છું?",
  bn: "দুঃখিত — এখন আমি কার সাথে কথা বলছি?",
  ml: "ക്ഷമിക്കണം — ഇപ്പോൾ ഞാൻ ആരോടാണ് സംസാരിക്കുന്നത്?",
};
/** Soft identity check after Voice Memory detects a new speaker on the line. */
export function speakerHandoffChallenge(lang?: string | null): string {
  const prefix = (lang ?? "en").split("-")[0] ?? "en";
  return SPEAKER_HANDOFF_CHALLENGES[prefix] ?? SPEAKER_HANDOFF_CHALLENGES["en"]!;
}

/** Mid-call address when a new number's voice matches a known caller. */
const VOICE_LINK_ACK_NAMED: Record<string, (name: string) => string> = {
  en: (n) => `Hi ${n} — good to hear from you again.`,
  hi: (n) => `${n} जी, आपसे फिर बात करके अच्छा लगा।`,
  ta: (n) => `ஹாய் ${n} — மீண்டும் பேசறதுல சந்தோஷம்.`,
  te: (n) => `హాయ్ ${n} — మళ్లీ మాట్లాడడం బాగుంది.`,
  kn: (n) => `ಹಾಯ್ ${n} — ನಿಮ್ಮೊಂದಿಗೆ ಮತ್ತೆ ಮಾತನಾಡಲು ಸಂತೋಷ.`,
  mr: (n) => `हाय ${n} — पुन्हा बोलून आनंद झाला.`,
  gu: (n) => `હાય ${n} — તમારી સાથે ફરી વાત કરીને આનંદ થયો.`,
  bn: (n) => `হাই ${n} — আবার কথা বলে ভালো লাগল।`,
  ml: (n) => `ഹായ് ${n} — വീണ്ടും സംസാരിക്കാൻ സന്തോഷം.`,
};
const VOICE_LINK_ACK_GENERIC: Record<string, string> = {
  en: "Hi — good to hear from you again. I remember we spoke before.",
  hi: "नमस्ते — आपसे फिर बात करके अच्छा लगा। हम पहले भी बात कर चुके हैं।",
  ta: "ஹாய் — மீண்டும் பேசறதுல சந்தோஷம். நம்ம முன்னாடி பேசிருக்கோம்.",
  te: "హాయ్ — మళ్లీ మాట్లాడడం బాగుంది. మనం ఇంతకు ముందు మాట్లాడాం.",
  kn: "ಹಾಯ್ — ನಿಮ್ಮೊಂದಿಗೆ ಮತ್ತೆ ಮಾತನಾಡಲು ಸಂತೋಷ. ನಾವು ಮೊದಲು ಮಾತನಾಡಿದ್ದೇವೆ.",
  mr: "हाय — पुन्हा बोलून आनंद झाला. आपण आधीही बोललो आहोत.",
  gu: "હાય — તમારી સાથે ફરી વાત કરીને આનંદ થયો. આપણે પહેલાં પણ વાત કરી છે.",
  bn: "হাই — আবার কথা বলে ভালো লাগল। আমরা আগেও কথা বলেছি।",
  ml: "ഹായ് — വീണ്ടും സംസാരിക്കാൻ സന്തോഷം. നമ്മൾ മുമ്പും സംസാരിച്ചിട്ടുണ്ട്.",
};
export function voiceLinkAckPhrase(lang?: string | null, name?: string | null): string {
  const prefix = (lang ?? "en").split("-")[0] ?? "en";
  const n = name?.trim();
  if (n) {
    const fn = VOICE_LINK_ACK_NAMED[prefix] ?? VOICE_LINK_ACK_NAMED["en"]!;
    return fn(n);
  }
  return VOICE_LINK_ACK_GENERIC[prefix] ?? VOICE_LINK_ACK_GENERIC["en"]!;
}

// Language-aware "are you there?" check-in — spoken when the per-agent
// silence-hangup timer expires the FIRST time, so the caller gets an audible
// chance to respond before the call is ended (call 1915: silent mid-speech drop).
const INACTIVITY_REPROMPTS: Record<string, string> = {
  en: "Hello, are you still there?",
  hi: "हैलो, क्या आप वहाँ हैं?",
  ta: "ஹலோ, நீங்க இருக்கீங்களா?",
  te: "హలో, మీరు అక్కడ ఉన్నారా?",
  kn: "ಹಲೋ, ನೀವು ಅಲ್ಲಿ ಇದ್ದೀರಾ?",
  mr: "हॅलो, तुम्ही तिथे आहात का?",
  gu: "હેલો, તમે ત્યાં છો?",
  bn: "হ্যালো, আপনি কি আছেন?",
  ml: "ഹലോ, നിങ്ങൾ അവിടെ ഉണ്ടോ?",
};
/** "Are you still there?" check-in for a BCP-47 / language code (falls back to English). */
export function inactivityReprompt(lang?: string | null): string {
  const prefix = (lang ?? "en").split("-")[0] ?? "en";
  return INACTIVITY_REPROMPTS[prefix] ?? INACTIVITY_REPROMPTS["en"]!;
}

/** Softer check-in for video meetings (waiting for other participants is normal). */
export function meetingWaitingReprompt(_lang?: string | null): string {
  return "I'm still here whenever you're ready.";
}

// Language-aware inactivity farewell — spoken before a silence-timeout hangup
// when the agent has no configured inactivityMessage, so the line is never
// dropped silently.
const INACTIVITY_FAREWELLS: Record<string, string> = {
  en: "Since I can't hear you, I'll end the call now. Thank you, goodbye!",
  hi: "मुझे आपकी आवाज़ नहीं आ रही है, इसलिए मैं अब कॉल समाप्त कर रहा हूँ। धन्यवाद, नमस्ते!",
  ta: "உங்க குரல் கேட்கலை, அதனால நான் இப்போ காலை முடிக்கிறேன். நன்றி, வணக்கம்!",
  te: "మీ మాట వినిపించడం లేదు, కాబట్టి నేను ఇప్పుడు కాల్ ముగిస్తున్నాను. ధన్యవాదాలు!",
  kn: "ನಿಮ್ಮ ಧ್ವನಿ ಕೇಳಿಸುತ್ತಿಲ್ಲ, ಹಾಗಾಗಿ ನಾನು ಈಗ ಕರೆ ಮುಗಿಸುತ್ತೇನೆ. ಧನ್ಯವಾದಗಳು!",
  mr: "मला तुमचा आवाज ऐकू येत नाही, म्हणून मी आता कॉल संपवत आहे. धन्यवाद!",
  gu: "મને તમારો અવાજ સંભળાતો નથી, તેથી હું હવે કૉલ સમાપ્ત કરું છું. આભાર!",
  bn: "আপনার কথা শুনতে পাচ্ছি না, তাই আমি এখন কলটি শেষ করছি। ধন্যবাদ!",
  ml: "നിങ്ങളുടെ ശബ്ദം കേൾക്കാനാകുന്നില്ല, അതിനാൽ ഞാൻ ഇപ്പോൾ കോൾ അവസാനിപ്പിക്കുന്നു. നന്ദി!",
};
/** Inactivity farewell for a BCP-47 / language code (falls back to English). */
export function inactivityFarewell(lang?: string | null): string {
  const prefix = (lang ?? "en").split("-")[0] ?? "en";
  return INACTIVITY_FAREWELLS[prefix] ?? INACTIVITY_FAREWELLS["en"]!;
}

export function meetingInactivityFarewell(_lang?: string | null): string {
  return "I'll leave the meeting for now. Feel free to add me again if you need me. Goodbye!";
}

// Language-aware minimal neutral opener — spoken when the greeting-generating
// LLM call fails and the agent has no static greetingMessage to fall back on.
// Keeps the call alive with a safe, generic hello instead of dropping it.
const NEUTRAL_GREETINGS: Record<string, string> = {
  en: "Hello, how can I help you today?",
  hi: "नमस्ते, मैं आपकी कैसे मदद कर सकता हूँ?",
  ta: "வணக்கம், நான் உங்களுக்கு எப்படி உதவ முடியும்?",
  te: "నమస్కారం, నేను మీకు ఎలా సహాయం చేయగలను?",
  kn: "ನಮಸ್ಕಾರ, ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?",
  mr: "नमस्कार, मी तुमची कशी मदत करू शकतो?",
  gu: "નમસ્તે, હું તમારી કેવી રીતે મદદ કરી શકું?",
  bn: "নমস্কার, আমি আপনাকে কীভাবে সাহায্য করতে পারি?",
  ml: "നമസ്കാരം, എനിക്ക് നിങ്ങളെ എങ്ങനെ സഹായിക്കാം?",
};
/** Minimal neutral greeting for a BCP-47 / language code (falls back to English). */
export function neutralGreeting(lang?: string | null): string {
  const prefix = (lang ?? "en").split("-")[0] ?? "en";
  return NEUTRAL_GREETINGS[prefix] ?? NEUTRAL_GREETINGS["en"]!;
}

/**
 * The greeting LLM sometimes answers its own instructions instead of the caller.
 * Call 9153 opened an outbound sales call with "Since no CALL FLOW or GREETING
 * was provided in the prompt, I am unable to start the call. Please provide the
 * script and flow." — spoken aloud to the lead before any pitch.
 *
 * These phrasings never occur in a genuine spoken opener, so matching one means
 * the text must be discarded in favour of a safe fallback. A false positive only
 * costs a generic greeting; a false negative reads internal prompt errors to a
 * customer.
 */
const GREETING_META_REFUSAL: RegExp[] = [
  /\b(?:unable|not able)\s+to\b/i,
  /\bI\s+(?:cannot|can'?t|can\s+not)\s+(?:start|begin|initiate|proceed|continue|generate|provide|create)\b/i,
  // Naming its own configuration rather than speaking to the caller.
  /\bcall\s*flow\b/i,
  /\bsystem\s*prompt\b/i,
  /\bin\s+the\s+prompt\b/i,
  /\bno\s+(?:greeting|script|instructions?)\b[^.]{0,30}\b(?:provided|given|specified|found)\b/i,
  /\bplease\s+provide\b[^.]{0,40}\b(?:script|flow|prompt|greeting|instructions?)\b/i,
  /\bas\s+an\s+AI\b/i,
];

/** True when greeting-LLM output is meta/refusal text that must never be spoken. */
export function isMetaRefusalGreeting(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return GREETING_META_REFUSAL.some(re => re.test(t));
}

/**
 * Operator typed Welcome (even "Hello!"). Outbound must speak only that and
 * wait — Talk/CALL FLOW is for later turns, not a second spoken greeting.
 * Empty Welcome still needs the greeting LLM. Memory-seeded Indic start
 * language must not discard an English Welcome (Railway 07:41 / call 17618).
 */
export function outboundTypedWelcomeBlocksGreetingLlm(
  typedWelcome: string,
  _greetLang?: string,
): boolean {
  const t = typedWelcome.trim();
  if (!t) return false;
  // Call 26692: Welcome "Hello" was treated as the complete outbound opener,
  // then CALL FLOW dumped on the caller's "Hi". A stub is not a finished
  // greeting — still run the compact greeting LLM. A real typed Welcome
  // (identity + ask) still blocks a second opener (call 17455).
  if (isStubGreeting(t)) return false;
  return true;
}

/** True when the static Welcome is a one-word stub that cannot be the whole outbound opener. */
export function isStubGreeting(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (t.length < 12) return true;
  return /^(hi|hello|hey|hi there|hello there)[!.,\s]*$/i.test(t);
}

/**
 * Speak the operator-typed Welcome first, then the generated opener.
 * Outbound used to discard "Hello" so CALL FLOW could play — callers never
 * heard the Welcome field. Keep the pitch; put Welcome in front unless the
 * opener already starts with the same greeting.
 */
export function joinWelcomeAndOpener(welcome: string, opener: string): string {
  const w = welcome.trim();
  const o = opener.trim();
  if (!w) return o;
  if (!o) return w;
  const oLead = o.replace(/^[\s"'“”‘’]+/, "");
  const wBare = w.replace(/[!.,?…।॥\s]+$/g, "");
  if (!wBare) return o;
  if (oLead.toLowerCase().startsWith(wBare.toLowerCase())) return o;
  if (
    isStubGreeting(w) &&
    /^(hi|hello|hey|hi there|hello there|வணக்கம்|नमस्ते|नमस्कार)\b/i.test(oLead)
  ) {
    return o;
  }
  const glue = /[.!?…।]$/.test(w) ? " " : ". ";
  return `${w}${glue}${o}`;
}

const OPENING_GREETING_WORD =
  /^(hi|hello|hey|hi there|hello there|வணக்கம்|नमस्ते|नमस्कार)\b[!,.?\s]*/i;

/**
 * After Welcome was already spoken, drop a duplicated Hello/Hi from the LLM opener
 * so the caller does not hear "Hello. Hello, this is…".
 */
export function stripWelcomePrefix(welcome: string, opener: string): string {
  const w = welcome.trim();
  const o = opener.trim();
  if (!w || !o) return o;
  const wBare = w.replace(/[!.,?…।॥\s]+$/g, "");
  const oLead = o.replace(/^[\s"'“”‘’]+/, "");
  if (wBare && oLead.toLowerCase().startsWith(wBare.toLowerCase())) {
    return oLead.slice(wBare.length).replace(/^[\s,!.?…।:-]+/, "").trim() || o;
  }
  if (isStubGreeting(w) && OPENING_GREETING_WORD.test(oLead)) {
    return oLead.replace(OPENING_GREETING_WORD, "").trim() || o;
  }
  return o;
}

/**
 * Instant returning-caller opener — no LLM round-trip.
 * Memory name + opening language only. What to ask next is the agent prompt.
 */
export function buildInstantReturningGreeting(
  name?: string | null,
  lang?: string | null,
): string {
  const greet = openingHello(lang);
  const n = (name ?? "").trim().replace(/\s+/g, " ") || null;
  return n ? `${greet} ${n}.` : `${greet}.`;
}


export interface TurnSafetyNetOpts {
  forceFinalizeMs?: number;
  stallBackstopMs?: number;
  maxReprompts?: number;
  /** Force-close the current turn using the best partial, treated as a real final. */
  onForceFinalize: (transcript: string) => void;
  /** No usable transcript before the backstop expired — speak a reprompt & re-listen. */
  onStallReprompt: () => void;
  /** Reprompts exhausted — end the call via the existing inactivity path. */
  onStallGiveUp: () => void;
}

/**
 * Two-timer turn safety net, shared by pipeline.ts (telephony) and webcall.ts
 * (browser WS) so both paths behave identically.
 *
 *  • FORCE-FINALIZE (tight): armed on the first non-empty partial, reset on each
 *    subsequent partial. If it expires with a non-empty best-partial, the turn is
 *    force-closed using that text. Empty best-partial → no-op (stall handles it).
 *  • STALL BACKSTOP (loose): armed when we enter "Listening…" (beginListening()),
 *    cleared by a real final (onFinal()) or a successful force-finalize. If it
 *    expires with nothing usable, fire a recovery reprompt; after maxReprompts,
 *    give up and end the call.
 *
 * Callers MUST invoke beginListening() on entering listening, onPartial() per
 * interim, onFinal() on a real final, and clear() on barge-in / teardown.
 */
export class TurnSafetyNet {
  private forceTimer: ReturnType<typeof setTimeout> | null = null;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  private bestPartial = "";
  private repromptCount = 0;
  private readonly forceMs: number;
  private readonly stallMs: number;
  private readonly maxReprompts: number;

  constructor(private readonly opts: TurnSafetyNetOpts) {
    this.forceMs = opts.forceFinalizeMs ?? FORCE_FINALIZE_MS;
    this.stallMs = opts.stallBackstopMs ?? STALL_BACKSTOP_MS;
    this.maxReprompts = opts.maxReprompts ?? STALL_MAX_REPROMPTS;
  }

  /** Enter "Listening…" — (re)arm the stall backstop. Idempotent per turn. */
  beginListening(): void {
    this.clearTimers();
    this.bestPartial = "";
    if (this.stallMs > 0) {
      this.stallTimer = setTimeout(() => this.onStallExpire(), this.stallMs);
    }
  }

  /**
   * VAD / speech-energy pulse while listening — push the stall backstop without
   * arming force-finalize. Sarvam often lags interims; without this, call-2626
   * fired “can't hear” while the caller was already speaking.
   */
  onActivityPulse(): void {
    this.repromptCount = 0;
    if (this.stallMs <= 0) return;
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = setTimeout(() => this.onStallExpire(), this.stallMs);
  }

  /** Non-empty interim arrived — track best partial and (re)arm the tight timer. */
  onPartial(text: string): void {
    const t = text.trim();
    if (!t) return;
    this.bestPartial = t;
    if (this.forceMs > 0) {
      if (this.forceTimer) clearTimeout(this.forceTimer);
      this.forceTimer = setTimeout(() => this.onForceExpire(), this.forceMs);
    }
    // A streaming partial means the caller is ACTIVELY speaking — they are not
    // silent. Push the stall backstop forward and reset the accumulated reprompt
    // count so the give-up path can only ever fire on genuine sustained silence,
    // never while a (slow-to-finalize) caller is still talking. Without this, a
    // caller whose STT streams partials but is slow/never emits a final would be
    // treated as silent: reprompts accumulate and the net ends a live call.
    this.onActivityPulse();
  }

  /** Real STT final (or otherwise-usable speech) — clear timers, reset reprompts. */
  onFinal(): void {
    this.clearTimers();
    this.bestPartial = "";
    this.repromptCount = 0;
  }

  /** Barge-in / teardown — clear timers without firing anything. */
  clear(): void {
    this.clearTimers();
    this.bestPartial = "";
    this.repromptCount = 0;
  }

  private onForceExpire(): void {
    this.forceTimer = null;
    const best = this.bestPartial.trim();
    if (!best) return; // empty → let the stall backstop handle it
    this.clearTimers();
    this.bestPartial = "";
    this.repromptCount = 0;
    this.opts.onForceFinalize(best);
  }

  private onStallExpire(): void {
    this.stallTimer = null;
    this.clearTimers();
    this.bestPartial = "";
    if (this.repromptCount >= this.maxReprompts) {
      this.opts.onStallGiveUp();
    } else {
      this.repromptCount++;
      this.opts.onStallReprompt();
    }
  }

  private clearTimers(): void {
    if (this.forceTimer) {
      clearTimeout(this.forceTimer);
      this.forceTimer = null;
    }
    if (this.stallTimer) {
      clearTimeout(this.stallTimer);
      this.stallTimer = null;
    }
  }
}

// ── Affirmation / clearly-complete single words ───────────────────────────────
// Exported so other modules (e.g. the pipeline's self-echo guard) can exempt
// these common short replies from logic that would otherwise misfire on them.
export const AFFIRMATIONS = new Set([
  "yes",
  "no",
  "yeah",
  "nope",
  "yep",
  "yup",
  "sure",
  "ok",
  "okay",
  "correct",
  "right",
  "true",
  "false",
  "done",
  "bye",
  "goodbye",
  "thanks",
  "thank",
  "fine",
  "good",
  "great",
  "perfect",
  "proceed",
  "confirm",
  "confirmed",
  "agreed",
  "understood",
  "hello",
  "hi",
  "hey",
  "alright",
  "alrighty",
  "roger",
  "absolutely",
  "definitely",
  "certainly",
  "negative",
  "affirmative",
  "stop",
  "cancel",
  "continue",
  "ready",
  "received",
  "noted",
  // ── Indic native-script affirmations ──────────────────────────────────────
  // Tamil
  "ஆம்", "ஆமா", "சரி", "இல்ல", "இல்லை", "ஓகே", "நன்றி", "வணக்கம்",
  // Hindi
  "हां", "हाँ", "जी", "जी हां", "नहीं", "ठीक", "ठीक है", "अच्छा", "धन्यवाद",
  // Telugu
  "నమస్తే", "అవును", "కాదు", "సరే",
  // Kannada
  "ಹೌದು", "ಇಲ್ಲ", "ಸರಿ",
  // Bengali
  "হ্যাঁ", "না", "ঠিক আছে",
  // Malayalam
  "അതെ", "ഇല്ല", "ശരി", "നന്ദി",
  // Gujarati
  "હા", "ના", "સારું",
  // Marathi
  "हो", "नाही", "बरं", "ठीक आहे",
  // Punjabi
  "ਹਾਂ", "ਨਹੀਂ", "ਠੀਕ ਹੈ",
  // Odia
  "ହଁ", "ନାହିଁ", "ଠିକ ଅଛି",
  // ── Romanized Indic affirmations / backchannels ────────────────────────────
  "haan", "han", "ji", "nahi", "nahin", "theek", "accha", "acha",
  "aama", "aam", "illa", "illai", "seri", "sari", "avunu", "kadhu",
  "sare", "houdu", "howdu", "ho", "nako", "ha", "shari",
]);

/** Honorifics often glued to short yes/no replies ("yes ma'am", "okay sir"). */
const SHORT_REPLY_HONORIFICS = new Set([
  "madam", "maam", "ma'am", "sir", "miss", "mam", "ji",
]);

/**
 * True when every token is an affirmation/backchannel (or honorific). Used to
 * keep "okay okay", "yes madam", "haan ji" from being discarded as self-echo
 * of the agent saying "okay?" at the end of a question.
 */
export function isAffirmationOnlyUtterance(tokens: string[]): boolean {
  if (tokens.length === 0 || tokens.length > 4) return false;
  return tokens.every((t) => AFFIRMATIONS.has(t) || SHORT_REPLY_HONORIFICS.has(t));
}

/**
 * Adaptive silence window before treating the caller turn as complete.
 *
 * Situations (Indian PSTN):
 *   closed yes/ஆம்       350–500 ms
 *   normal complete      550–750 ms
 *   incomplete sentence  900–1200 ms
 *   numbers/email        1200–1500 ms
 *   no STT partial       700–900 ms
 */
export function computeEndpointMs(opts: {
  /** Last agent utterance text — used to detect digit-collection context. */
  lastAgentText: string;
  /**
   * Partial transcript from streaming STT, if any.
   * Pass empty string when unavailable (batch STT path).
   */
  partialTranscript: string;
  /** Approximate speech duration in ms derived from accumulated audio bytes. */
  audioBufferMs: number;
  /** Agent-configured base silence window (user override). */
  baseSilenceMs: number;
}): EndpointDecision {
  const base = Number.isFinite(opts.baseSilenceMs) && opts.baseSilenceMs > 0
    ? opts.baseSilenceMs
    : ENDPOINT_DEFAULT_MS;
  const collection = resolveCollectionKind(opts.lastAgentText);
  if (collection === "email" || collection === "digit") {
    return { ms: Math.min(1500, Math.max(1200, base)), reason: "collection" };
  }

  const partial = opts.partialTranscript.trim();
  if (!partial) {
    return { ms: Math.min(900, Math.max(700, base || 800)), reason: "no_partial" };
  }

  const tokens = partial.toLowerCase().split(/\s+/).filter(Boolean);
  if (isAffirmationOnlyUtterance(tokens)) {
    // Closed-answer mode only — not for normal speech.
    return { ms: Math.min(500, Math.max(350, base || 400)), reason: "short_answer" };
  }

  if (
    endsWithDanglingConnector(partial)
    || signalsConversationalContinuationFromEndpointing(partial)
  ) {
    return { ms: Math.min(1200, Math.max(900, base || 1000)), reason: "incomplete" };
  }

  if (/[.?!।]\s*$/u.test(partial)) {
    return { ms: Math.min(750, Math.max(550, base || 600)), reason: "complete" };
  }

  // Mid-utterance without a clear dangling token — provisional hold.
  if (opts.audioBufferMs > 0 && opts.audioBufferMs < 400) {
    return { ms: Math.min(900, Math.max(700, base || 800)), reason: "short_burst" };
  }

  // Normal complete / default speech — not the short-answer floor.
  return { ms: Math.min(750, Math.max(550, base || 600)), reason: "default" };
}

/** Local dangling check used by computeEndpointMs (avoid circular import on transcriptQuality). */
function signalsConversationalContinuationFromEndpointing(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/[…]|\.{2,}\s*$/.test(t)) return true;
  if (/\b(and|but|because|actually|so|then)\s*[,.…]*\s*$/i.test(t)) return true;
  if (/(எனக்கு|வந்து|ஆனா|ஆனால்|அதனால|அதனால்|இன்னும்)\s*[,.…]*\s*$/u.test(t)) return true;
  return false;
}

// ── Silence-hangup watchdog (call 1915) ──────────────────────────────────────
//
// Replaces the raw per-agent silence-hangup setTimeout in the pipeline. The old
// timer was only reset by STT partials/finals (streaming path) or raw speech
// energy (batch path) — when a streaming STT session went quiet mid-speech the
// timer fired and dropped the call while the caller was audibly talking.
//
// The watchdog:
//  - is re-armed in full by `reset()` (usable transcripts / turn boundaries);
//  - records raw caller speech energy via `onSpeechEnergy()` WITHOUT timer
//    churn — expiry checks the timestamp and re-arms the remainder instead of
//    firing, so per-20ms-frame calls are cheap;
//  - treats "agent busy" (speaking / synthesizing / thinking) as activity;
//  - on a legitimate expiry speaks an in-language "are you there?" check-in
//    first (`onReprompt`, up to `maxReprompts` times) and only gives up
//    (`onGiveUp`) if the caller stays silent for a further full window.
//
// Lives in endpointing.ts (not pipeline.ts) so it is unit-testable and shared
// by both the telephony and webcall paths through the common pipeline core.
export interface SilenceWatchdogOptions {
  /** Full silence window in ms (agent.silenceTimeoutSeconds * 1000). */
  timeoutMs: number;
  /** "Are you there?" check-ins before giving up (default 1). */
  maxReprompts?: number;
  /** Agent is speaking/synthesizing/processing — treat as activity, re-arm full. */
  isBusy?: () => boolean;
  /** Speak the in-language check-in. Watchdog has already re-armed a full window. */
  onReprompt: () => void;
  /** Caller stayed silent through all check-ins — end the call. */
  onGiveUp: () => void;
  /**
   * Diagnostic hook fired every time the timer expires and is re-armed WITHOUT
   * a reprompt/give-up (i.e. a "near-miss" — the caller/agent was active enough
   * to avoid the hangup path). Lets the pipeline log whether energy/partials
   * were seen in the trailing window so a false hangup elsewhere is
   * diagnosable directly from call logs instead of requiring code spelunking.
   */
  onNearMiss?: (info: {
    cause: "busy" | "recent_speech_energy";
    msSinceLastSpeech: number | null;
    rearmedForMs: number;
  }) => void;
  /** Clock override for tests. */
  now?: () => number;
}

export class SilenceWatchdog {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSpeechAt = 0;
  private repromptCount = 0;
  /** Consecutive busy near-misses with no recent caller speech — stuck agent flags. */
  private consecutiveBusyNearMisses = 0;
  private readonly maxReprompts: number;
  private readonly now: () => number;

  constructor(private readonly opts: SilenceWatchdogOptions) {
    this.maxReprompts = opts.maxReprompts ?? 1;
    this.now = opts.now ?? Date.now;
  }

  /** Full re-arm: usable transcript arrived / turn boundary. Clears check-in count. */
  reset(): void {
    this.repromptCount = 0;
    this.consecutiveBusyNearMisses = 0;
    this.arm(this.opts.timeoutMs);
  }

  /**
   * Raw caller speech energy observed (VAD-gated frame). Cheap — records a
   * timestamp and clears the check-in count; the running timer is left alone
   * and expiry re-arms the remainder instead of firing.
   */
  onSpeechEnergy(): void {
    this.lastSpeechAt = this.now();
    this.repromptCount = 0;
    this.consecutiveBusyNearMisses = 0;
  }

  clear(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private arm(ms: number): void {
    this.clear();
    this.timer = setTimeout(() => this.onExpired(), Math.max(250, ms));
  }

  private onExpired(): void {
    this.timer = null;
    const { timeoutMs } = this.opts;
    // Agent is mid-speech / mid-turn — not caller abandonment. Re-arm in full.
    // Escape hatch: if isBusy stays true for many windows with no caller speech
    // (stuck isPlaying/isProcessing), force hangup instead of riding to maxDuration
    // and over-billing idle keepalive time.
    if (this.opts.isBusy?.()) {
      const sinceSpeech = this.lastSpeechAt > 0 ? this.now() - this.lastSpeechAt : null;
      const stuckBusy =
        this.consecutiveBusyNearMisses >= 6 &&
        (sinceSpeech == null || sinceSpeech >= timeoutMs * 2);
      if (stuckBusy) {
        this.opts.onNearMiss?.({
          cause: "busy",
          msSinceLastSpeech: sinceSpeech,
          rearmedForMs: 0,
        });
        this.opts.onGiveUp();
        return;
      }
      this.consecutiveBusyNearMisses++;
      this.opts.onNearMiss?.({
        cause: "busy",
        msSinceLastSpeech: sinceSpeech,
        rearmedForMs: timeoutMs,
      });
      this.arm(timeoutMs);
      return;
    }
    this.consecutiveBusyNearMisses = 0;
    // Caller was audibly speaking within the window (streaming STT may have
    // gone quiet without partials) — re-arm for the remaining share.
    const sinceSpeech = this.now() - this.lastSpeechAt;
    if (this.lastSpeechAt > 0 && sinceSpeech < timeoutMs) {
      const rearmedForMs = timeoutMs - sinceSpeech;
      this.opts.onNearMiss?.({
        cause: "recent_speech_energy",
        msSinceLastSpeech: sinceSpeech,
        rearmedForMs,
      });
      this.arm(rearmedForMs);
      return;
    }
    // Legitimate silence. Check in audibly before giving up.
    if (this.repromptCount < this.maxReprompts) {
      this.repromptCount++;
      this.arm(timeoutMs);
      this.opts.onReprompt();
      return;
    }
    this.opts.onGiveUp();
  }
}
