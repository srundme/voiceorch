# Composition brief — SnapServe morph (square)

- **Format:** square 1080x1080, 25.0s, `data-composition-id="main"`
- **Runtime:** GSAP 3.14.2, one paused timeline on `window.__timelines["main"]`
- **Tone:** polished

## Structural rules

1. Persistent `#morph` clip (0–25s, track 2) never unmounts. Icon changes are
   in-place morphs: shared grey blob scales up as a bridge, outgoing icon
   `scale 1→0.78` + `blur 0→14` + fade, incoming icon the reverse, same origin.
   No clip swap, no hard cut, no jump.
2. Product scenes on track 1 wrap content in `.scene-inner`. Exit by tweening
   that inner to opacity 0, then hard-set at the boundary.
3. Canvas is black + grey only. No blue wash. Product plates keep native UI colour.
4. Wordmark uses `Tex Gyre Heros` (declared via `@font-face` local + Inter fallback).
   Body uses Inter. Mono uses JetBrains Mono.
5. Audio: music track 0; each overlapping SFX on its own track 8+.

## Morph sequence (same 280px stage, centre)

logo (3 bars) → agent → Meet → Zoom → Teams → (shrinks to chrome) → returns as logo

## Product plates

Same crop/overlay system as the previous cut. Captions re-typeset in the bottom zone.

## Delivery

`npm run check` zero errors → render `brag.mp4` → poster from the settled logo
or presenting flip → bake frame 0 → `share-copy.txt`.
