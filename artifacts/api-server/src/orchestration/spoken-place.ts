/**
 * "Where are you calling from?" should sound like a person, not a directory.
 * The knowledge base often stores street + landmark + pincode + phone + hours.
 * Speak company and city or area. Read the rest only when they ask for it.
 */

function callerUtterance(text: string): string {
  return (text.split(/\n\n\[/)[0] ?? text).trim();
}

/** They asked for the pin, phone, email, hours, or the full written address. */
export function asksSpecificPlaceDetail(text: string): boolean {
  const t = callerUtterance(text);
  if (!t) return false;
  return /pincode|pin\s*code|postal\s*code|phone|mobile|email|e-mail|office\s*hours|timing|full\s+address|முழு|பின்\s*கோட்|பின்கோட்|போன்|ஃபோன்|நம்பர்/iu.test(t);
}

/** They asked where the call or the office is, not for a pincode or phone. */
export function isWhereCallingFromQuestion(text: string): boolean {
  const t = callerUtterance(text);
  if (!t || t.length > 160 || asksSpecificPlaceDetail(t)) return false;
  return /where\s+(?:are\s+)?you\s+calling|calling\s+from|where\s+is\s+(?:your|the)\s+office|office\s+location|your\s+location|which\s+(?:city|place|area)|எங்கிருந்து|எங்க\s*இருந்து|எங்க\s*ஆபிஸ்|ஆபிஸ்\s*எங்க|எந்த\s*ஊர்|location\s*(?:என்ன|enna|sollu|சொல்லு)|(?:office|company|உங்க|your)\s+address|address\s+(?:என்ன|எங்க|sollu|சொல்லு)/iu.test(t);
}

export function buildWhereFromNudge(userText: string): string {
  if (!isWhereCallingFromQuestion(userText)) return "";
  return "[WHERE FROM] They asked where you are calling from. Answer like a person in ONE short spoken sentence: company and city or area only. Do not read the street, landmark, pincode, phone, email, or office hours from the knowledge base.";
}

/** Drop a spoken 6-digit pincode when they only asked where the call is from. */
export function trimWhereFromSpeech(userText: string, spoken: string): string {
  if (!isWhereCallingFromQuestion(userText)) return spoken;
  const cleaned = spoken
    .replace(/\b[1-9]\d{5}\b/g, "")
    .replace(/,?\s*\bnear\b[^।.]*/giu, "")
    .replace(/,?\s*அருகில்[^।.]*/gu, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,।.])/g, "$1")
    .replace(/,\s*,/g, ",")
    .replace(/,\s*$/g, "")
    .trim();
  return cleaned || spoken;
}
