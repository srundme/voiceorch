# Pendrive — Caller Memory API

> **Never forgets.** A plug-and-play memory layer for any AI voice agent platform.

---

## What is Pendrive?

Pendrive is a standalone caller memory API that gives voice AI agents long-term memory across calls. Any platform — VAPI, Retell, Bolna, VoiceOrch, or a custom stack — can plug in Pendrive and its agents will instantly remember every caller's name, history, preferences, and emotional state across all future conversations.

It uses a **3-layer memory graph** (facts → episodes → sentences) powered by an LLM that runs in the background after every call — so it never adds latency to live conversations.

---

## How It Works — End to End

```
┌─────────────────────────────────────────────────────────────────────┐
│                         INCOMING CALL                               │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Voice Platform (VAPI / Bolna / Retell)                 │
│                                                                     │
│  On call start → POST /api/pendrive/webhook                         │
│                  { event: "call.started", phoneNumber: "+155..." }  │
└─────────────────────────┬───────────────────────────────────────────┘
                          │  < 50ms
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    PENDRIVE WEBHOOK HANDLER                         │
│                                                                     │
│  1. Validates pd_live_... API key                                   │
│  2. Loads caller context from DB (L0 facts + L1 episodes)           │
│  3. Assembles enhanced memory block                                 │
│  4. Returns memory block to platform                                │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   LIVE CALL (LLM sees this)                         │
│                                                                     │
│  === CALLER MEMORY — NEVER FORGETS ===                              │
│  Name: Rahul Sharma  |  Calls: 7  |  Last: 3 days ago              │
│                                                                     │
│  🎯 PREDICTED REASON: billing discrepancy on policy                 │
│  🚨 HIGH RISK (74%) — approach with extra patience                  │
│  📊 SENTIMENT ARC: 😊 → 😤 → ✅ (📈 improving)                     │
│                                                                     │
│  KNOWN FACTS:                                                       │
│  • policy_number: POL-9988  [2 months ago]                          │
│  • spouse_name: Priya  [1 month ago]                                │
│                                                                     │
│  RECENT EPISODES:                                                   │
│  [3 days ago] 😤 Called about billing. Unresolved.                  │
│  [1 week ago] ✅ Added wife Priya to policy. Resolved.              │
│  =====================================                              │
└─────────────────────────┬───────────────────────────────────────────┘
                          │  Call runs with full memory context
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        CALL ENDS                                    │
│                                                                     │
│  Platform → POST /api/pendrive/webhook                              │
│             { event: "call.ended", transcript: "...", phone: "..." }│
└─────────────────────────┬───────────────────────────────────────────┘
                          │  Pendrive responds 200 immediately
                          │  (non-blocking)
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  BACKGROUND MEMORY PIPELINE                         │
│                                                                     │
│  LLM (Qwen via Groq) reads the full transcript and extracts:        │
│                                                                     │
│  1. Summary — 1-3 sentence episode summary                          │
│  2. Sentiment — positive / neutral / negative / frustrated /        │
│                 resolved                                            │
│  3. Facts — atomic key-value facts with confidence scores           │
│                                                                     │
│  Then:                                                              │
│  4. Fact conflict resolution — supersedes outdated facts            │
│  5. Intent prediction — predicts reason for NEXT call               │
│  6. Risk scoring — 0-100% escalation risk                           │
│  7. Sentiment trend — improving / declining / stable / mixed        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Three-Layer Memory Graph (L0 / L1 / L2)

Pendrive models memory as a graph — not a flat table — inspired by [Graphiti](https://github.com/getzep/graphiti).

### L0 — Facts (Atomic Nodes)

Discrete, high-confidence facts about the caller. Each fact is a key-value pair with:
- **Conflict resolution via supersession** — if a fact changes (e.g. new address), the old node gets a `superseded_by` edge pointing to the new one. Historical facts are never deleted.
- **Confidence score** — 0.9+ = directly stated, 0.7-0.9 = clearly implied. Facts below 0.7 are discarded.
- **Provenance** — every fact links back to the exact sentences it was extracted from (L0 → L2 edges).
- **Staleness marker** — facts older than 90 days are flagged as "may be outdated" in the memory block.

```
caller_facts table:
  id, agentId, phoneNumber
  key: "policy_number"
  value: "POL-9988"
  confidence: 0.95
  superseded_by_id: NULL   ← current fact
  source_call_id: 42
```

### L1 — Episodes (Call Archive)

One record per completed call, never deleted. Contains:
- **Summary** — 1-3 sentence summary of what was discussed
- **Sentiment** — emotional classification of the call
- **`insight_facts` edges** — links to the L0 facts extracted from this episode

The last 5 episodes are injected into every memory block, ordered newest-first.

```
caller_call_archive table:
  id, agentId, phoneNumber
  transcript: "Agent: Hello...\nCaller: My name is Rahul..."
  summary: "Caller asked about adding wife to policy. Completed."
  sentiment: "resolved"
  facts_extracted: true
  duration_seconds: 145
```

### L2 — Sentences (Raw Utterances)

Every sentence in every call is stored as an individual node, ordered by sequence number. Used for:
- **Provenance tracing** — which specific sentences a fact was extracted from
- **Future semantic search** — "what exactly did the caller say about their policy?"

```
caller_sentences table:
  id, episode_id, sequence_num
  speaker: "caller"
  text: "My policy number is POL-9988 and I want to add my wife."
```

---

## Advanced Intelligence Layer

These run asynchronously after every call — never on the critical path.

### Sentiment Tracking
Every call is classified with one of: `positive | neutral | negative | frustrated | resolved`.

### Sentiment Arc
The last 5 call sentiments are displayed as an emoji trail in the memory block:
```
😊 → 😐 → 😤 → 😤 → ✅  (📈 improving)
```
Trend labels: `improving | declining | stable_positive | stable_negative | mixed`

### Intent Prediction
After each archive, a second LLM pass reads the last 5 episode summaries and predicts:
- **Why the caller is most likely calling next**
- Stored as `predicted_intent` on the caller profile
- Shown to the LLM as: `🎯 PREDICTED REASON FOR THIS CALL: billing dispute`

### Risk Scoring (0.0 – 1.0)
Computed from negative sentiment trend + call frequency:
- **≥ 0.7** → `🚨 HIGH RISK CALLER` — agent is instructed to proactively de-escalate
- **≥ 0.4** → `⚠️ ELEVATED RISK` — handle with care
- **< 0.4** → No flag

### Fact Conflict Resolution
When the LLM extracts a fact that already exists with a different value:
```
Old: policy_number = "POL-1234"  →  superseded_by → New: "POL-9988"
```
The old fact is never deleted — it becomes historical. Only current (non-superseded) facts appear in the memory block.

---

## Integration — Zero Config

### Universal Webhook
The webhook auto-detects which platform is calling from the payload shape.

**Endpoint:** `POST /api/pendrive/webhook`
**Auth:** `Authorization: Bearer pd_live_...`

#### Platform Support

| Platform | Detection | call.started response | call.ended |
|----------|-----------|----------------------|------------|
| **VAPI** | `body.message.type = "assistant-request"` | `{ assistantOverrides: { variableValues: { caller_memory: "..." } } }` | Parses `artifact.transcript` |
| **Retell** | `body.event = "call_started"` | `{ memory: "...", caller_name: "..." }` | Parses `call.transcript` |
| **Bolna / Generic** | `body.event = "call.started"` | `{ memory: "...", systemPromptSuffix: "..." }` | Parses `transcript` array or string |

#### Minimal Integration (any platform)

```bash
# 1. Set your platform's server URL / webhook URL to:
POST https://your-domain/api/pendrive/webhook

# 2. Set the auth header to your Pendrive API key:
Authorization: Bearer pd_live_...

# Done. Every call now has memory.
```

#### VAPI Example

```js
// In your VAPI assistant config:
serverUrl: "https://your-domain/api/pendrive/webhook",
serverUrlSecret: "pd_live_..."  // sent as Authorization header
```

#### Bolna / Generic Example

```python
# In your call webhook handler, forward events to Pendrive:
import requests

PENDRIVE_KEY = "pd_live_..."

# On call start:
memory = requests.post(
    "https://your-domain/api/pendrive/webhook",
    headers={"Authorization": f"Bearer {PENDRIVE_KEY}"},
    json={"event": "call.started", "phoneNumber": caller_phone}
).json()["memory"]

# On call end:
requests.post(
    "https://your-domain/api/pendrive/webhook",
    headers={"Authorization": f"Bearer {PENDRIVE_KEY}"},
    json={
        "event": "call.ended",
        "phoneNumber": caller_phone,
        "transcript": raw_transcript,
        "durationSeconds": 145
    }
)
```

---

## Database Schema

```
caller_profiles          ← one row per (agent, phone) pair
  - name, summary        ← backward-compat profile fields
  - call_count           ← total calls seen
  - last_called_at       ← for "last call" label
  - last_call_dropped    ← dropped-call detection
  - predicted_intent     ← LLM-predicted next call reason
  - risk_score           ← 0.0–1.0 escalation risk
  - sentiment_trend      ← improving / declining / stable / mixed

caller_facts             ← L0 fact nodes
  - key, value           ← e.g. "policy_number": "POL-9988"
  - confidence           ← 0.7–1.0
  - superseded_by_id     ← NULL = current fact
  - source_call_id       ← which call it came from

caller_call_archive      ← L1 episode nodes
  - transcript           ← full raw transcript
  - summary              ← LLM-generated episode summary
  - sentiment            ← emotional classification
  - facts_extracted      ← whether LLM extraction ran

caller_sentences         ← L2 sentence nodes
  - episode_id, sequence_num
  - speaker              ← "caller" | "agent"
  - text                 ← raw utterance

caller_fact_sentence_links   ← L0 ← L2 provenance edges
caller_episode_fact_links    ← L1 → L0 insight_facts edges
```

---

## API Reference

All dashboard API routes require `Authorization: Bearer <session-jwt>`.
The webhook route uses `Authorization: Bearer pd_live_...`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/pendrive/webhook` | API key | Universal webhook — call.started / call.ended |
| `GET` | `/api/pendrive/api-keys` | Session | List API keys |
| `POST` | `/api/pendrive/api-keys` | Session | Create API key |
| `DELETE` | `/api/pendrive/api-keys/:id` | Session | Revoke API key |
| `GET` | `/api/pendrive/stats` | Session | Usage stats |
| `GET` | `/api/pendrive/callers` | Session | Paged caller list |
| `GET` | `/api/pendrive/context` | Session | Fetch memory for a caller |
| `POST` | `/api/pendrive/archive` | Session | Manually archive a call |

---

## LLM Usage

Pendrive uses **Qwen (via Groq)** as its managed LLM. No LLM key is required from integrators — Pendrive handles it.

Two LLM calls run per call archive:

1. **Extraction pass** — extracts name, summary, sentiment, and facts from the transcript
2. **Prediction pass** — reads last 5 episode summaries, predicts next call intent + risk score (only after 2+ calls)

Both run in the background after the call ends. They never add latency to live conversations.

---

## Dashboard

The Pendrive dashboard (`/pendrive/`) provides:

| Page | What you see |
|------|-------------|
| **Overview** | Total callers, facts, episodes, API calls this month + quick-start code |
| **Caller Memory** | Searchable list of all callers with call counts, last seen, sentiment trend |
| **API Keys** | Create / revoke `pd_live_...` keys + universal webhook URL |
| **Documentation** | Integration guide with code samples |

---

## What Makes This Different

| Feature | Pendrive | Bolna memory | VAPI memory |
|---------|----------|--------------|-------------|
| Multi-call fact graph with conflict resolution | ✅ | ❌ | ❌ |
| Sentiment arc across calls | ✅ | ❌ | ❌ |
| Intent prediction before call starts | ✅ | ❌ | ❌ |
| Risk scoring | ✅ | ❌ | ❌ |
| Fact provenance (which sentence → which fact) | ✅ | ❌ | ❌ |
| Fact confidence decay / staleness detection | ✅ | ❌ | ❌ |
| Universal webhook (VAPI + Retell + Bolna) | ✅ | platform-only | platform-only |
| Zero config (no prompt changes) | ✅ | ❌ | ❌ |
