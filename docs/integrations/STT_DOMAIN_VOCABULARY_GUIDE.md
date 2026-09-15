# Sarvam STT Domain Vocabulary Configuration

**Purpose**: Improve STT accuracy for business/SaaS terminology in Call 20094 and similar scenarios.

---

## Problem

Call 20094 showed mixed-language transcripts and poor recognition of technical terms:

- "invest ಮಾಡ್ತಾ रहे हैं" (Kannada/Hindi/English mix)
- "B2B" was recognized but not always correctly
- "CRM integration" may be interpreted as two separate terms

Sarvam Saaras v3 supports **terminology hints** via the `prompt` parameter, but agents are not configured with domain-specific vocabulary by default.

---

## Solution

Use the `sarvamSttPrompt` agent field to provide domain vocabulary hints. This improves recognition of:

- Business terms: B2B, B2C, SaaS, API, CRM, ERP
- Travel terms: flight booking, hotel booking, travel portal
- Technical terms: integration, webhook, dashboard

---

## Implementation

### 1. Agent Configuration

In the agent settings (`AgentConfig`), set `sarvamSttPrompt` to a comma-separated list of important terms:

```json
{
  "sarvamSttPrompt": "B2B, B2C, CRM, integration, API, travel portal, flight booking, hotel booking, demo, dashboard, webhook, SaaS, ERP"
}
```

### 2. Language-Specific Hints

For Hindi/multilingual agents, include both English and transliterated terms:

```json
{
  "sarvamSttPrompt": "B2B, B2C, CRM, integration, ट्रैवल बिजनेस, बुकिंग, इंटीग्रेशन, flight booking, hotel booking"
}
```

### 3. Character Limit

The `prompt` parameter is clipped to **500 characters** by the adapter (see `sarvam-realtime.ts` line 36-40).

Prioritize the most important terms for your domain.

---

## Recommended Prompts by Use Case

### Travel/Tourism
```
B2B, B2C, travel portal, flight booking, hotel booking, itinerary, reservation, cancellation, refund, travel agent
```

### SaaS/Software
```
B2B, B2C, SaaS, API, integration, CRM, ERP, webhook, dashboard, subscription, onboarding, demo
```

### E-commerce
```
B2B, B2C, inventory, SKU, order, payment, shipping, cart, checkout, refund, return
```

### Healthcare
```
appointment, prescription, doctor, patient, consultation, diagnosis, medication, insurance, claim
```

### Finance/Insurance
```
premium, policy, claim, underwriting, investment, portfolio, mutual fund, term insurance, renewal
```

---

## How It Works

From `sarvam-realtime.ts` (lines 189-190):

```typescript
const prompt = clipRealtimePrompt(opts.prompt);
if (prompt) params.set("prompt", prompt);
```

The prompt is sent as a query parameter when establishing the WebSocket connection:

```
wss://api.sarvam.ai/speech-to-text-realtime/ws?...&prompt=B2B,B2C,CRM,...
```

Sarvam's model uses this as a **bias** toward these terms, improving accuracy when they appear in speech.

---

## Testing

After configuring `sarvamSttPrompt`:

1. Make a test call with the technical terms
2. Check call logs for STT transcripts
3. Verify terms like "B2B", "CRM", "integration" are recognized correctly
4. If still inaccurate, add more context (e.g., "B2B portal" instead of just "B2B")

---

## Database Update (Example)

To update agent 947 (Shanaya) with travel-specific vocabulary:

```sql
UPDATE agents
SET extra_config = jsonb_set(
  COALESCE(extra_config::jsonb, '{}'::jsonb),
  '{sarvamSttPrompt}',
  '"B2B, B2C, travel portal, flight booking, hotel booking, CRM integration, travel business, ट्रैवल बिजनेस, बुकिंग, इंटीग्रेशन"'::jsonb
)::json
WHERE id = 947;
```

---

## Limitations

1. **Prompt length**: Max 500 characters (enforced by `clipRealtimePrompt`)
2. **Not a guarantee**: The model may still mis-transcribe if audio quality is poor
3. **Works best with clear speech**: Mumbled or very fast speech may still fail

---

## Related Fixes

This feature works **in addition to** the following fixes from Call 20094:

- **P2: STT language locking** - Prevents drift from Hindi to Kannada
- **P0: TTS chunk tracking** - Prevents playback from completing before all chunks arrive
- **P1: Fallback race fix** - Prevents "didn't hear you" when valid transcript exists

---

**Status**: Feature available, needs agent-by-agent configuration

**Next Step**: Add `sarvamSttPrompt` to agents that handle business/technical terminology

**Reference**: Call 20094 analysis (`CALL_20094_CRITICAL_ANALYSIS.md`)
