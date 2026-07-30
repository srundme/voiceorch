---
name: BYO telephony ₹1/min discount
description: Pricing rule — own-carrier calls billed ₹1/min below the flat rate
---

**Rule:** Calls carried on the user's OWN telephony account (providers row for the agent's telephonyProvider with complete dial config: authId/accountSid + fromNumber) get ₹1/min (100 paise) off the flat rate via `resolveOwnTelephonyDiscount()` in services/minute-rates.ts.

**Why:** User decision (Jul 30 2026): "if they use own telephony platform charge will be -1rs from the current price." Distinct from the existing "byop" billing mode, which keys off ASR/LLM/TTS keys and does NOT change the rate.

**How to apply:** Any new billing/estimate path must subtract the discount from `getFlatRateCentsPerMin()` (clamped ≥0). Partner-set client rates are used as-is — never discounted. Applied at: WS-close billing (session.ts), HTTP end route + pre-dial credit estimate (calls.ts), outbound-agent-dial.ts.
