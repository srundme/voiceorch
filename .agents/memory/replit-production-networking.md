---
name: Replit production inter-service networking
description: localhost:80 (shared proxy) is NOT available inside the production container
---

**Rule:** In Replit production containers, never call `localhost:80` for inter-service communication. Use `localhost:<direct-port>` instead. The shared proxy is an external infrastructure component, not a localhost listener.

**Why:** Production error confirmed: `connect ECONNREFUSED 127.0.0.1:80`. The shared proxy routes external traffic to services but is not accessible on localhost within the container. In dev, localhost:80 works because the dev proxy IS a local process. Both api-server and gender-service run on the same VM in production, so localhost:5000 (direct port) works in both environments.

**How to apply:** `GENDER_SERVICE_URL = "http://localhost:5000/voice-analysis/gender"` — direct port, always correct. Do NOT use localhost:80 in server-to-server calls even though it works in dev.
