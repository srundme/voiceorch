/**
 * Curated pinned summary for the Galaxy Health Insurance knowledge base.
 *
 * ~4,000 chars, hand-condensed from the two full source documents (the mobile
 * App User Guide V.3.2.0 and the Policy Knowledge Base PDF, 13 products).
 * This entry is seeded with pinned=true so it sorts FIRST in every full-dump
 * KB injection (call-start baked block + per-turn prefetch fallback) and
 * survives any char-cap truncation — guaranteeing the agent always has broad
 * coverage of every section even when retrieval misses.
 *
 * ⚠ MANUAL REVIEW RECOMMENDED: figures below (discount %, waiting periods,
 * contact numbers, benefit rules) were transcribed from the source documents
 * by an AI agent. A human should verify them against the official documents
 * before relying on this summary in production calls.
 */

/** Stable title marker — the seed script upserts by exact match on this. */
export const GALAXY_SUMMARY_TITLE = "Galaxy Health — Master Summary (pinned)";

export const GALAXY_SUMMARY_KEYWORDS =
  "galaxy health, summary, overview, products, plans, discounts, claims, app guide, benefits, wellness, teleconsultation, labs, hospital, pharmacy, waiting period, toll free";

export const GALAXY_SUMMARY_CONTENT = `GALAXY HEALTH INSURANCE — MASTER SUMMARY

COMPANY: Galaxy Health Insurance Company Limited (IRDAI Reg. No. 167), HQ Chennai. Toll-free 1800 203 0007, support@galaxyhealth.com, www.galaxyhealth.com. Philosophy: "Everything for Everyone".

PRODUCTS (13 active):
• Galaxy Promise — flagship plan; 3 tiers: Signature, Elite, Premier. SI ₹3L–₹1Cr by tier. Unlimited restoration, cumulative bonus up to 500%, no co-payment (base). Adults 18–65, children 16 days–25 yrs, up to 2A+3C. Waiting: SD 24 mo / PED 36 mo (Signature 3-yr term: SD 18 / PED 25).
• Galaxy Marvel — fully customizable (pick base covers + add-ons). Any room, digital ICU, 68 consumables covered, premium waiver (1 yr critical illness/accidental death; 2 yrs organ donor).
• Galaxy Guardian — universal all-ages plan; AYUSH, outpatient consultation, rehabilitation & pain management.
• Galaxy Twin 360 — inpatient + exclusive OPD layer; gym access; extra SI for road accidents.
• Galaxy Top-up — supplemental SI after base plan exhausts.
• Galaxy Empower — outpatient (OPD) focused: in-clinic consults, diagnostics, pharmacy.
• Galaxy Personal Accident Shield — AD/PTD/PPD/TTD, EMI & income protection, education benefit.
• Galaxy Privilege — senior citizens 60–75 (spouse from 50); SI ₹5–25L.
• Galaxy Plus — group/corporate insurance.
• Arogya Sanjeevani — standard IRDAI plan, SI ₹50k–₹10L.
• Riders: Smart Outpatient, Unlimited Auto Restoration, Consumables, Companion (dedicated health manager, home nursing).

DISCOUNTS: 5% online purchase/renewal; long-term 10% (2-yr), 12.5% (3-yr), 14% (4-yr, Marvel), 15% (5-yr, Marvel); wellness up to 20% at renewal (Gala Fit-Pro Active Care); early renewal 2.5% (paid 30+ days before expiry); NRI/OCI 15% (Marvel); organ donor 2-yr premium waiver; deductible/co-pay/preferred-network options give further discounts.

CLAIMS: Cashless at network hospitals (1,000+ partners) or reimbursement. Document deadline: 15 days after discharge. Room-rent proportionality applies if room exceeds eligible limit. Claims contact: 1800 203 0007, galaxyhealth.com/claims.

MOBILE APP (V.3.2.0): Bottom nav = Home, My Policies, My Claims, My Health. Sidebar has profile, Contact Us, Log Out. Policy card % = policy year elapsed, NOT benefit used. Each policy: Policy Details / Documents / My Coverage tabs — download the e-card from Documents for cashless admission.
• My Health → Plan Details → Health tab: Doctor, Labs, Hospital, Pharmacy. Doctor+Labs+Hospital SHARE one benefit pool; Pharmacy has its OWN separate limit.
• Doctor: instant teleconsult (connects ~60 s, unlimited, GP/Paediatrician/Dermatologist 24×7, free follow-up) or book in-clinic (needs location).
• Labs: 3,400+ partners, cashless; upload prescription (experts book tests) or book directly; reimbursement claim if already paid.
• Hospital: outpatient hospital procedures/daycare (separate from base-policy inpatient SI); use "Locate Now" for network hospitals.
• Wellness tab: earn coins via health activities, step/sleep goals (Activity Tracker → Start Tracking), uploading records to Repository (Health Files → Explore Now); coins from ALL members (incl. kids) pool together and redeem as renewal premium discount.
• Feature cards (plan-dependent): Companion Rider, Tele Consultation, Wellness Rewards, OP Rider (powers Doctor/Labs/Hospital/Pharmacy), Annual Health Check-up (once per policy year), Home Care Treatment.

KEY TERMS: Sum Insured = yearly max payout. Cashless = insurer pays hospital directly. PED waiting standard 36 mo; specified diseases 24 mo; initial 30 days (accidents exempt). Cumulative bonus = SI increase per claim-free year. Restoration = SI reinstated after exhaustion.`;
