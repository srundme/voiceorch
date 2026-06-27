---
name: Server-graded quiz answer-key oracle
description: Why a public, retakeable scored-exam endpoint must return aggregate-only results, never per-question correctness
---

# Server-graded quiz / exam endpoints must return aggregate-only results

When grading lives server-side to act as a real gatekeeper (answer key never in the JS
bundle), the grade response itself is the remaining leak surface. On an **unauthenticated,
unlimited-retake** endpoint, returning *any* per-question signal — even a bare `correct: boolean`
per question — is an answer-key **oracle**: an attacker scripts one-answer-at-a-time probes and
reconstructs the full key.

**The rule:** such an endpoint must return ONLY an aggregate (`score`, `total`, `passMarks`,
`passed`). No per-question `correct`/`awarded`/topic-by-question, no `correctAnswer`, no
`explanation`, no echo of the submitted answers. The GET that serves questions must strip
`correct`/`explanation` too. The OpenAPI result schema must match (no per-question result type).

**Why:** Two consecutive architect reviews FAILED on this. Review 1 caught the full key in the
response; Review 2 caught that even a per-question boolean is an oracle. Only removing per-question
data entirely passed.

**Residual (consciously accepted):** the aggregate score-delta itself is a weak oracle (you learn
whether your total moved). It's inherent to any scored retakeable exam and acceptable when the
stakes are cosmetic (a "certified" badge, not access control). Mitigate with a per-device throttle
(e.g. 10s cooldown + ~20/hour cap) so scripted probing is impractical. `deviceId` is client-supplied,
so this is best-effort, not a hard guarantee.

**How to apply:** any time you build a server-graded quiz/exam/assessment whose key must stay
secret, design the response aggregate-first from the start, and don't add a per-question breakdown
"for UX" — show a "no answer review by design" explainer instead.
