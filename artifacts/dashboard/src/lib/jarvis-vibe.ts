/** Decide when Jarvis should run official Vibe Build instead of /assistant/chat. */

export function looksLikeVibeBuild(text: string): boolean {
  const t = text.toLowerCase();
  if (/\b(create|build|setup|set up|make|vibe)\b/.test(t) && /\b(agent|bot|assistant)\b/.test(t)) {
    return true;
  }
  if (/(agent|bot).{0,40}(create|build|venum|pannu|setup)/.test(t)) return true;
  if (/(create|build|pannu|venum).{0,40}(agent|bot)/.test(t)) return true;
  if (/\b(new agent|first agent|voice agent)\b/.test(t)) return true;
  return false;
}

export function firstVibeKickoff(name: string): string {
  const n = name.trim();
  const who = n ? ` User name: "${n}".` : "";
  return `[First open after signup.${who} You are Jarvis. Start official Vibe PHASE core now. Greet them in Tanglish and ask what the voice agent should do.]`;
}

export function shouldAutoOpenJarvis(search: string, sessionFlag: string | null): boolean {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return params.get("jarvis") === "1" || sessionFlag === "1";
}
