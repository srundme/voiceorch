---
name: startup-fundraising
description: >-
  Build investor pitch decks (.pptx), advise on fundraising strategy, and apply
  seed/pre-seed best practices. Use when the user asks for a pitch deck, PPT/PPTX,
  fundraising help, pre-seed/seed/Series A guidance, SAFE/convertible notes,
  valuation, dilution, investor outreach, or when they share decks/KB to refine.
---

# Startup Fundraising & Pitch Decks

## When this skill applies

- Creating or rewriting pitch decks (especially `.pptx`)
- Pre-seed / seed / Series A–C fundraising questions
- Investor types, SAFE/notes, valuation, dilution, timelines
- User shares example decks or fundraising KB to absorb and reuse

**Always read the relevant reference files before drafting a deck or giving stage-specific advice.**

## Progressive disclosure (read on demand)

| Need | File |
|------|------|
| Funding stages, investor types, timelines, dilution, 2025 trends | [fundraising-stages.md](fundraising-stages.md) |
| Pre-seed deck structure (13 slides) + storytelling rules | [pre-seed-deck.md](pre-seed-deck.md) |
| Seed raise tactics (how much, SAFE, meetings, close) | [seed-fundraising.md](seed-fundraising.md) |
| Universal deck checklist + mistakes to avoid | [pitch-deck-checklist.md](pitch-deck-checklist.md) |

## Core principles (always)

1. **Story first, then numbers** — decks that win attention tell a narrative; diligence comes later.
2. **Stage-fit the deck** — pre-seed = vision + team; seed = product + early traction; Series A+ = unit economics + scale.
3. **Short & skimmable** — assume ~3 minutes of attention; ≤15–20 slides; ≤~30 words per slide for Western audiences.
4. **Legible fonts** — prefer Helvetica / clean sans; large headings; avoid decorative fonts.
5. **Be honest about risks** — sophisticated investors reward clarity over hype.
6. **Choose partners, not just checks** — capital + expertise + network + temperament.
7. **Living document** — refine from every pitch; tailor per investor when possible.

## Pitch deck workflow

Copy and track:

```
Deck progress:
- [ ] Confirm stage (pre-seed / seed / A / later) and audience region
- [ ] Read stage reference (pre-seed-deck.md or seed-fundraising.md)
- [ ] Collect company facts (problem, product, traction, ask, team)
- [ ] Outline slides for that stage
- [ ] Draft slide copy (sparse) + speaker notes if requested
- [ ] Build .pptx (python-pptx) with consistent brand
- [ ] Self-check against pitch-deck-checklist.md
```

### Stage → slide emphasis

| Stage | Lead with | De-emphasize |
|-------|-----------|--------------|
| Pre-seed | Problem, solution, why now, team, vision | Hard financials, scaled GTM |
| Seed | Product, traction, GTM, business model, ask | Long roadmap fiction |
| Series A+ | Metrics, unit economics, retention, expansion | Pure vision slides |

### Standard leave-behind order (seed+)

1. Cover / tagline  
2. Vision  
3. Problem  
4. Customer  
5. Solution (+ why now)  
6. Market (TAM/SAM with proof)  
7. Landscape / competition  
8. Traction  
9. Business model  
10. Team  
11. Summary takeaways  
12. Fundraising ask + use of funds  

For **pre-seed**, prefer the 13-slide structure in `pre-seed-deck.md` (team may move forward).

## Building `.pptx` files

Default stack: **python-pptx**.

```bash
pip install python-pptx   # if needed
python scripts/build_deck.py   # or inline script in the chat workspace
```

Design defaults unless user overrides:

- 16:9 widescreen (13.333" × 7.5")
- One idea per slide; strong visual hierarchy
- Brand color for trust/calm on cover (blue is fine if no brand palette)
- Screenshots / mockups over walls of text
- Charts only when the takeaway is obvious in one glance

Save output where the user asked (e.g. `artifacts/`, `docs/`, or Desktop). Prefer a clear filename: `Company-Stage-Pitch-YYYY-MM.pptx`.

## Fundraising mindset (remind founders)

- Relationships before asks  
- Best fundraising strategy = building a great business  
- Marathon: 3–6 months typical; keep 6+ months runway before next raise  
- Know numbers cold (CAC, LTV, burn, growth)  
- Get money in the bank fast once someone says yes — then get back to product  

## Anti-patterns (never do)

- Product-only decks with no business narrative  
- Unrealistic TAM without bottom-up proof  
- Jargon walls; reading slides aloud instead of storytelling  
- Claiming traction that isn’t real  
- Over-optimizing valuation at the expense of closing  
- Playing investors against each other without experience  
- Asking for NDAs in early intros  

## When user shares decks or KB

1. Extract reusable patterns (structure, tone, what worked).  
2. Update notes in this skill’s reference files only if the user asks to persist them.  
3. Apply patterns to the next deck without copying proprietary content verbatim.
