---
name: Radix Select phantom document scroll
description: Hidden position:absolute native <select> bubble in Radix/shadcn Select escapes overflow clips and stretches <html>, causing a phantom second scrollbar / trailing whitespace.
---

# Radix/shadcn Select phantom document scroll

shadcn/Radix `<Select>` renders a visually-hidden native `<select>` "bubble" with
`position: absolute` (for form participation). Its containing block is the nearest
*positioned* ancestor. In a full-height app-shell layout where the editor chain is
all `overflow-hidden` / `overflow-y-auto` but **no ancestor is `position: relative`**,
the bubble's containing block resolves all the way up to `<html>`. It is then laid
out at its static flow position (e.g. ~934px down, below the fold for a long form)
and **escapes every overflow clip**, stretching `documentElement.scrollHeight`
past the viewport. Result: a phantom document-level scroll → a second scrollbar +
trailing empty whitespace at the bottom, even though the legit inner content
scroller is fine.

**Fix:** give the scroll container (and/or its panel) `position: relative` (no
insets — zero visual change). The bubble's containing block becomes that element,
so it is contained and clipped instead of extending the document. Verified on the
agent editor: `documentElement.scrollHeight` dropped 935 → 720 (== viewport) with
exactly one remaining scroller.

**Why:** `overflow:hidden` only clips descendants whose containing block is that
element or below it. An absolutely-positioned descendant whose containing block is
an *ancestor* of the overflow box is NOT clipped by it.

**How to diagnose:** at the broken viewport, log `documentElement.scrollHeight` vs
`clientHeight`; enumerate elements with `getBoundingClientRect().bottom > innerHeight`
and check `position`. A 1px `position:absolute` `<select>` at a large `top` is the
tell. Tall-viewport screenshots are unreliable here (stitching artifacts) — rely on
720px + DOM measurement.

## Agent editor scroll architecture (VoiceOrch dashboard, /app/agents/:id)
- `artifacts/dashboard/src/pages/agents/builder.tsx`: `AgentBuilder` root is
  `flex h-full overflow-hidden`, so it exactly fills `layout.tsx`'s
  `flex-1 overflow-y-auto min-h-0` content area — the outer shell scroller never
  scrolls on this route (no "competing scroll owners" despite both having overflow).
- Each tab owns its OWN scroll region (`overflow-y-auto`), intentionally. Overview
  and Analysis are two-column (left pane scrolls, right Live Test / nav pane fixed),
  so a single outer scroll viewport is NOT viable — do not "consolidate" these into
  one scroller; that breaks the fixed-panel layout (a redesign, out of scope).
