---
name: sarvam-chat
description: Chat completions using Sarvam AI LLMs (Sarvam-105B, Sarvam-30B). Handles AI chat, text generation, reasoning, coding, and multilingual conversations in Indian languages. OpenAI-compatible API. Use when building chatbots, Q&A systems, agents, or any LLM feature targeting Indian users.
license: Apache-2.0
metadata:
  author: sarvam-ai
  version: "3.1"
---

# Chat Completions — Sarvam AI

> [!IMPORTANT]
> Auth: send both `api-subscription-key` and `Authorization: Bearer <key>`.
> Base URL: `https://api.sarvam.ai/v1` (only `sarvam-105b` + `sarvam-105b-conversations`).

## Models

| Model | Context | Best For |
|-------|---------|----------|
| `sarvam-105b` | 128K | Complex reasoning, coding, agentic workflows |
| `sarvam-105b-conversations` | — | Real-time chat, voice agents, conversational AI |

Open-source hosts (`gemma4`, `glm5.2`) use `/v2/chat/completions`. Older `sarvam-30b` / fixed-context variants are retired.

## Quick Start (Python)

```python
from sarvamai import SarvamAI
client = SarvamAI()

response = client.chat.completions(
    model="sarvam-30b",
    messages=[{"role": "user", "content": "भारत की राजधानी क्या है?"}]
)
print(response.choices[0].message.content)
```

### Streaming (Python)

```python
for chunk in client.chat.completions(
    model="sarvam-30b",
    messages=[{"role": "user", "content": "Write a poem about India"}],
    stream=True
):
    if chunk.choices and chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
```

## Quick Start (JavaScript/TypeScript)

```typescript
import { SarvamAIClient } from "sarvamai";

const client = new SarvamAIClient({ apiSubscriptionKey: "YOUR_SARVAM_API_KEY" });

const response = await client.chat.completions({
    model: "sarvam-30b",
    messages: [{ role: "user", content: "भारत की राजधानी क्या है?" }]
});
console.log(response.choices[0].message.content);
```

### OpenAI-Compatible (both languages)

```python
from openai import OpenAI
client = OpenAI(api_key="your-key", base_url="https://api.sarvam.ai/v1")
response = client.chat.completions.create(model="sarvam-30b", messages=[...])
```

## Gotchas

| Gotcha | Detail |
|--------|--------|
| **SDK method** | Python: `client.chat.completions(...)`, JS: `client.chat.completions({...})` — no `.create()` in either. OpenAI SDK uses `.create()` as usual. |
| **JS constructor** | `new SarvamAIClient({ apiSubscriptionKey: "..." })` — NOT `SarvamAI()`. Key is passed explicitly. |
| **`content` can be `None`** | Models produce `reasoning_content` before `content`. If `max_tokens` is too low, reasoning consumes the budget, `finish_reason` is `"length"`, and `content` is `None`. Omit `max_tokens`, set 500+, or disable reasoning with `reasoning_effort=None`. Check `reasoning_content` as fallback. |
| **reasoning_effort** | Thinking is **on by default** at `"medium"` (API ref 2026-08). Values: `"low"\|"medium"\|"high"`, or `None`/`null` to disable. Omitting the field leaves medium ON. NOT `thinking=True`. Reasoning tokens count toward completion tokens and billing. |

## Full Docs

Fetch detailed parameters, tool calling, streaming, and examples from:

- **https://docs.sarvam.ai/llms.txt** — comprehensive docs index
- [Chat Completion Guide](https://docs.sarvam.ai/api/api-guides-tutorials/chat-completion/overview)
- [Model Specs](https://docs.sarvam.ai/api/getting-started/models)
- [Rate Limits](https://docs.sarvam.ai/api/ratelimits)
