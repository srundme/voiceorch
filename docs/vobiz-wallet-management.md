# Vobiz Master Wallet Management Guide

## Overview

SnapServe uses a **single Vobiz master wallet** to route all user calls. There are no per-user Vobiz sub-accounts. Every call placed by any user draws from this one master wallet. Your job as the platform operator is to keep it funded so calls never fail.

---

## How Money Flows

```
User pays Razorpay (INR)
        │
        ▼
SnapServe Wallet (stored as paise/cents)
        │
        ├── Phone number purchase → ₹350 deducted
        │         └── Platform pays Vobiz ₹100 (DID cost)
        │         └── ₹250 stays as platform profit
        │
        └── Call minutes → ₹X.XX/min deducted at call end
                  └── Platform pays Vobiz ₹0.65/min (carrier cost)
                  └── Difference is platform margin
```

---

## Per-User Economics ($5 Signup Wallet)

### Conversion
| Item | Value |
|---|---|
| User wallet credit | $5 |
| INR equivalent (at ₹83/USD) | ₹415 |

### After Phone Number Purchase
| Action | User Wallet | Vobiz Master Wallet |
|---|---|---|
| User buys phone number | −₹350 | — |
| Platform pays Vobiz for DID | — | −₹100 |
| Platform keeps markup | — | ₹250 margin |
| **User remaining balance** | **₹65** | — |

### Call Minute Breakdown (example rates)
| Component | Charged to User | Costs Platform |
|---|---|---|
| LLM | ₹1.50/min | ₹0 (user's own API key) |
| ASR | ₹0.50/min | ₹0 (user's own API key) |
| TTS | ₹0.30/min | ₹0 (user's own API key) |
| Telephony (Vobiz/Airtel) | ₹0.70/min | ₹0.65/min |
| **Total** | **₹3.00/min** | **₹0.65/min** |

> Platform margin per minute: ₹3.00 − ₹0.65 = **₹2.35/min (78%)**

### Maximum Possible Call Usage per $5 User
```
Remaining balance:  ₹65
User rate:          ₹3.00/min
Max call minutes:   ₹65 ÷ ₹3.00 = ~21 minutes

Vobiz cost for 21 min:  21 × ₹0.65 = ₹13.65
```

### Total Vobiz Balance Needed per $5 User
```
Phone number DID (monthly):   ₹100.00
Maximum call cost:            ₹ 13.65
─────────────────────────────────────
Worst-case per user:          ₹113.65
Round up to:                  ₹120 per user
```

---

## Scaling Reference Table

| Active Users | Theoretical Max | Real-World (20% usage) | Safe Recharge Trigger |
|---|---|---|---|
| 10 | ₹1,200 | ₹240 | ₹600 |
| 25 | ₹3,000 | ₹600 | ₹1,500 |
| 50 | ₹6,000 | ₹1,200 | ₹3,000 |
| 100 | ₹12,000 | ₹2,400 | ₹6,000 |
| 250 | ₹30,000 | ₹6,000 | ₹15,000 |
| 500 | ₹60,000 | ₹12,000 | ₹30,000 |
| 1,000 | ₹1,20,000 | ₹24,000 | ₹60,000 |

> **Real-world usage** assumes 20% of users actually exhaust their call balance in a given month. Adjust this % based on your actual call logs.

---

## Safety Mechanisms Already Built In

The platform enforces these automatically — you don't need to do anything extra:

1. **Balance gate**: If a user's wallet reaches ₹0, all new calls are blocked with a "Insufficient balance" error.

2. **Max duration limiter**: At call start, the system calculates:
   ```
   max_duration_seconds = floor(wallet_balance ÷ rate_per_min) × 60
   ```
   This is sent to Vobiz as `time_limit`. The call **auto-hangs up** at this point — the user cannot spend more than their wallet holds, and Vobiz cannot drain more than is covered.

3. **Post-call debit**: After the call ends, the exact duration is billed and deducted from the user's wallet.

Together these three layers ensure **no user can ever consume more Vobiz balance than they've paid for**.

---

## Operational Checklist

### One-Time Setup
- [ ] Set call pricing rates in Admin → Call Pricing for all provider categories
- [ ] Enable low-balance SMS/email alert in Vobiz account dashboard (set at ₹5,000)
- [ ] Fund Vobiz master wallet with ₹10,000–20,000 before launch

### Monthly Routine
- [ ] Log in to Admin → Call Pricing and check the live Vobiz balance widget
- [ ] Cross-check: count active users × ₹120 = minimum buffer needed
- [ ] If balance < (active_users × ₹60), top up immediately
- [ ] Review the Vobiz transaction history to validate actual carrier cost matches expected ₹0.65/min

### Recharge Decision Formula
```
When to recharge:
  Current balance < (active_users × ₹60)

How much to add:
  Top up to (active_users × ₹150)
  → gives ~1 month of runway at 20% usage
```

### Example (100 users)
```
Recharge trigger:  100 × ₹60  = ₹6,000
Top up target:     100 × ₹150 = ₹15,000
Add this amount:   ₹15,000 − current_balance
```

---

## What Happens if Vobiz Balance Runs Out

| Scenario | What Vobiz Does | What User Sees |
|---|---|---|
| Balance hits ₹0 mid-call | Vobiz drops the call | Call disconnects unexpectedly |
| Balance is ₹0 before call | Vobiz rejects the call initiation | User sees "Call failed" error |
| Balance is low but > ₹0 | Calls work until balance is exhausted | Works normally until cutoff |

**To prevent this:** The Admin → Call Pricing page shows the live Vobiz balance with an automatic orange warning when it drops below ₹5,000. Check it daily during high-growth phases.

---

## Revenue Projection per $5 User

```
User pays:                 $5.00  (₹415)
Platform charges user:
  ├─ Phone number:         ₹350
  │    └─ Vobiz cost:     −₹100  (DID)
  │    └─ Your margin:    +₹250
  └─ Calls (avg 10 min):   ₹30
       └─ Vobiz cost:     −₹6.50  (10 min × ₹0.65)
       └─ Your margin:    +₹23.50

Total revenue per $5 user: ₹250 + ₹23.50 = ₹273.50
Total Vobiz cost:          ₹100 + ₹6.50  = ₹106.50
Net margin:                ₹273.50 − ₹106.50 = ₹167 (~40% of ₹415 collected)
```

> This assumes the user makes ~10 minutes of calls on average. Adjust based on your actual usage data.

---

## Rate Update Process

When you change pricing in Admin → Call Pricing:
1. New rates apply **immediately** to all new calls (60-second server cache)
2. Existing in-progress calls are not affected
3. The per-minute badge on user agent cards updates within ~60 seconds
4. Always update your Scaling Reference Table above when rates change

---

*Last updated: May 2026 — review monthly or whenever pricing changes.*
