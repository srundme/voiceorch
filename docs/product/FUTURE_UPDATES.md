# VoiceOrch — Future Updates & Ideas

A running list of ideas to make voice agents capable of doing more real jobs during and around a call — beyond the current native tool set (booking, transfer, webhook, send SMS). Nothing here is scheduled or committed; this is a backlog of options to prioritize later.

---

## 1. MCP (Model Context Protocol) integration

**What it is:** Instead of hand-wiring one tool at a time per agent, an agent points at an MCP server (a CRM, helpdesk, internal API, or a hosted service like Zapier/Notion/GitHub that exposes an MCP endpoint) and automatically gains every tool that server offers, with typed schemas — no custom integration work per client.

**How it would fit the existing pipeline:**
- New tool type: `mcp_server` — agent config gets an MCP server URL + optional auth header/API key, same shape as the existing `webhook` tool.
- At call setup, the orchestration layer calls the MCP server's `tools/list` and merges the results into the same `buildToolDefs()` list the LLM already sees — no changes needed to the LLM adapters themselves.
- When the LLM calls one of these tools, `handleToolCallInner` routes the request to the MCP server's `tools/call` instead of a native executor, and the result flows back into the conversation via the existing `continueWithToolResult` path.
- Dashboard UI: an "MCP Servers" section, ideally a **global library** (like Providers) that can be attached per agent, with auth header support (most real MCP servers require one).

**Example real-time flow:**
1. Business connects their MCP-wrapped CRM (`get_customer_by_phone`, `get_invoice_status`, `create_support_ticket`, `update_deal_stage`).
2. Caller: "I think there's a mistake on my invoice."
3. LLM emits a tool call → pipeline plays a filler ("Let me pull that up...") → MCP `tools/call` fetches real invoice data → result feeds back into the LLM → agent replies with real numbers, or chains into `create_support_ticket` / a live transfer.

**Open decisions:**
- Global library + per-agent attachment vs. per-agent only.
- Auth model: header/API key is the practical minimum; OAuth-based MCP servers would need a separate connect flow later.

---

## 2. Native "actions" that don't need MCP

- **Pay-by-phone (DTMF/IVR payments):** agent collects card details or sends a Razorpay payment link via SMS mid-call, confirms payment, and continues. High value for collections/e-commerce use cases (Razorpay keys are already provisioned).
- **WhatsApp follow-through:** agent sends a WhatsApp confirmation, invoice PDF, or booking link mid-call (extends the existing `send_sms` tool to WhatsApp Business API).
- **Live document lookup / RAG over the business's own docs:** let an agent look something up from an uploaded policy/FAQ PDF mid-call using the existing AI Knowledge (Postgres FTS) infra, instead of only canned script content.

---

## 3. Outbound triggers from other systems (event-driven / proactive calling)

**Core idea:** a webhook lands from any external system ("cart abandoned," "payment failed," "form submitted") and the platform auto-dials that customer via an existing campaign — proactive instead of reactive calling. This does **not** require a Shopify-specific integration; Shopify (or Stripe, WooCommerce, Zendesk, Typeform, etc.) is just one possible sender hitting a **generic inbound webhook**.

**Building blocks:**
- A generic inbound webhook per campaign/agent that accepts a POST from any system.
- Field mapping UI: map arbitrary JSON payload fields (`phone`, `name`, `product`, `amount`, etc.) to a lead record — no per-platform code required.
- The mapped lead drops into a campaign and flows through the existing rolling-concurrency/retry dialing logic.
- Optional **presets** (Shopify, Stripe, Razorpay, WooCommerce) that pre-fill the field mapping for that platform's known payload shape — convenience only, not a hard dependency.

**Trigger sources worth presetting:**
- Payment failed / dunning (Stripe, Razorpay — natural first preset given Razorpay keys are already configured)
- Cart/checkout abandoned (Shopify, WooCommerce)
- Subscription about to renew or expire (retention call)
- Appointment no-show (ties into the existing Scheduling module — a no-show booking could auto-trigger a reschedule call)
- Support ticket unresolved after N hours (Zendesk/Freshdesk/Intercom)
- New lead / form submission (Typeform, Google Forms, website form) — "speed to lead" outbound call
- Back-in-stock / delivery delay notifications
- Churn-risk score crossing a threshold (from an analytics tool)

**Refinements to keep this useful and not spammy:**
- Delay + quiet-hours respect (e.g. wait 30–60 min after cart abandonment; always honor existing campaign business-hours logic).
- Dedup/throttle: don't call the same number twice for overlapping triggers within a cooldown window.
- Dynamic script variables: inject webhook payload fields (`product_name`, `amount`, `order_id`) as call variables so the agent references specifics instead of a generic script.
- Outcome writeback: after the call ends, POST the result (answered / no-answer / resolved) back to the originating system so its CRM/tags update automatically — closes the loop both ways.
- Multi-step escalation: SMS first, call only if unread/unclicked after X hours.
- Security: this is a public-facing endpoint — needs HMAC signature verification per campaign and rate limiting, same pattern as existing campaign webhooks (not something the sending platform enforces for you).

---

## 4. Multi-agent / workflow orchestration

- **Agent-to-agent handoff:** a general receptionist agent detects intent ("I want to cancel my policy") and silently hands off to a specialized retention agent mid-call, not just to a human.
- **Supervisor/QA agent:** a second AI listens to live calls for compliance/tone issues and can whisper-coach the live agent's next line (extends existing compliance-warning logging into an active intervention).

---

## 5. Smarter memory & personalization

- **Cross-channel memory:** tie existing phone-keyed caller memory to email/chat history too, so the agent knows if the customer already emailed support.
- **Proactive context injection:** pull CRM data (last order, sentiment score, churn risk) into the prompt *before* the call starts, not only fetched via a mid-call tool.

---

## 6. Post-call automation

- **Auto CRM writeback:** after every call, automatically update deal stage/notes/tags in the customer's CRM (overlaps with MCP, but could also be a first-class "Zapier-style" connector list for reach beyond MCP-savvy users).
- **Auto follow-up scheduling:** if a call ends with "let's talk next week," auto-book a follow-up call into the campaign queue.

---

## 7. Quality & trust

- **Real-time sentiment/escalation scoring:** auto-flag calls for human review if the caller sounds frustrated, reusing the existing audio-tap pattern used for gender detection.
- **A/B testing of prompts/voices:** split traffic between two agent configs and compare success rate/duration automatically in analytics.

---

## 8. Easier integration paths for non-technical users

- **Native Zapier/Make app:** triggers (call ended, appointment booked) + actions (start a call) — likely reaches more customers than asking them to stand up an MCP server, since many already use Zapier.
- **Pre-built "Connectors" library:** Google Sheets, Slack, Calendly-style toggles that don't require the user to understand MCP or webhooks at all.

---

## Suggested prioritization (effort vs. impact)

1. **MCP support** + **Zapier-style connectors** together — MCP serves power users/developers, Zapier reaches the non-technical majority.
2. **Outbound triggers (generic webhook + field mapping + Razorpay/Shopify presets)** — proactive calling is a strong differentiator and builds on existing campaign infrastructure.
3. **Pay-by-phone** if collections/e-commerce is a meaningful share of the customer base.
