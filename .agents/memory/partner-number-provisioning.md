---
name: Partner number provisioning + self-partner billing
description: Cross-account number assignment revocation rule and how partner accounts bill their own usage
---

## Self-partner billing
`resolvePartnerBilling(clerkId)` resolves THREE cases, not two: partner's client (partner-set rate + spread), **the partner themselves** (base rate, `isSelfPartner: true`, spread short-circuits to 0), and everyone else (null → flat rate). GET /wallet exposes `effectiveRateCentsPerMin` for all "minutes left" UI estimates.

**Why:** partners pay wholesale (base rate) on their own usage; the flat retail rate would overcharge them and the UI minute estimates would lie.

**How to apply:** any new billing/estimate surface must use `resolvePartnerBilling` (never inline flat-rate math), and any new consumer of a non-null result must consider the self-partner case (e.g. don't label the partner as "a partner-managed client").

## Cross-account number assignment revocation rule
Partners may assign THEIR numbers to CLIENT agents (validated: active partner + users.partnerId link). Assignment writes BOTH `agents.inboundPhoneNumberId` AND `agents.outboundPhoneNumberId`; outbound dial paths load numbers by id with no owner check.

**Why:** unassign/reassign originally cleared only the inbound reference — the old agent silently kept outbound caller-ID rights to the partner's number (privilege retention across accounts, caught in review).

**How to apply:** whenever a number↔agent link changes, revoke BOTH directions on every agent that should no longer hold it (reassign must strip the previous holder too). Any future cross-account resource reference needs the same "revoke all functional directions" treatment.
