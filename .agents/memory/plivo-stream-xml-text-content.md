---
name: Plivo Stream XML — URL is text content
description: Plivo <Stream> takes the wss URL as element text; a <WebSocket url> child is silently ignored
---

Plivo's `<Stream>` verb (like VoBiz's) takes the WebSocket URL as the element's TEXT CONTENT: `<Stream bidirectional="true" ...>wss://host/path</Stream>`. A `<WebSocket url="..."/>` child element is silently ignored — Plivo answers the call, never opens the media stream, and the call sits in silence a few seconds then drops (no error in our logs, because Plivo never hits us).

**Why:** BYO-Plivo outbound calls "connected then dropped after silent seconds"; root cause was this XML shape, not audio/auth.

Related Plivo WS protocol quirks (same debugging round): agent→Plivo audio must be `{"event":"media",...}` — `"playback"` is silently dropped (caller hears only Plivo-side prompts, "IVR-like voice"); `clear` needs `streamId`; start event fields are camelCase (`streamId`/`callId`) and carry NO from/to — thread From/To from the answer webhook body via the WS URL query, like VoBiz. Full protocol reference vendored at `.agents/skills/plivo/`.

**How to apply:** any Plivo/VoBiz-family XML builder must put the WS URL in the Stream text node and XML-escape `&` → `&amp;` in the query string (bare `&` = invalid XML = instant hangup). Symptom signature "answers → silence → drop with zero WS logs" = stream never attached; check the answer XML first.
