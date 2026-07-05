# AI-to-Human Sales Consult & Callback — Feature Plan

## The idea, in your words

Customer asks the AI agent something it can't answer on its own — a discount, a custom price, a policy exception, "can you match this quote." The agent doesn't wing it or make something up. It tells the customer it needs a moment, calls someone on the sales/ops team, has a real (voice) conversation to get the answer, then calls the customer back and gives them the resolution.

No competitor voice-orchestration platform (Bolna, Vapi, Retell, Synthflow, Vocode, etc.) ships this today — they all either hang up, transfer blind, or hallucinate an answer. This would be a genuine differentiator for SnapServe, especially for high-ticket sales/negotiation use cases (real estate, insurance, B2B SaaS, automotive).

This doc lays out how to build it on top of what already exists in the codebase (dial infra, warm-transfer briefing generator, scheduled callbacks, alert notifications), so this is additive, not a rebuild.

---

## Why "callback" (not "hold and relay") is the right MVP shape

There are two conceivable shapes:

1. **Live relay** — keep the customer on hold, dial the sales rep into the SAME call (3-way bridge), and let the AI shuttle information between them in real time, then drop the sales leg and resume with the customer.
2. **Async callback** — tell the customer "I'll check and call you right back," end the call cleanly, have a *separate* AI-to-sales call, then place a fresh AI-to-customer call with the answer.

**Recommendation: build #2 first.** It's what you described in your example ("...calling back to the same person and conveying the things"), it doesn't require multi-party conference bridging (which is inconsistent across Twilio/Plivo/VoBiz and adds real fragility — see Phase 3 below), and it reuses three subsystems that already exist and are battle-tested in this codebase:

- **Outbound dialing** (`orchestration/telephony/dial.ts`) — already dials Twilio/Plivo/VoBiz with AMD.
- **Warm-transfer briefing generation** (`executeTransferWarm` in `pipeline.ts`) — already turns a live conversation into a 3–5 sentence natural-language briefing via a secondary LLM call. The same pattern generates the "brief the sales rep" message here.
- **Scheduled callback / auto-redial** (`services/autoRedial.ts`, `scheduled_callbacks` table) — already handles "call this number again later," including retry/backoff. The customer-callback leg slots directly into this.

Live relay becomes a Phase 3 enhancement once the async path is proven.

---

## End-to-end flow (MVP)

```
Customer call (live)
   │
   ├─ AI hits a question it can't answer (pricing, exception, "let me check")
   │     → calls new tool: escalate_to_team(question, category, urgency)
   │
   ├─ AI tells customer, in-language:
   │     "That's a good question — let me check with our team and call you
   │      right back, usually within [N] minutes."
   │     → captures callback number (defaults to caller ID) + confirms
   │     → ends the call gracefully (or offers to text confirmation)
   │
   ├─ escalation_requests row created: status = pending
   │
   ├─ [Background] Consult leg — AI calls the sales contact
   │     → status = dialing_sales
   │     → outbound call via dial.ts, to the on-call sales number
   │        (AMD-aware: if voicemail, DON'T leave the question — retry / escalate to Slack)
   │     → AI plays a short auto-generated briefing:
   │        "Hi, this is the SnapServe AI for Acme Corp. A customer named
   │         Priya is asking whether we can do ₹40,000/mo instead of ₹55,000.
   │         Can you tell me what I should offer, or should we decline?"
   │     → AI LISTENS to the rep's spoken answer, uses LLM to extract a
   │        concise resolution string, reads it back once to confirm
   │        ("So I should tell her we can do ₹45,000 if she commits annually —
   │         is that right?"), then thanks the rep and hangs up
   │     → status = sales_answered, resolution_text stored
   │
   ├─ [Background] Callback leg — AI calls the original customer back
   │     → status = dialing_customer
   │     → outbound call via dial.ts to the stored callback number
   │     → fresh session, but seeded with context: original question +
   │        resolution_text + original call's topic (NOT a generic cold call —
   │        agent opens with "Hi, it's [Agent] following up on the pricing
   │        question from a few minutes ago...")
   │     → delivers the answer, continues the conversation normally from there
   │        (can renegotiate, book, transfer to human, etc.)
   │     → status = resolved
   │
   └─ Timeout/failure handling at every stage (see below) → status = failed /
        timed_out, triggers a Slack/email alert to ops for manual follow-up
```

---

## Data model

New table: `escalation_requests`

| Column | Notes |
|---|---|
| `id` | pk |
| `agent_id` | tenant/agent scope |
| `original_call_id` | FK to `calls` — the call where the question arose |
| `customer_phone` | canonicalized via `canonicalizeCallerKey` (same convention as caller memory) |
| `question_text` | what the AI captured as the open question |
| `category` | `pricing` \| `policy_exception` \| `technical` \| `general` (drives routing) |
| `urgency` | `normal` \| `high` |
| `status` | `pending` → `dialing_sales` → `sales_answered` → `dialing_customer` → `resolved` \| `failed` \| `timed_out` \| `declined` |
| `sales_contact_id` | FK to a new `sales_contacts` config table (see below) |
| `sales_call_id` | the outbound call record for the consult leg |
| `resolution_text` | the extracted answer, confirmed with the rep |
| `callback_call_id` | the outbound call record for the customer callback leg |
| `attempts` | retry counter (reuse `autoRedial` backoff conventions) |
| `promised_eta_minutes` | what the AI told the customer, used for the timeout SLA |
| `created_at` / `updated_at` | |

New table: `sales_contacts` (per-agent config, dashboard-managed)

| Column | Notes |
|---|---|
| `id` | pk |
| `agent_id` | |
| `name`, `phone_number` | |
| `categories` | which escalation categories this person handles (pricing/technical/general/all) |
| `priority` | for round-robin/fallback ordering when multiple contacts exist |
| `active_hours` | optional business-hours window (reuse the availability-schedule pattern already built for Scheduling) |
| `is_active` | toggle |

This mirrors the existing `availability_schedules` concept from Scheduling, so business-hours logic can be shared rather than reinvented.

---

## New pieces to build

### 1. The escalation tool (agent-facing)
A new native tool, `escalate_to_team`, injected into the tool list alongside `transfer_to_human` and `schedule_callback` (same place in `pipeline.ts`). System-prompt guidance: use this when the caller asks about pricing/discounts/exceptions/anything not covered by the agent's knowledge base or prompt, **instead of** guessing. Params: `question`, `category`, `urgency`.

### 2. Consult-call orchestrator (new service, e.g. `services/salesEscalation.ts`)
- `initiateSalesConsult(escalationId)` — picks the right `sales_contacts` row (category match → priority order → business hours check), dials via existing `dial.ts`, generates the briefing via the same LLM-briefing pattern as `executeTransferWarm`.
- A **lightweight consult persona** (not the full customer-facing agent prompt) drives this leg: state the question, listen, extract, confirm, close. This is a lot simpler than a normal agent turn loop — mostly one question, one answer, one confirmation.
- On no-answer/voicemail (reuse AMD from `dial.ts`): try the next contact in priority order; if none pick up within N attempts, fall back to a Slack/email alert (`services/alert-notifications.ts` already does exactly this kind of multi-channel dispatch) so a human can resolve it manually and type the answer into the dashboard (see Phase 2).

### 3. Callback orchestrator
- Reuses `scheduled_callbacks` / `autoRedial.ts` almost as-is: once `resolution_text` is set, insert a callback row (or call the existing outbound-dial path directly for near-immediate callback rather than the slower polling queue).
- Session for the callback leg is seeded with a small injected context block: original question + resolution + "this is a follow-up call" framing, so the agent doesn't act like it's meeting the customer for the first time. This is a smaller, purpose-built version of the caller-memory "resume" context injection already used elsewhere — not the full resume-from-drop path, just a one-shot context string.

### 4. Timeout/SLA handling
- `promised_eta_minutes` (what the AI told the customer, e.g. "10 minutes") becomes the SLA clock. If the consult leg hasn't produced a `resolution_text` by then, fire an ops alert (Slack/email) and, if configured, send the customer an apologetic SMS/status update rather than leaving them hanging with silence.

### 5. Dashboard visibility (Phase 2, but plan the shape now)
New "Escalations" page: live list of pending/resolved consult requests per agent, with status, timestamps, and — critically — a **manual override**: an ops person can type the answer directly into the dashboard instead of waiting for the AI-to-sales call to complete. This turns the flow into "AI asks → human answers via app OR phone call, whichever comes first" which is more robust than depending on a voice call succeeding every time.

---

## Phased rollout

**Phase 1 — MVP (async, single contact, voice-only)**
- `escalation_requests` + `sales_contacts` tables, single active contact per agent (no routing complexity yet).
- `escalate_to_team` tool, consult-call orchestrator, callback orchestrator.
- Alert on failure/timeout via existing `alert-notifications.ts` (Slack/email — no new channel work needed).
- No dashboard UI yet — everything visible via DB/logs.

**Phase 2 — Operability**
- Escalations dashboard page (list + manual "answer via app" override).
- Multiple sales contacts per agent with category routing + priority fallback.
- Business-hours awareness (reuse Scheduling's availability primitives).
- SMS-based customer status update while waiting ("still checking, we'll call you shortly").

**Phase 3 — Live relay (stretch)**
- True 3-way bridging: customer stays on hold while the AI dials the sales rep into the *same* call, relays live, then drops the sales leg. Requires provider conference primitives (Twilio Conference, Plivo `<Conference>`, VoBiz equivalent — needs verification per earlier finding that VoBiz TTS/whisper support already has provider-specific quirks). Meaningfully harder and provider-fragile; only worth it once Phase 1/2 prove the demand.
- Multi-turn negotiation: sales rep can ask a clarifying question back through the AI mid-consult instead of one-shot Q&A.

**Phase 4 — Intelligence**
- Auto-suggest `category` from the transcript instead of the LLM having to classify it inline.
- Learn common escalation questions per agent and suggest adding them to the agent's knowledge base / prompt so they don't need escalation next time (closes the loop — the AI gets smarter from every escalation).

---

## Cost & billing notes

Both legs (AI→sales, AI→customer) are real outbound calls and consume orchestration minutes + provider telephony cost, same as any outbound call today — no new billing primitive needed, `minute-rates.ts` billing logic applies unchanged. Worth surfacing "escalation minutes" as a separate analytics line so agencies/customers can see the cost of this feature distinctly from normal call volume.

## Tenant isolation / security notes (per threat model)

- `sales_contacts` phone numbers are tenant-owned config data — same server-side ownership checks as any other agent-scoped resource (never trust a client-supplied `agentId` alone).
- The consult-leg call must never leak the *customer's* PII beyond what's needed for the sales rep to answer (name + question is enough; no need to read out full phone numbers or unrelated call history).
- Manual dashboard override (Phase 2) is an authenticated, tenant-scoped write — must enforce the same ownership check as any other mutation per the threat model's Tampering section.

---

## Open questions to settle before Phase 1 build

1. What should the AI say to the customer if the sales team takes *too long* — keep retrying silently, or proactively text/call them again with a status update?
2. Should the callback attempt happen automatically the moment `resolution_text` is set, or go through the existing scheduled-callback queue (small delay, but reuses more infra as-is)?
3. Single sales contact number, hardcoded per agent to start — is that acceptable for the MVP, or do you already have multiple sales reps per agent on day one?
