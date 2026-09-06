export function normalizeAgentLanguage(raw?: string): string {
  const s = (raw ?? "").toLowerCase();
  if (/(tamil|ta-in|\bta\b|tanglish)/.test(s)) return "ta-IN";
  if (/(hindi|hi-in|\bhi\b)/.test(s)) return "hi-IN";
  if (/(multi|both)/.test(s)) return "ta-IN";
  return "en-IN";
}

export function buildCreatedAgentCopy(opts: {
  agentName: string;
  useCase: string;
  companyName: string;
  language: string;
}): { systemPrompt: string; greetingMessage: string } {
  const { agentName, useCase, companyName, language } = opts;
  const tamil = language.startsWith("ta");
  const greetingMessage = tamil
    ? `வணக்கம், நான் ${agentName}. எப்படி உதவலாம்?`
    : `Hi, this is ${agentName}. How can I help you today?`;
  const systemPrompt = tamil
    ? `You are ${agentName}, a voice agent for ${companyName}. Job: ${useCase}. Speak warm colloquial Tanglish — mix Tamil and simple English like a friendly Chennai colleague. Short spoken sentences. No markdown. Match the caller's language. Never invent account numbers or payments. End the call when the task is done or they say goodbye. The platform already plays the greeting — do not re-introduce yourself after it.`
    : `You are ${agentName}, a voice agent for ${companyName}. Job: ${useCase}. Speak warm, short, friendly Indian English. No markdown. Never invent account numbers or payments. End the call when the task is done or they say goodbye. The platform already plays the greeting — do not re-introduce yourself after it.`;
  return { systemPrompt, greetingMessage };
}
