import { db, platformSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../../lib/logger.js";

async function getManagedLlmKey(): Promise<string | null> {
  try {
    const [row] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, "managed_qwen_key"));
    if (row?.value) return row.value;
  } catch {
    // fall through to env
  }
  return (process.env["GROQ_API_KEY"] ?? "").trim() || null;
}

export interface PersonaTurn {
  message: string;
  shouldEnd: boolean;
}

/**
 * Generate the next customer persona message using the platform managed LLM.
 * Returns `shouldEnd: true` when the persona naturally concludes the conversation.
 */
export async function runPersonaTurn(
  personaPrompt: string,
  conversationHistory: Array<{ role: "user" | "agent"; content: string }>,
  goal: string,
): Promise<PersonaTurn> {
  const key = await getManagedLlmKey();
  if (!key) {
    logger.warn("runPersonaTurn: no managed LLM key available");
    return { message: "I think I have all the information I need. Thank you!", shouldEnd: true };
  }

  const systemPrompt = `${personaPrompt}

Your goal in this conversation: ${goal}

You are playing the customer in a scripted test simulation. Stay in character.
After each agent response, generate your next realistic customer message.
If the conversation goal has been achieved or you naturally want to end the call, respond with JSON: {"message":"<your goodbye message>","end":true}
Otherwise respond with JSON: {"message":"<your next message>","end":false}

IMPORTANT: Respond ONLY with valid JSON. No markdown, no code fences.`;

  const messages = conversationHistory.map((turn) => ({
    role: turn.role === "agent" ? ("assistant" as const) : ("user" as const),
    content: turn.content,
  }));

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen/qwen3-32b",
        temperature: 0.8,
        max_tokens: 256,
        enable_thinking: false,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
          { role: "user", content: "[Generate your next customer message based on the conversation so far.]" },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn({ status: response.status, errorText }, "runPersonaTurn: LLM API error");
      return { message: "I think that covers everything. Thank you for your help!", shouldEnd: true };
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content ?? "";
    // Strip <think>...</think> blocks that Qwen3 emits in thinking mode (safety net even with enable_thinking:false)
    const withoutThinking = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    const cleaned = withoutThinking.replace(/```json\n?|\n?```/g, "").trim();

    try {
      const parsed = JSON.parse(cleaned) as { message?: string; end?: boolean };
      return {
        message: parsed.message ?? "I see, thank you.",
        shouldEnd: parsed.end === true,
      };
    } catch {
      // JSON parse failed — return the sanitized text (thinking blocks and code fences already stripped)
      // Never return raw, which may still contain <think>...</think> blocks
      const fallback = cleaned || withoutThinking;
      return { message: fallback || "I see, thank you.", shouldEnd: false };
    }
  } catch (err) {
    logger.error({ err }, "runPersonaTurn: fetch failed");
    return { message: "I think I have all the information I need. Goodbye!", shouldEnd: true };
  }
}
