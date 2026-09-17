/**
 * Spoken hold lines while a tool runs (or while the LLM is still emitting
 * a forced booking tool — call 17706 sat silent 23s after only "Mm-hmm").
 */

      const GENERIC_TOOL_FILLERS: Record<string, string> = {
        en: "One moment…", hi: "एक क्षण…", ta: "ஒரு நிமிடம்…",
        te: "ఒక్క నిమిషం…", kn: "ಒಂದು ಕ್ಷಣ…", mr: "एक क्षण…",
        gu: "એક ક્ષણ…", bn: "একটু অপেক্ষা করুন…", ml: "ഒരു നിമിഷം…",
        es: "Un momento…", fr: "Un instant…", de: "Einen Moment…", ar: "لحظة…",
      };
      const TOOL_FILLERS_BY_NAME: Record<string, Record<string, string>> = {
        native_check_availability: {
          en: "Let me check the available slots real quick…",
          ta: "இருங்க, ஃப்ரீயா இருக்குற ஸ்லாட்ஸ் செக் பண்ணி பாக்குறேன்…",
          hi: "एक मिनट, मैं स्लॉट्स चेक करके बताता हूँ…",
          te: "ఒక్క నిమిషం, అవైలబుల్ స్లాట్స్ చెక్ చేస్తున్నాను…",
          kn: "ಲಭ್ಯವಿರುವ ಸಮಯವನ್ನು ಪರಿಶೀಲಿಸುತ್ತಿದ್ದೇನೆ…",
        },
        native_booking: {
          en: "Great, booking that in for you right now…",
          ta: "சரிங்க, உங்க அப்பாயிண்ட்மென்ட் புக் பண்ணிடுறேன்…",
          hi: "बस आपका अपॉइंटमेंट बुक कर रहा हूँ…",
          te: "సరేనండి, మీ అపాయింట్‌మెంట్ బుక్ చేస్తున్నాను…",
          kn: "ನಿಮ್ಮ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬುಕ್ ಮಾಡುತ್ತಿದ್ದೇನೆ…",
        },
        native_reschedule: {
          en: "Got it, updating your appointment time now…",
          ta: "ஒரு நிமிஷம், டைம் மாத்தி புக் பண்ணிடுறேன்…",
          hi: "एक मिनट, अपॉइंटमेंट की टाइमिंग चेंज कर देता हूँ…",
          te: "మీ అపాయింట్‌మెంట్‌ను రీషెడ్యూల్ చేస్తున్నాను…",
        },
        native_cancel: {
          en: "Sure thing, cancelling that booking for you…",
          ta: "சரிங்க, அந்த அப்பாயிண்ட்மென்ட் கேன்சல் பண்ணிடுறேன்…",
          hi: "जी, वो अपॉइंटमेंट कैंसिल कर देता हूँ…",
          te: "మీ అపాయింట్‌మెంట్‌ను రద్దు చేస్తున్నాను…",
        },
        native_list_bookings: {
          en: "Let me pull up your upcoming bookings real quick…",
          ta: "ஒரு நிமிஷம், உங்க புக் பண்ணுன ஸ்லாட்ஸ் பாக்குறேன்…",
          hi: "एक मिनट, आपकी बुकिंग्स चेक कर लेता हूँ…",
        },
      };

const TOOL_FILLER_ALIAS: Record<string, string> = {
  book_appointment: "native_booking",
  check_availability: "native_check_availability",
  reschedule_booking: "native_reschedule",
  cancel_booking: "native_cancel",
  list_bookings: "native_list_bookings",
};

const INSTANT_TOOL_FILLER_SKIP = new Set([
  "end_call",
  "transfer_agent",
  "next_slide",
  "previous_slide",
  "goto_slide",
  "schedule_callback",
  "mute_meeting",
  "unmute_meeting",
  "leave_meeting",
  // Intake writes finish in ~10ms. Speaking "One moment…" on every save is
  // the stall the recruiter prompt already forbids.
  "save_candidate_details",
  "set_disposition",
  "finish_intake",
]);

/** Form writes that must not block the spoken reply (call 25223). */
export const BACKGROUND_INTAKE_TOOLS = new Set([
  "save_candidate_details",
  "set_disposition",
]);

export function isBackgroundIntakeTool(name: string): boolean {
  return BACKGROUND_INTAKE_TOOLS.has(name);
}

export function withoutBackgroundIntakeTools<T extends { name: string }>(tools: T[]): T[] {
  return tools.filter((t) => !BACKGROUND_INTAKE_TOOLS.has(t.name));
}

/** Speak-turn tools. finish_intake stays off until screening can actually close. */
export function intakeSpokenTools<T extends { name: string }>(
  tools: T[],
  opts: { screeningComplete: boolean },
): T[] {
  const spoken = withoutBackgroundIntakeTools(tools);
  if (opts.screeningComplete) return spoken;
  return spoken.filter((t) => t.name !== "finish_intake");
}

export function languagePrefix(language: string | null | undefined): string {
  return (language ?? "en").split("-")[0] || "en";
}

export function resolveToolFillerPhrase(
  toolName: string,
  language: string | null | undefined,
): string | undefined {
  if (INSTANT_TOOL_FILLER_SKIP.has(toolName)) return undefined;
  const canonical = TOOL_FILLER_ALIAS[toolName] ?? toolName;
  if (INSTANT_TOOL_FILLER_SKIP.has(canonical)) return undefined;
  const lang = languagePrefix(language);
  const specific = TOOL_FILLERS_BY_NAME[toolName] ?? TOOL_FILLERS_BY_NAME[canonical];
  return specific?.[lang] ?? GENERIC_TOOL_FILLERS[lang];
}
