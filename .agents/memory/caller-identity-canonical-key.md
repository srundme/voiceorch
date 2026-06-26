---
name: Caller-memory canonical identity key
description: Why caller memory must be keyed on a canonicalized phone identity, and where the single normalizer lives.
---

# Caller-memory canonical identity key

Caller memory (`caller_profiles` / `caller_facts` / `caller_call_archive`) is keyed
on `(agent_id, phone_number)` with exact string equality on phone_number. The
identity MUST flow through one normalizer — `canonicalizeCallerKey` in
`lib/db/src/caller-identity.ts` (exported from `@workspace/db`) — on BOTH the read
and write paths, or memory is stored but never retrieved on repeat calls.

**Why:** the raw caller string drifts between calls — `+` prefix present/absent,
national trunk `0`, `00` international prefix, and inbound calls keying off
`fromNumber` (carrier) vs outbound/campaign off `toNumber` (our DB). Each variant
used to be a different byte-for-byte key → lookup miss → agent greets a returning
caller as a stranger. Read and write were symmetrically un-normalized, which is
why writes "worked" but cross-call retrieval failed.

**How to apply:**
- The normalizer lives in `@workspace/db` (not api-server) specifically so the
  runtime AND the `backfill-caller-identity` maintenance script share one rule and
  can never drift. `humanPhone` returns canonical; `loadCallerContext`,
  `loadCallerProfile`, `updateCallerProfile`, `latchCallerName`, `latchCallerFact`
  re-canonicalize their phone arg as defense-in-depth. `session.ts` wraps the
  callerPhone derivation in it too.
- Web calls use the synthetic `webcall:user_<id>` key — passed through unchanged.
  The telephony raw shape `webcall-user-<id>` is mapped to it.
- Market defaults are India (CC `91`, national length `10`), tunable via
  `CALLER_ID_DEFAULT_CC` / `CALLER_ID_NATIONAL_LEN`. Absolute correctness matters
  less than determinism — same input → same key on read and write.
- Historical rows under non-canonical keys are fixed by running
  `backfill-caller-identity` once (dry-run by default, `-- --apply` to write;
  merges collapsing profiles, supersedes duplicate current facts, keeps archives).
- `loadCallerContext` emits a "Caller memory retrieval" log line with hit/factCount/
  archiveCount so future "doesn't remember me" reports are diagnosable from logs.
