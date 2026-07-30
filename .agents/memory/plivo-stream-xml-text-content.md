---
name: Plivo Stream XML — URL is text content
description: Plivo <Stream> takes the wss URL as element text; a <WebSocket url> child is silently ignored
---

Plivo's `<Stream>` verb (like VoBiz's) takes the WebSocket URL as the element's TEXT CONTENT: `<Stream bidirectional="true" ...>wss://host/path</Stream>`. A `<WebSocket url="..."/>` child element is silently ignored — Plivo answers the call, never opens the media stream, and the call sits in silence a few seconds then drops (no error in our logs, because Plivo never hits us).

**Why:** BYO-Plivo outbound calls "connected then dropped after silent seconds"; root cause was this XML shape, not audio/auth.

**How to apply:** any Plivo/VoBiz-family XML builder must put the WS URL in the Stream text node and XML-escape `&` → `&amp;` in the query string (bare `&` = invalid XML = instant hangup). Symptom signature "answers → silence → drop with zero WS logs" = stream never attached; check the answer XML first.
