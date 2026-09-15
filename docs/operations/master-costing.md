# SnapServe — Master Costing Reference

> Last updated: June 25, 2026  
> Exchange rate used: **₹96 = $1 USD**  
> All figures derived from actual provider dashboards (Mar 28 – Jun 25, 2026)

---

## 1. Provider Costs Per Minute (Real Data)

| Provider | Service | Unit | Rate (INR) | Rate (USD) |
|---|---|---|---|---|
| **Sarvam Saaras v3** | STT (Speech-to-Text) | per minute | ₹0.517/min | $0.0054/min |
| **Sarvam 30b** | LLM | per 1M tokens | ₹2.56/1M | $0.027/1M |
| **Sarvam 30b** | LLM (per call-minute) | ~60 tokens/min | ~₹0.00/min | ~$0.00/min |
| **Cartesia Sonic** | TTS (Text-to-Speech) | per 1K chars | ~₹2.88/1K | $0.03/1K |
| **Cartesia Sonic** | TTS (per call-minute) | ~450 chars/min | ₹1.30/min | $0.0135/min |
| **VoBiz** | Telephony (outbound India) | per minute | ₹0.515/min | $0.0054/min |

### Cartesia Rate Derivation
- 60,000,000 tokens used → $1,800 paid
- Rate: $1,800 ÷ 60M = **$0.03 per 1,000 tokens**
- At ~450 chars/min of AI speech: 450 × $0.03/1000 = **$0.0135/min**

### VoBiz Rate Derivation
- Sample call: 4m 22s (4.37 min) → ₹2.25
- Rate: ₹2.25 ÷ 4.37 = **₹0.515/min ≈ $0.0054/min**

---

## 2. Complete Per-Minute Cost Breakdown

| Component | ₹/min | $/min | % of total cost |
|---|---|---|---|
| VoBiz (telephony) | ₹0.52 | $0.0054 | 21.6% |
| Sarvam Saaras v3 (STT) | ₹0.52 | $0.0054 | 21.6% |
| Cartesia Sonic (TTS) | ₹1.30 | $0.0135 | 54.0% |
| Sarvam 30b (LLM) | ₹0.00 | $0.0000 | ~0% |
| Railway infra | ₹0.07 | $0.0007 | 2.8% |
| **Total cost/min** | **₹2.41** | **$0.0250** | **100%** |

> **Cartesia TTS is the dominant cost** — 54% of all provider spend.

---

## 3. Per-Call Cost (5-Minute Avg)

| Component | ₹/call | $/call |
|---|---|---|
| VoBiz | ₹2.58 | $0.027 |
| STT (Saaras v3) | ₹2.59 | $0.027 |
| TTS (Cartesia) | ₹6.48 | $0.068 |
| LLM (Sarvam 30b) | ₹0.008 | $0.0001 |
| Railway infra | ₹0.33 | $0.003 |
| **Total per 5-min call** | **₹12.01** | **$0.125** |

---

## 4. Platform Billing Rates

| Plan | Charge to user | Your cost/min | Net margin/min | Gross margin % |
|---|---|---|---|---|
| **Managed** | $0.05/min (₹4.80) | $0.025 (₹2.41) | $0.025 (₹2.39) | **50%** |
| **BYOP** | $0.035/min (₹3.36) | $0.0007 (₹0.07) | $0.034 (₹3.29) | **97%** |

> BYOP users pay their own provider costs directly — platform only bears Railway infra cost.

---

## 5. User Wallet → Available Minutes

### Managed Plan ($0.05/min)

| Wallet balance | Available minutes |
|---|---|
| $1 | ~20 min |
| $5 | ~100 min |
| $10 | **~200 min** |
| $25 | ~500 min |
| $50 | ~1,000 min |
| $100 | ~2,000 min |

### BYOP Plan ($0.035/min)

| Wallet balance | Available minutes |
|---|---|
| $5 | ~143 min |
| $10 | **~286 min** |
| $25 | ~714 min |
| $50 | ~1,429 min |

---

## 6. VoBiz Master Wallet Sizing

VoBiz telephony cost = **10.8% of user payment** ($0.0054 ÷ $0.05).

### Recommended: Keep 15–20% of total user wallet in VoBiz

Reason: calls can spike at peak times; VoBiz top-up has processing delay; failed calls due to empty master wallet destroy user trust.

| Total user wallets | Minimum VoBiz (10.8%) | Recommended (20%) |
|---|---|---|
| $100 | $11 | **$20** |
| $500 | $55 | **$100** |
| $1,000 | $108 | **$200** |
| $2,500 | $270 | **$500** |
| $5,000 | $540 | **$1,000** |
| $10,000 | $1,080 | **$2,000** |

**Rule of thumb:** For every $1 of user wallet balance, keep **₹14–₹19 ($0.15–$0.20)** pre-funded in VoBiz master.

---

## 7. Revenue & Margin at Scale (100 Active Users)

### Cost per scenario (managed plan)

| Scenario | Call-min/month | STT cost | TTS cost | VoBiz cost | LLM cost | Railway | **Total cost** | **Revenue** | **Profit** |
|---|---|---|---|---|---|---|---|---|---|
| Light (2 calls/day, 4 min) | 24,000 min | $130 | $324 | $130 | ~$0 | $25 | **$609** | $1,200 | **$591 (49%)** |
| Medium (5 calls/day, 5 min) | 75,000 min | $405 | $1,013 | $405 | ~$1 | $32 | **$1,856** | $3,750 | **$1,894 (51%)** |
| Heavy (15 calls/day, 5 min) | 225,000 min | $1,215 | $3,038 | $1,215 | ~$2 | $52 | **$5,522** | $11,250 | **$5,728 (51%)** |

---

## 8. Infrastructure (Railway)

| Resource | Current plan | Cost |
|---|---|---|
| API server (Singapore) | 1 replica, 24 vCPU / 24 GB | ~$20–52/mo (usage-based) |
| PostgreSQL | Attached volume | Included |
| Redis | Upstash (external) | Pay-per-use, ~$0–5/mo |
| **Concurrent call capacity** | 1 replica | **100–150 simultaneous calls** |

### Scaling path
1. Move Postgres to Railway managed Postgres → unlocks horizontal replicas
2. Add 2–3 api-server replicas → 300–450 concurrent calls
3. Or: Node.js cluster mode (4 workers) → 200–400 concurrent on same machine

---

## 9. Cost Reduction Opportunities

| Opportunity | Current | Alternative | Saving |
|---|---|---|---|
| Switch TTS to Sarvam bulbul | $0.0135/min (Cartesia) | ~$0.005–0.010/min (bulbul est.) | Up to $0.008/min (60%) |
| BYOP plan uptake | $0.0054/min infra only | N/A | 97% margin already |
| Batch outbound via campaigns | Per-call overhead | Amortized | Reduced overhead |

> Note: Sarvam TTS (bulbul) rate is unconfirmed — the ₹292 remaining in the Mar–Jun Sarvam dashboard (65% of total spend) is likely bulbul TTS across 295.9 min, implying ~₹0.99/min ≈ $0.010/min. Verify before switching.

---

## 10. Quick Reference Card

```
Every 1 minute of a managed-plan call costs you:

  STT   ₹0.52  ($0.0054)   ──  Sarvam Saaras v3
  TTS   ₹1.30  ($0.0135)   ──  Cartesia Sonic
  TEL   ₹0.52  ($0.0054)   ──  VoBiz outbound India
  LLM   ₹0.00  ($0.0000)   ──  Sarvam 30b (negligible)
  INF   ₹0.07  ($0.0007)   ──  Railway infra
  ─────────────────────────────────────────────────
  COST  ₹2.41  ($0.0250)
  REV   ₹4.80  ($0.0500)   ──  your charge to user
  PROFIT ₹2.39 ($0.0250)   ──  50% gross margin

VoBiz master wallet: keep 15–20% of total user wallets
```
