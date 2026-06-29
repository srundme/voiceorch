---
name: Warm-transfer briefing XML TTS verb
description: Any provider XML that speaks text must branch the TTS verb per provider, or VoBiz/Plivo silently play nothing
---

# Provider XML must branch the TTS verb

When emitting telephony response XML that speaks text (briefings, IVR prompts, hangup messages), the spoken verb is provider-specific:

- **Twilio:** `<Say voice="Polly.Joanna">text</Say>`
- **Plivo / VoBiz (Plivo-compatible):** `<Speak>text</Speak>`

A `<Say>` element sent to VoBiz/Plivo is **silently ignored** — no error, the agent just hears nothing. This is how the context-aware (warm) transfer briefing was broken on VoBiz: the shared `warm-briefing-xml` handler hardcoded Twilio's `<Say>` for all providers, so the human agent answered the whisper leg and heard dead air, defeating the whole point of the warm/whisper handoff.

**Why:** the bug is invisible in dev/Twilio testing and only shows on VoBiz/Plivo real calls; silent (no exception, no log).

**How to apply:** thread a `provider` arg into every XML-emitting route and pick the verb via a single `speakVerb(provider, text)` helper. Apply it to the dynamic content AND the static fallback/forbidden/error responses. Always XML-escape dynamic (AI-generated) text (`&`,`<`,`>`,`"`) before embedding — a call summary can contain `&`. Cold transfer (`<Dial><Number>`) has no spoken text so it was unaffected, which is why cold worked while warm didn't.
