import type { Chapter } from "../types";

export const billingModes: Chapter = {
  slug: "billing-modes",
  moduleId: "m10",
  number: "11.2",
  title: "Billing Modes: Managed vs. BYOP",
  summary:
    "How SnapServe determines whether a call is billed at the managed rate ($0.05/min) or the BYOP rate ($0.035/min) — and why this decision is made at call-END not call-start.",
  estMinutes: 14,
  fileRef: "artifacts/api-server/src/services/minute-rates.ts",
  prerequisites: ["wallet-system"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "Two prices, one product",
      paragraphs: [
        "SnapServe operates two pricing tiers. **Managed plan** users pay $0.05/min — SnapServe provides all the AI provider keys (LLM, STT, TTS) and handles the infrastructure. The user brings nothing except their phone number.",
        "**BYOP (Bring Your Own Providers)** users pay $0.035/min — a pure orchestration fee. They supply their own OpenAI, ElevenLabs, Deepgram, etc. API keys in the Providers page and pay those vendors directly. SnapServe charges only for the glue: the turn loop, session management, endpointing, barge-in, all the real-time orchestration.",
        "Neither plan is 'better' — BYOP saves money at scale if you already have provider agreements, and gives you access to vendor-specific models. Managed is simpler: zero provider setup, one bill.",
      ],
    },
    {
      kind: "concept",
      title: "Dynamic billing mode resolution",
      body: [
        "The billing mode is NOT set at account creation time. It's resolved **dynamically at call-end**, by checking whether the agent's providers had matching BYOP keys during that call.",
        "The reasoning: a user might configure their OpenAI key on a Tuesday, but some of their agents use Deepgram for STT and Eleven Labs for TTS — providers they haven't configured keys for. That agent is still on managed for the STT and TTS segments. Another agent using only OpenAI for LLM+TTS would be BYOP.",
        "The function `resolveAgentBillingMode` in `minute-rates.ts` checks the `providers` table for active keys matching the agent's ASR/LLM/TTS providers. **Any match** → BYOP rate. No matches → managed rate. It's a per-agent, per-call check.",
      ],
    },
    {
      kind: "code",
      filename: "services/minute-rates.ts",
      language: "typescript",
      intro:
        "`resolveAgentBillingMode` is the authoritative answer to 'which rate applies?' It's called exactly once, at call-end.",
      code: `export async function resolveAgentBillingMode(
  agentId:  number,
  userId:   string
): Promise<"managed" | "byop"> {
  const agent = await db.query.agentsTable.findFirst({
    where: and(
      eq(agentsTable.id, agentId),
      eq(agentsTable.userId, userId)
    ),
  });
  if (!agent) return "managed";

  const providerNames = [
    agent.sttProvider,
    agent.llmProvider,
    agent.ttsProvider,
  ].filter(Boolean) as string[];

  if (providerNames.length === 0) return "managed";

  const matchingKeys = await db.select()
    .from(providersTable)
    .where(and(
      eq(providersTable.userId, userId),
      eq(providersTable.isActive, true),
      inArray(providersTable.providerName, providerNames)
    ));

  return matchingKeys.length > 0 ? "byop" : "managed";
}`,
      lines: [
        {
          lines: "11-16",
          label: "the three providers",
          explanation:
            "The check covers all three AI pipeline components: STT (speech recognition), LLM (language model), and TTS (text to speech). A BYOP key for ANY of these three providers qualifies the call for the BYOP rate — you don't need all three.",
        },
        {
          lines: "19-27",
          label: "query the providers table",
          explanation:
            "`inArray(providerName, providerNames)` is a SQL `WHERE providerName IN (...)` query. If any active key matches, the count is > 0 and the call is BYOP. The query is O(1) thanks to the `(userId, providerName)` index on the `providers` table.",
        },
        {
          lines: "29",
          label: "any match → BYOP",
          explanation:
            "The logic is intentionally user-favourable: one matching key earns the lower BYOP rate for the whole call, even if the other two providers used managed keys. This avoids the confusion of blended rates.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "Why resolve at call-end, not call-start?",
      paragraphs: [
        "There are two reasons. First, provider keys can be added or removed during the call (unlikely, but possible via the API). If you resolve at call-start, you lock in a rate based on a snapshot that may have changed.",
        "Second, and more important: the rate depends on which providers the agent actually used, not just which it's configured for. If an agent is configured for ElevenLabs TTS but the TTS adapter fell back to OpenAI (because ElevenLabs was down), which key should be checked? Call-end resolution happens after the call completes, so you know what actually ran.",
        "The practical implication: the billing amount isn't known until after the call ends. This is normal for metered billing (your electricity bill isn't known until the end of the month). The Call Log shows `billing_mode` and `debitCents` on the call detail page.",
      ],
    },
    {
      kind: "code",
      filename: "services/minute-rates.ts",
      language: "typescript",
      intro:
        "`getFlatRateCentsPerMin` is the rate table. Two rows: managed at 5¢, BYOP at 3.5¢.",
      code: `export const RATE_TABLE = {
  managed: 5.0, // cents per minute
  byop:    3.5, // cents per minute — orchestration fee only
} as const;

export function getFlatRateCentsPerMin(mode: "managed" | "byop"): number {
  return RATE_TABLE[mode];
}`,
      lines: [
        {
          lines: "1-4",
          label: "RATE_TABLE",
          explanation:
            "The rate table is `as const` — a TypeScript literal type, not a runtime enum. This means TypeScript will error if you try to access `RATE_TABLE.enterprise` — unknown rates fail at compile time, not at runtime. Change both the type AND the value to add a new tier.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "The managed key: how SnapServe pays providers",
      body: [
        "On the managed plan, SnapServe calls providers using its own platform API keys — Groq for LLM, Deepgram or Sarvam for STT, ElevenLabs for TTS. These keys are stored in `platform_settings` (not the `providers` table, which is only for user keys). The platform bears the provider cost and covers it with the markup between the 3.5¢ BYOP orchestration rate and the 5¢ managed rate.",
        "The managed LLM key is named `managed_qwen_key` in `platform_settings` (a historical name — the key is now a Groq key). The Admin panel's Managed Keys page lets the SnapServe operator update it without a code deployment.",
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "A user has configured a Deepgram STT key but NO LLM or TTS keys. Their agent uses Deepgram STT + OpenAI LLM + ElevenLabs TTS. What billing mode applies?",
          choices: [
            "Managed — only one of three providers has a BYOP key",
            "BYOP — any matching key qualifies the whole call for the BYOP rate",
            "A blended rate: one-third BYOP, two-thirds managed",
            "It depends on which provider consumed the most tokens",
          ],
          correctIndex: 1,
          explanation:
            "The resolution logic is: `matchingKeys.length > 0 ? 'byop' : 'managed'`. ANY matching key earns BYOP for the whole call. This is user-favourable and avoids confusing blended rates.",
        },
        {
          prompt: "Why is the billing mode resolved at call-END rather than call-START?",
          choices: [
            "To allow retroactive pricing adjustments",
            "Because the database is too slow to check at call-start",
            "Provider keys can change during a call, and the mode should reflect what actually ran",
            "To comply with telecom billing regulations",
          ],
          correctIndex: 2,
          explanation:
            "Call-end resolution means you know exactly which providers were used and whether keys existed for them. It also handles the edge case where a provider fell back during the call to a different vendor.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Managed: $0.05/min — SnapServe provides all AI provider keys. BYOP: $0.035/min — user brings their own keys",
        "`resolveAgentBillingMode` checks `providers` for active keys matching the agent's STT/LLM/TTS providers",
        "ANY matching key = BYOP rate for the whole call — no blended rates",
        "Resolution happens at call-END so the mode reflects what actually ran, not what was configured at call-start",
        "Managed LLM key is stored as `managed_qwen_key` in `platform_settings`, editable from the Admin panel",
      ],
    },
  ],
};
