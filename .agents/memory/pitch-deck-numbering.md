---
name: SnapServe pitch-deck slide numbering
description: How slide order/numbers work in artifacts/pitch-deck and the gotcha when inserting a slide
---

# SnapServe pitch-deck slide numbering

Slides load by manifest `position` (sorted) in `src/data/slides-manifest.json`; the
component file is resolved via `filepath`. Routes are `/slide{position}`. So a file
named `SlideN.tsx` is NOT necessarily at position N — order is the manifest's job.

**Gotcha — inserting/reordering a slide is a two-place edit:**
1. Manifest: positions must be **contiguous 1..N, unique**, ids unique, every
   `src/pages/slides/*.tsx` referenced (no orphans). `run validate-slides` enforces all of this.
2. Each slide hardcodes its own **watermark number**, **section label number**, and
   **page counter** as literal strings in the JSX. These are NOT derived from the
   manifest — you must hand-edit them on every shifted slide or the deck shows
   duplicate/off-by-one numbers.

**Numbering convention (must stay consistent):**
- Page counter (`NN / total`) == manifest position. Total == slide count.
- Watermark (the big pale `letterSpacing:"-0.06em"` number) == page counter.
- Top-right section label number == **page counter minus 1**, because Slide1 is the
  unnumbered title slide. e.g. position/page 6 → section "05 — …"; position/page 14 → "13 — …".

**How to apply:** when editing the deck, change the manifest AND sweep all slides for
stale `/ <oldTotal>` page totals and wrong section/watermark numbers. To target the
watermark uniquely use the `"-0.06em" }}>NN</div>` context (that letterSpacing is unique
to the watermark). New slides use static JSX + inline styles (no `.map`), `&amp;` for
ampersands. Write the manifest with the `write` tool, never a shell heredoc (`$` in
descriptions like `$0.05` gets shell-expanded and corrupts the file).
