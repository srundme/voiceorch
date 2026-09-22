/**
 * Detect voicemail outcomes when carrier AMD did not latch voicemailActionExecuted
 * (common when action=continue or the greeting is transcribed as caller speech).
 */

const VM_GREETING_RE =
  /\b(?:voice\s*mail|voicemail|voice\s*message|mailbox)\b|(?:the person you(?:'re| are) trying to reach)|(?:(?:please )?leave (?:a |your )?message)|(?:at the (?:tone|beep))|(?:record your message)|(?:after the (?:tone|beep))|(?:is not available)|(?:not\s+reachable)|(?:cannot\s+take\s+your\s+call)|(?:inbox\s+is\s+full)|(?:mailbox\s+is\s+full)|(?:forwarded\s+to\s+(?:an?\s+)?(?:voice\s*)?mail)/i;

/** Indic / Hinglish / Tamil carrier mailbox cues (QA voicemail fails). */
const VM_GREETING_INDIC_RE =
  /వాయిస్\s*మెయిల్|వాయిస్‌మెయిల్|వాయిస్ మెయిల్|वॉइस\s*मेल|वॉइसमेल|वॉयस\s*मेल|कृपया\s*(?:संदेश|मैसेज)\s*(?:छोड़|छोड)|टोन\s*(?:के\s*)?बाद|बीप\s*(?:के\s*)?बाद|उपलब्ध\s*नहीं|फोन\s*नहीं\s*उठा|குரலஞ்சல்|குரல்\s*அஞ்சல்|செய்தி\s*விட|டோன்\s*க்கு\s*ப்பிறகு|அழைப்பை\s*எடுக்க\s*முடியவில்லை|எடுக்க\s*வில்லை/u;

const AGENT_ACK_VM_RE =
  /\b(?:reached (?:the )?voicemail|got (?:their |the )?voicemail|hit (?:a |the )?voicemail|answering machine|seems like .{0,40}voicemail)\b/i;

/**
 * True when this utterance alone looks like a carrier voicemail greeting
 * (mid-call AMD miss → leave configured message instead of pitching).
 */
export function looksLikeVoicemailGreeting(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  if (!t || t.length > 500) return false;
  const lower = t.toLowerCase();
  // Require at least one strong greeting cue (not just "is not available" alone).
  const strong =
    /\b(?:voice\s*mail|voicemail|voice\s*message|mailbox)\b/.test(lower)
    || /(?:the person you(?:'re| are) trying to reach)/.test(lower)
    || /(?:record your message)/.test(lower)
    || /(?:at the (?:tone|beep)|after the (?:tone|beep))/.test(lower)
    || /(?:please leave (?:a |your )?message)/.test(lower)
    || /(?:inbox\s+is\s+full|mailbox\s+is\s+full)/.test(lower)
    || /(?:forwarded\s+to\s+(?:an?\s+)?(?:voice\s*)?mail)/.test(lower)
    || /(?:cannot\s+take\s+your\s+call|not\s+reachable)/.test(lower)
    || VM_GREETING_INDIC_RE.test(t);
  return strong;
}

/**
 * True when the call transcript clearly shows a voicemail box, not a live human.
 * Conservative: requires a classic greeting and/or an explicit agent acknowledgment.
 */
export function looksLikeVoicemailTranscript(transcript: string | null | undefined): boolean {
  const t = (transcript ?? "").trim();
  if (!t) return false;
  const lower = t.toLowerCase();

  const hasGreeting = VM_GREETING_RE.test(lower);
  const agentAck = AGENT_ACK_VM_RE.test(lower);

  if (hasGreeting && agentAck) return true;
  if (agentAck && t.length < 1200) return true;

  // First caller-ish chunk is a classic greeting (short outbound VM dumps).
  if (hasGreeting) {
    const firstChunk = lower.slice(0, 400);
    if (looksLikeVoicemailGreeting(firstChunk) || VM_GREETING_RE.test(firstChunk)) return true;
  }
  return false;
}

export function shouldMarkCallVoicemail(opts: {
  voicemailActionExecuted: boolean;
  amdResult?: string | null;
  transcript?: string | null;
}): boolean {
  if (opts.voicemailActionExecuted) return true;
  const amd = (opts.amdResult ?? "").trim().toLowerCase();
  if (amd === "machine" || amd === "voicemail") return true;
  return looksLikeVoicemailTranscript(opts.transcript);
}
