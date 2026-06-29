---
name: Warm-transfer operator whisper convention
description: Which XML attribute delivers the operator-only briefing per telephony provider (Twilio vs Plivo/VoBiz)
---

The operator whisper (briefing played to the human agent ONLY before the caller is bridged in a warm/context-aware transfer) uses a DIFFERENT XML mechanism per provider family. Getting it wrong fails SILENTLY: the operator is bridged with no briefing and nothing errors, so the warm transfer degrades to a cold transfer.

- **Twilio:** per-`<Number url="…" method="GET">` attribute inside `<Dial>`. Twilio fetches that URL when the destination answers and plays it to the called party only.
- **Plivo / VoBiz (Plivo-compatible):** they SILENTLY IGNORE the per-`<Number url>` attribute. The correct whisper is the `confirmSound="…"` attribute on `<Dial>`. The provider fetches it (HTTP GET) when the operator answers, plays the returned `<Speak>` to the operator only, then bridges the caller.
  - Omit `confirmKey` ⇒ auto-connect after the sound (no DTMF). Setting `confirmKey` REQUIRES the operator to press that digit or the bridge never completes — do not add it for a hands-off whisper.

**Why:** The original code copy-pasted the Twilio `<Number url>` whisper into the Plivo + VoBiz builders, so warm transfers always degraded to cold (operator heard no context) even though the bridge worked and the briefing summary was correctly generated + stored.

**How to apply:** Any change to warm-transfer XML must keep Twilio on `<Number url>` and Plivo/VoBiz on `<Dial confirmSound>`. The briefing route stays GET (Plivo confirmSound is fetched via GET). If a warm transfer connects but the operator hears nothing, check the provider family vs the whisper attribute FIRST. VoBiz call-control docs are not publicly reachable; treat it as Plivo-XML-compatible.
