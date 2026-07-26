---
name: WhatsApp engagement expansion
description: Constraints for chatbot/brochure/template features + the WhatsApp-calling feasibility verdict
---

Inbound WhatsApp handling short-circuit order (whatsapp-native handleInboundEvent tail): request-a-call dial → brochure auto-send → AI chatbot. Each stage returns if it acted; chatbot only runs when nothing else did. All stages fail-soft (try/catch + warn), never breaking message ingestion.

- **Chatbot:** agent-persona replies via createLLMAdapter; caps: 30 replies/phone/24h, 25s LLM timeout, 1200-char sends, 16-msg 48h history; opt-out guard. Free-form sends allowed only inside the 24h customer-service window (fresh inbound).
- **Brochure:** assets in Postgres bytea (Railway has no object storage); Meta fetches them via capability-token public URL `/api/public/wa-assets/{token}/{filename}`; 10-min dedupe on outbound media rows; pdf→document, else image.
- **Templates:** own channels only (strict sub-account creds preferred); shared tier shows the read-only platform catalog. TEXT-only header/footer ≤60 chars, body ≤1024, category UTILITY/MARKETING.

**WhatsApp CALLING verdict (Jul 2026): not feasible on VoBiz.** VoBiz exposes only call.connect/status/terminate webhook EVENTS for WhatsApp calls — no answer API, no media/audio-stream API — so an AI agent cannot pick up or speak on a WhatsApp call. Doing it would require Meta's direct Calling API + a WebRTC/SRTP stack, bypassing VoBiz entirely. Re-check VoBiz docs before re-promising this feature.
