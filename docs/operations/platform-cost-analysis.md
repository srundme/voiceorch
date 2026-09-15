# VoiceOrch Platform Cost Analysis
**100 Active Users · Railway (Singapore) · Sarvam STT + LLM + TTS · Cartesia TTS**

---

## 1. Your Current Railway Baseline (Observed)

From your "honest-gratitude" project (June 12–25, ~13 days idle/light use):

| Resource | Consumed | Rate | Cost |
|---|---|---|---|
| Memory | 22,925 GB-min | $0.000231 / GB·min | $5.31 |
| CPU | 125.83 vCPU-min | $0.000463 / vCPU·min | $0.06 |
| Network Egress | 4.89 GB | $0.05 / GB | $0.24 |
| Volume Storage | 19,371 GB-min | $0.00000347 / GB·min | $0.07 |
| **Total (13 days)** | | | **$5.68** |

**Derived averages (idle platform, no active calls):**
- Average RAM: 22,925 / 18,720 min = **~1.22 GB**
- Average CPU: 125.83 / 18,720 min = **~0.007 vCPU**
- Annualized idle cost: ~**$13/month**

Your current plan ceiling: **24 vCPU · 24 GB RAM** — you are far below it.

---

## 2. Per-Call Resource Profile

Each active call pipeline holds:
- Audio ring buffers (16 kHz PCM, 20 ms frames)
- LLM conversation history (JSON, grows ~1 KB/turn)
- TTS queued audio chunks
- Active WebSocket to Sarvam STT + telephony provider

| Resource | Per Concurrent Call | Notes |
|---|---|---|
| RAM | 40–80 MB | Grows with history length; 60 MB is a safe mid-point |
| CPU | 0.02–0.05 vCPU | I/O-bound; spikes during audio DSP, otherwise near zero |
| Egress | ~0.5 MB/min | Webhook payloads, provider REST, call recordings |

**Base platform overhead (with no calls running):**
- API server + Redis + Postgres + Dashboard: ~**2 GB RAM, 0.05 vCPU**

---

## 3. Concurrent Call Capacity on Your Current Plan

| Ceiling | Math | Hard limit |
|---|---|---|
| RAM | (24 GB − 2 GB base) ÷ 60 MB/call | **367 concurrent calls** |
| CPU | (24 vCPU − 0.05 base) ÷ 0.035 vCPU/call | **685 concurrent calls** |
| Node.js event loop (practical) | Single-threaded; GC pressure above ~200 WS connections | **~150–200 concurrent calls** |

> **Practical safe ceiling: 100–150 simultaneous live calls on 1 Railway replica.**  
> Beyond 150, you would add a second api-server replica (Railway supports it for non-volume services).  
> ⚠️ Note: Railway says "Replicas not available for attached volumes" — detach the Postgres volume to a separate Railway Postgres service before adding replicas.

---

## 4. Usage Scenarios for 100 Active Users

Three realistic profiles for 100 registered users:

| Scenario | Calls/user/day | Avg duration | Call-min/day | Avg concurrent | Peak concurrent |
|---|---|---|---|---|---|
| **Light** (demo / low-volume sales) | 2 | 4 min | 800 | 1.7 | 5 |
| **Medium** (active InsurTech / support) | 5 | 5 min | 2,500 | 5.2 | 15 |
| **Heavy** (outbound campaign / dialer) | 15 | 5 min | 7,500 | 15.6 | 40 |

*(Concurrency assumes calls spread over 8 business hours)*

---

## 5. Railway Infrastructure Cost at 100 Users

Monthly cost = 43,200 minutes × average resources:

| Scenario | Avg RAM | Avg CPU | RAM cost | CPU cost | Egress | **Monthly Railway** |
|---|---|---|---|---|---|---|
| Light | 2.1 GB | 0.11 vCPU | $21.0 | $2.1 | $1.5 | **~$25/mo** |
| Medium | 2.3 GB | 0.23 vCPU | $23.0 | $4.6 | $4.0 | **~$32/mo** |
| Heavy | 3.0 GB | 0.60 vCPU | $30.0 | $11.3 | $10.0 | **~$52/mo** |

*Includes ~$1/mo volume storage. Egress estimated at 0.5 MB/call-min.*

---

## 6. Provider Costs (BYOP — you pay Sarvam + Cartesia directly)

> These are **not** Railway costs. They are charged by each provider against your API keys.

### Estimated provider rates (as of mid-2025)

| Provider | Service | Est. rate |
|---|---|---|
| Sarvam | STT (saaras:v3 streaming) | ~₹1.5/min ≈ **$0.018/min** |
| Sarvam | LLM (sarvam-2-adept) | ~$0.15/1M input tokens, $0.60/1M output tokens |
| Sarvam | TTS (bulbul:v2 streaming) | ~₹2/min ≈ **$0.024/min** |
| Cartesia | TTS (Sonic) | **$0.015 per 1,000 characters** |

### Per-call provider cost breakdown (5-min call, Sarvam stack)

| Component | Quantity | Rate | Cost |
|---|---|---|---|
| Sarvam STT | 5 min | $0.018/min | $0.090 |
| Sarvam LLM | ~3,000 input tokens, ~600 output tokens | $0.00045 + $0.00036 | $0.001 |
| Sarvam TTS | 5 min | $0.024/min | $0.120 |
| **Total (Sarvam stack)** | | | **~$0.21/call** |

### Per-call provider cost breakdown (5-min call, Sarvam STT+LLM + Cartesia TTS)

| Component | Quantity | Rate | Cost |
|---|---|---|---|
| Sarvam STT | 5 min | $0.018/min | $0.090 |
| Sarvam LLM | ~3,000 input + ~600 output tokens | — | $0.001 |
| Cartesia TTS (Sonic) | ~2,500 chars agent speech | $0.015/1K | $0.038 |
| **Total (mixed stack)** | | | **~$0.13/call** |

> **Cartesia is ~3× cheaper than Sarvam TTS for voice output** and typically has lower latency on Indic voices too — use it for all TTS if possible.

---

## 7. Total Monthly Cost at 100 Users

Combining Railway + provider costs:

### Sarvam STT + Sarvam LLM + Sarvam TTS (full Sarvam stack)

| Scenario | Call-min/mo | Provider cost/min | Provider total | Railway | **Grand total** |
|---|---|---|---|---|---|
| Light | 24,000 | $0.042 | $1,008 | $25 | **~$1,033/mo** |
| Medium | 75,000 | $0.042 | $3,150 | $32 | **~$3,182/mo** |
| Heavy | 225,000 | $0.042 | $9,450 | $52 | **~$9,502/mo** |

### Sarvam STT + Sarvam LLM + Cartesia TTS (recommended)

| Scenario | Call-min/mo | Provider cost/min | Provider total | Railway | **Grand total** |
|---|---|---|---|---|---|
| Light | 24,000 | $0.026 | $624 | $25 | **~$649/mo** |
| Medium | 75,000 | $0.026 | $1,950 | $32 | **~$1,982/mo** |
| Heavy | 225,000 | $0.026 | $5,850 | $52 | **~$5,902/mo** |

*Provider cost/min (mixed stack): STT $0.018 + LLM $0.0002 + Cartesia $0.0076 ≈ $0.026/min*

---

## 8. Platform Revenue vs. Cost Check

VoiceOrch charges your end-users:
- **Managed plan**: $0.05/min billed to user
- **BYOP plan**: $0.035/min orchestration fee only (user pays providers)

At Medium usage (75,000 call-min/month):

| Plan | Revenue | Provider cost | Railway | **Net margin** |
|---|---|---|---|---|
| Managed ($0.05/min) | $3,750 | $1,950 (you cover) | $32 | **$1,768 (47%)** |
| BYOP ($0.035/min) | $2,625 | $0 (user covers) | $32 | **$2,593 (99%)** |

> BYOP plan is extremely high-margin — Railway is your only cost. Managed plan requires covering provider bills.

---

## 9. When to Scale Railway

| Trigger | Action |
|---|---|
| Peak concurrent calls > 120 | Add a second api-server service (detach volume to separate Postgres service first) |
| RAM consistently > 18 GB | Upgrade Railway plan or split gender-service to its own service |
| CPU > 20 vCPU average | Same as above — Node.js benefits more from horizontal scaling than vertical |
| Egress > 50 GB/month | Consider serving call recordings from object storage (GCS/S3) instead of Postgres bytea |
| Latency complaints from India callers | Add a Mumbai/India Railway region replica — Singapore adds ~30–60ms RTT |

---

## 10. Quick Summary

| | Value |
|---|---|
| Current Railway spend (idle) | **~$13/month** |
| Safe concurrent call ceiling (current plan) | **100–150 calls** |
| Railway cost at 100 active users (medium usage) | **~$32/month** |
| Provider cost per call (mixed stack, 5 min) | **~$0.13** |
| Provider cost per call (full Sarvam, 5 min) | **~$0.21** |
| **Break-even call volume (managed plan)** | **~2,000 call-min/month** |
| Recommended TTS for cost | **Cartesia (3× cheaper than Sarvam TTS)** |

---

*Rates based on Railway pricing page (June 2025) and Sarvam/Cartesia published/estimated pricing. Sarvam LLM token costs are estimates — verify against your Sarvam dashboard usage reports.*
