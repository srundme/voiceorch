/**
 * Detect an explicit caller request to switch the agent's spoken language.
 * Returns a BCP-47 code ("ta-IN", "en-IN", …) or null. Covers the full
 * multilingual set (en/hi/ta/te/kn/ml/mr/bn/gu/pa/or/ur) in romanised and
 * native scripts. Deliberately conservative — a real request/switch cue must
 * be present, so a bare mention ("English teacher", "do you support Hindi?",
 * "I don't know English") never latches. Simple negation ("don't speak
 * English", "English mat bolo", "தமிழ் வேண்டாம்") is stripped; on a true
 * Hindi/English two-language tie Hindi wins as the safer base-language
 * fallback UNLESS the locative is attached to English ("इंग्लिश में बात करो");
 * any other multi-language mention is ambiguous and never latches.
 */

interface LangRequestSpec {
  code: string;
  mention: RegExp;
  roman: string[];
  /** Precompiled: "in/into/to <lang>" or "<lang> me|mein|la|il|alli…" (romanised). */
  inLang: RegExp;
  /** Precompiled: romanised/English negation windows around the language name. */
  negation: RegExp[];
}

function buildLangRequestSpec(code: string, mention: RegExp, roman: string[]): LangRequestSpec {
  const alt = roman.join("|");
  return {
    code,
    mention,
    roman,
    inLang: new RegExp(
      `\\b(in|into|to)\\s+(${alt})\\b|\\b(${alt})\\s*(me|mein|mai|main|men|la|le|lo|il|alli|nalli)\\b`,
    ),
    negation: [
      new RegExp(`\\b(no|not|don'?t|do not|dont|never|stop)\\b[^.!?]{0,20}\\b(${alt})\\b`),
      new RegExp(`\\b(${alt})\\b[^.!?]{0,15}\\b(nahi|nahin|mat|naa|na|venda|vendam|veno|beda|nako|illa|illai)\\b`),
    ],
  };
}

/** Devanagari/Gujarati spellings Sarvam emits for "English" (call 11062: इंग्लिश). */
const EN_NATIVE_NAMES = "अंग्रेज़ी|अंग्रेजी|इंग्लिश|इंग्लिष|इंगलिश|इंगरेजी|इन्ग्लिश|ઇંગ્લિશ|અંગ્રેજી";

/** All languages the multilingual toggle supports for explicit switch requests. */
const LANG_REQUEST_SPECS: LangRequestSpec[] = [
  buildLangRequestSpec("en-IN", new RegExp(`\\b(english|inglish)\\b|\\bangre[jz]i\\b|${EN_NATIVE_NAMES}|ஆங்கில|இங்கிலீ?ஷ்?|இங்கிலிஷ்?|இங்கில|ఇంగ్లీష|ইংরেজি|انگریزی`, "iu"), ["english", "inglish", "angrezi", "angreji"]),
  buildLangRequestSpec("hi-IN", /\bhindi\b|हिन्दी|हिंदी|ஹிந்தி|இந்தி|ہندی/iu, ["hindi"]),
  buildLangRequestSpec("ta-IN", /\b(tamil|thamizh|tamizh)\b|தமிழ|तमिल|తమిళ/iu, ["tamil", "thamizh", "tamizh"]),
  buildLangRequestSpec("te-IN", /\btelugu\b|తెలుగు|तेलुगु|தெலுங்கு/iu, ["telugu"]),
  buildLangRequestSpec("kn-IN", /\bkannada\b|ಕನ್ನಡ|कन्नड़|कन्नड|கன்னட/iu, ["kannada"]),
  buildLangRequestSpec("ml-IN", /\bmalayalam\b|മലയാള|मलयालम|மலையாள/iu, ["malayalam"]),
  buildLangRequestSpec("mr-IN", /\bmarathi\b|मराठी|மராத்தி/iu, ["marathi"]),
  buildLangRequestSpec("bn-IN", /\b(bengali|bangla)\b|বাংলা|बांग्ला|बंगाली/iu, ["bengali", "bangla"]),
  buildLangRequestSpec("gu-IN", /\b(gujarati|gujrati)\b|ગુજરાતી|गुजराती/iu, ["gujarati", "gujrati"]),
  buildLangRequestSpec("pa-IN", /\b(punjabi|panjabi)\b|ਪੰਜਾਬੀ|पंजाबी|پنجابی/iu, ["punjabi", "panjabi"]),
  buildLangRequestSpec("or-IN", /\b(odia|oriya)\b|ଓଡ଼ିଆ|ଓଡିଆ|ओड़िया|उड़िया/iu, ["odia", "oriya"]),
  buildLangRequestSpec("ur-IN", /\burdu\b|اردو|उर्दू|உருது/iu, ["urdu"]),
];

/** Native-script negators checked in the ~18 chars right after a native-script
 *  language mention ("தமிழ் வேண்டாம்", "हिंदी नहीं"). */
const NATIVE_NEGATORS = /வேண்டாம்|வேணாம்|மாட்|नहीं|मत|না|নয়|ਨਹੀਂ|نہیں|ಬೇಡ|వద్దు|വേണ്ട|નહીં/u;

export function detectExplicitLanguageRequest(rawText: string): string | null {
  // "Tamil Nadu" is a place, not a language request ("I live in Tamil Nadu"
  // must never latch Tamil). Scrub the state name before any matching.
  const text = rawText.replace(/tamil\s*nadu/gi, "TN").replace(/தமிழ்\s*நாடு|தமிழ்நாட்|तमिलनाडु/gu, "TN");
  const t = text.toLowerCase();

  const mentioned = LANG_REQUEST_SPECS.filter((s) => s.mention.test(text));
  if (mentioned.length === 0) return null;

  // Require an actual request/switch cue so a BARE mention never latches.
  // Cues: a request/switch verb (English, romanised Hindi/Tamil/Telugu/Kannada/
  // Malayalam, or native-script), "in/to <lang>", or "<lang> me/mein/la/il…".
  const hasRequestVerb =
    /\b(speak|speaking|talk|talking|say|reply|respond|answer|continue|switch|change|use|prefer|please)\b/.test(t) ||
    /\bcan\s+you\b/.test(t) ||
    /\b(pesu|pesunga|pesanum|pannunga|pannalam|matladu|maatladu|matladandi|helu|heli|parayu|samsarikku|bolna|bola)\b/.test(t) ||
    /\b(bol|bolo|boliye|baat|baatein|kar|karo|karein|kijiye|kije|chahiye|chaiye)\b/.test(t) ||
    /स्पीक|स्पिक|टॉक|பேச|பேசு|சொல்லு|बोल|बात|कीजिए|करो|करें|चाहिए|మాట్లాడ|ಮಾತನಾಡ|പറയ|സംസാരിക്ക|বল|বলুন|કહો|બોલ|ਬੋਲ|بولیں|بات/u.test(text);
  const hasInLang =
    mentioned.some((s) => s.inLang.test(t)) ||
    // Native-script locatives: "<lang>में/इन" (Devanagari), "தமிழில்/தமிழ்ல", "…த்தில்/யில்" etc.
    new RegExp(`(${EN_NATIVE_NAMES}|हिन्दी|हिंदी|तमिल|तेलुगु|कन्नड़|कन्नड|मलयालम|मराठी|बांग्ला|बंगाली|गुजराती|पंजाबी|उड़िया|ओड़िया|उर्दू)\\s*(में|मे|इन|इन्)`, "u").test(text) ||
    new RegExp(`(स्पीक|स्पिक|टॉक|बोल|बोलो)\\s*(इन|इन्|में|मे)\\s*(${EN_NATIVE_NAMES}|हिन्दी|हिंदी|तमिल|तेलुगु|कन्नड़|कन्नड|मलयालम)`, "u").test(text) ||
    /தமிழ(ில்|்ல|ுல)|ஆங்கிலத்தில்|ஹிந்தியில்|இந்தியில்|தெலுங்கில்|கன்னடத்தில்|மலையாளத்தில்|উর্দু|ਵਿੱਚ/u.test(text);
  const englishLocative =
    new RegExp(`(${EN_NATIVE_NAMES})\\s*(में|मे|इन|इन्)`, "u").test(text) ||
    /\b(in|into|to)\s+(english|inglish|angrezi|angreji)\b/.test(t) ||
    /\b(english|inglish|angrezi|angreji)\s*(me|mein|mai|main|men)\b/.test(t);
  if (!hasRequestVerb && !hasInLang) {
    // Indian conversational speech drops the request verb: "Ma'am Tamil" means
    // "Ma'am, speak Tamil". If the ENTIRE non-address content of a SHORT (≤5
    // word) utterance is exactly one language name and there is no negation
    // present, treat it as an explicit language request.
    const isNegatedBare =
      /\b(no|not|dont|don'?t|never|nahi|nahin|illa|illai|vendam|venda|mat)\b/.test(t) ||
      /नहीं|मत|வேண்டாம்|வேணாம்|নয়|ਨਹੀਂ|نہیں|ಬೇಡ|వద్దు|വേണ്ട|નહીં/u.test(text);
    if (!isNegatedBare && mentioned.length === 1) {
      const ADDR_LATIN = new Set([
        "maam", "madam", "sir", "please", "hi", "hello", "ok", "okay",
        "uh", "um", "hmm", "hm", "bhai", "didi", "anna", "akka", "hey",
        "yeah", "yea", "yes", "can", "you",
      ]);
      const ADDR_NATIVE = new Set([
        "मैडम", "मैम", "सर", "साहब", "जी", "भाई", "दीदी", "आप",
        "हाँ", "हां", "हेलो", "नमस्ते", "नमस्कार",
      ]);
      const stripPunct = (w: string) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      const allWords = t.split(/\s+/).map(stripPunct).filter((w) => /\p{L}/u.test(w));
      const isAddr = (w: string) => {
        const latin = w.replace(/[^a-z]/g, "");
        if (latin && ADDR_LATIN.has(latin)) return true;
        return ADDR_NATIVE.has(w);
      };
      const contentWords = allWords.filter((w) => !isAddr(w));
      if (allWords.length <= 5 && contentWords.length === 1) {
        const soleWord = contentWords[0]!;
        const spec = mentioned[0]!;
        if (spec.mention.test(soleWord)) {
          return spec.code;
        }
      }
    }
    return null;
  }

  // Negation guard per language: "don't speak English" / "English mat bolo" /
  // "தமிழ் வேண்டாம்" must not latch that language (but leaves any OTHER
  // positively-requested language free to latch: "Hindi nahi, Tamil me bolo").
  const wanted = mentioned.filter((s) => {
    if (s.negation.some((re) => re.test(t))) return false;
    const m = s.mention.exec(text);
    if (m) {
      const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 18);
      if (NATIVE_NEGATORS.test(tail)) return false;
    }
    return true;
  });

  if (wanted.length === 1) return wanted[0]!.code;
  // Hindi/English tie: locative on English ("इंग्लिश में", "in English") wins
  // English. Otherwise Hindi stays the safer base-language fallback.
  if (wanted.length === 2) {
    const codes = new Set(wanted.map((w) => w.code));
    if (codes.has("hi-IN") && codes.has("en-IN")) {
      return englishLocative ? "en-IN" : "hi-IN";
    }
  }
  return null;
}

const LOCK_LANG_NAMES: Record<string, string> = {
  "en-IN": "English", "en-US": "English", "hi-IN": "Hindi", "ta-IN": "Tamil",
  "te-IN": "Telugu", "kn-IN": "Kannada", "ml-IN": "Malayalam", "mr-IN": "Marathi",
  "bn-IN": "Bengali", "gu-IN": "Gujarati", "pa-IN": "Punjabi", "or-IN": "Odia",
  "ur-IN": "Urdu",
};

/**
 * Per-turn reminder of the latched caller language. Must ride on the last user
 * turn: Sarvam-105b ignores system-prompt rules once a Hinglish-heavy script
 * pulls it back (call 42570: agreed to English 4 times, reverted every turn).
 */
export function buildLanguageLockNote(
  lang: string | null | undefined,
  explicit = true,
): string {
  if (!lang) return "";
  const name = LOCK_LANG_NAMES[lang];
  if (!name) return "";
  if (!explicit) {
    const notHinglish = name === "English" ? " — plain English, not Hindi/Hinglish" : "";
    return (
      `[LANGUAGE] The caller is speaking ${name}. Reply in ${name}${notHinglish}. ` +
      `If the caller clearly switches language, follow them.`
    );
  }
  if (name === "English") {
    return (
      `[LANGUAGE LOCK: ENGLISH] Reply ONLY in plain English. No Hindi or Hinglish words at all — ` +
      `not "aap", "hai", "hain", "na", "toh", "bataiye", "kitna", "pe", "kar loon", "bhej doon", "achha", "ji". ` +
      `Ignore Hindi/Hinglish examples in your script; say the same thing in English. ` +
      `Do not mention the language or say "we can continue in English" again. ` +
      `Stay in English until the caller explicitly asks for another language.`
    );
  }
  return (
    `[LANGUAGE LOCK: ${name.toUpperCase()}] Reply ONLY in ${name}. Keep using ${name} even if the caller ` +
    `uses a few English words. Do not mention the language again. ` +
    `Stay in ${name} until the caller explicitly asks for another language.`
  );
}
