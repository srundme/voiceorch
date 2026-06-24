# 🛠️ VoiceOrch — Replit Build Session Report
**Team usage of Replit AI Agent · May 14 – June 24, 2026**

---

## 🧑‍💻 How We Used Replit (TL;DR)

| Metric | Value |
|--------|-------|
| 📋 Total tasks created | **273** |
| 🔄 Task agent runs (merges) | **85** |
| 💬 Estimated build sessions | **63** |
| 📅 Active coding days | **34 of 41** calendar days |
| ⏱️ Total time building (elapsed) | **968 hrs** (~40 days wall-clock) |
| 📝 Total code commits | **1,608** |
| ➕ Lines of code added | **415,052** |
| ➖ Lines of code removed | **85,881** |
| 📁 Unique files changed | **2,380** |
| 🐛 Fix/debug commits | **281** |
| ↩️ Revert commits | **3** |

---

## 💬 Prompts & Tasks

Replit does not expose a raw prompt counter, but every task file represents at least one prompt, and most involved multiple back-and-forth rounds:

| Category | Count |
|----------|-------|
| **Total task files created** | **273** |
| Bug-fix tasks (`fix-*`) | 128 |
| Feature / enhancement tasks | 145 |
| Task agents delegated + merged | **85** |
| Tasks still in `.local/tasks/` | 273 |

**273 tasks** × estimated **3–5 prompt rounds each** = roughly **800–1,400 total prompts** sent to Replit AI over the build window.

### Sample of What We Tasked the Agent With

| Area | Example Tasks |
|------|--------------|
| Voice pipeline | Fix barge-in, Tamil STT regression, Silero VAD, endpointing |
| Agent builder | Draft history, version control, latency bar, tool tabs |
| Scheduling | Calendar tools, Google Meet, booking flow, reschedule |
| Admin | Impersonation, managed keys, usage page, voice whitelist |
| Compliance | DPDP Act PII scan, retention sweep, erasure endpoints |
| Auth | Google OAuth migration away from Clerk |
| Billing | BYOP vs Managed rate resolution, Razorpay integration |
| Calls | Recording, transcript, call log enrichment, call exec log |
| Dashboard | Branding, glass UI, Poppins font audit, Recharts |

---

## ⏱️ Hours Spent Building

| Metric | Value |
|--------|-------|
| Project started | **May 14, 2026** |
| Report date | **June 24, 2026** |
| Calendar days elapsed | **41 days** |
| Days with at least one commit | **34** (83% of days) |
| Estimated distinct build sessions | **63** |
| Avg commits per active day | **~47** |
| Avg commits per session | **~26** |
| Longest streak | Jun 14–24 (11 days straight) |

### Commits per Day (Full History)

| Date | Commits | Day |
|------|---------|-----|
| May 14 | — | First commit (project init) |
| May 19 | 66 | Monday |
| May 22 | 33 | Thursday |
| May 25 | 63 | Sunday |
| **May 28** | **159** 🔥 | Wednesday |
| May 29 | 36 | Thursday |
| May 30 | 59 | Friday |
| May 31 | — | — |
| Jun 01 | 47 | Monday |
| Jun 03 | 38 | Wednesday |
| Jun 04 | **108** | Thursday |
| Jun 05 | 34 | Friday |
| Jun 08 | — | — |
| Jun 09 | 32 | Monday |
| Jun 14 | 37 | Saturday |
| Jun 15 | 69 | Sunday |
| **Jun 16** | **103** | Monday |
| **Jun 17** | **155** 🔥 | Tuesday |
| Jun 18 | 68 | Wednesday |
| Jun 19 | 76 | Thursday |
| Jun 20 | — | — |
| Jun 21 | 69 | Saturday |
| Jun 22 | 43 | Sunday |
| **Jun 23** | **107** | Monday |
| Jun 24 | (ongoing) | Tuesday |

### By Day of Week

| Day | Commits | Share |
|-----|---------|-------|
| Thursday | 353 | 22.0% |
| Tuesday | 330 | 20.5% |
| Monday | 251 | 15.6% |
| Wednesday | 230 | 14.3% |
| Friday | 179 | 11.1% |
| Sunday | 154 | 9.6% |
| Saturday | 111 | 6.9% |

> **Thursday and Tuesday are the team's most productive days.**
> The team codes 7 days a week — even weekends average 100+ commits.

### By Month

| Month | Commits | Share |
|-------|---------|-------|
| May 2026 | 510 | 31.7% |
| June 2026 | 1,098 | 68.3% |

> Output more than doubled month-over-month — velocity is accelerating.

---

## 🔧 Changes Made

Every commit = one Replit-pushed change to the codebase.

| Metric | Value |
|--------|-------|
| Total commits | **1,608** |
| Lines written | **415,052** |
| Lines deleted | **85,881** |
| Net new code | **~329,171 lines** |
| Files touched | **2,380** |
| Task agent merge commits | **85** |
| Avg lines added per commit | **~258** |

### Type of Changes

| Type | Commits | Notes |
|------|---------|-------|
| Bug fixes & error recovery | **281** | `fix`, `error`, `crash`, `regression` in message |
| Reverts | **3** | Full rollbacks (VAD revert, etc.) |
| Feature additions | ~600 | `feat`, `add`, `integrate`, `new` |
| Improvements / refactors | ~724 | `improve`, `update`, `enhance`, `refactor` |

---

## 📋 Tasks Created

| Metric | Value |
|--------|-------|
| **Total tasks** | **273** |
| Bug fixes | **128** (47%) |
| New features & improvements | **145** (53%) |
| Delegated to task agent | **85** |
| Task areas covered | 15+ (voice, admin, scheduling, billing, auth…) |

### Task Breakdown by Feature Area

| Area | Approx Tasks |
|------|-------------|
| Voice pipeline (STT/TTS/barge-in) | 45 |
| Bug fixes (call/agent/builder) | 128 |
| Scheduling / calendar | 22 |
| Admin panel | 18 |
| Agent builder / UI | 20 |
| Auth / billing / compliance | 15 |
| Dashboard / design | 12 |
| Other (scripts, docs, infra) | 13 |

---

## 🐛 Errors & Debug Sessions

### Code-Level (Git)

| Metric | Value |
|--------|-------|
| Commits labelled as fixes | **281** |
| Full reverts | **3** |
| Fix rate (fixes ÷ total commits) | **17.5%** |

### Notable Debugging Runs

| Issue | Sessions spent | Resolution |
|-------|---------------|------------|
| Tamil/Sarvam STT zero transcripts | 4+ sessions | Audio not forwarded to WS — restored `sendAudio()` |
| Silero VAD regression | 2 sessions | Reverted to energy-based VAD |
| Echo/barge-in false positives | 3 sessions | Grace period tuning + re-arm per sentence |
| Azure STT continuous LID | 1 session | Added `speech.context` for mid-call LID |
| Google Calendar timezone bug | 1 session | `formatInTimeZone` instead of `toISOString()` |
| Drizzle migration loops | 2 sessions | FK name truncation at 63 chars |
| Gender service URL routing | 2 sessions | Base URL + appended path pattern |
| Admin impersonation prod failure | 1 session | Missing migration 0012 on prod DB |

### Platform Errors (Live Calls During Beta)

| Metric | Value |
|--------|-------|
| Failed / errored calls | **179 of 757** |
| Overall error rate | **23.7%** |
| Worst error day | Jun 17 — 46 errors (25.4% rate on 181 calls) |
| Best sustained stretch | Jun 8–9, Jun 22 — 0–2% error rate |

---

## 🚀 What We Shipped in 41 Days

```
✅ Full voice agent orchestration pipeline (STT → LLM → TTS)
✅ Webcall (browser) + telephony (Twilio/Plivo/Vonage) paths
✅ Sarvam, Azure, Deepgram STT adapters
✅ Google/Qwen/OpenAI/Anthropic/Mistral LLM adapters
✅ Cartesia, ElevenLabs, AWS Polly, Azure TTS adapters
✅ Scheduling engine (6 DB tables, slot booking, advisory locks)
✅ Google Calendar OAuth + multi-account sync
✅ BYOP vs Managed billing (dynamic at call-end)
✅ Razorpay payment integration
✅ Admin panel (user mgmt, impersonation, managed keys, analytics)
✅ Agent draft history + version control with visual diff
✅ Call execution log (STT/LLM/TTS latency timeline)
✅ AI Knowledge Base (PostgreSQL FTS, no embeddings)
✅ DPDP Act compliance (PII scan, retention, erasure)
✅ Speaker recognition (ECAPA-TDNN, local model)
✅ Gender detection (ML-based, progressive confidence)
✅ Google OAuth auth (migrated away from Clerk)
✅ HTTP keep-alive pool (process-wide, all providers)
✅ Turn safety-net (Tamil/Hinglish silence hang guards)
✅ Public booking page (/book/:slug, no auth)
✅ Pitch deck artifact
✅ Family app + mobile (Agent Portal)
```

---

## 📅 Timeline Summary

```
May 14  ▶ Project started — first commit
May 19  ▶ First beta user signed up
May 28  ▶ Most productive day (159 commits)
Jun 05  ▶ 7 users signed up in one day
Jun 17  ▶ Peak call day (181 calls) + most commits in June (155)
Jun 23  ▶ Last full beta day
Jun 24  ▶ This report generated
```

---

*Data sources: git log, `.local/tasks/` directory (273 files), production PostgreSQL database · June 24, 2026*
