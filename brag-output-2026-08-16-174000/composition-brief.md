# Composition brief — SnapServe Meeting Agents (square)

- **Format:** square — 1080x1080, 24.0s, `data-composition-id="main"`
- **Runtime:** GSAP 3.14.2, single paused timeline on `window.__timelines["main"]`
- **Tone:** app-store / polished

## Structural rules

1. Six `<section class="clip">` scenes on `data-track-index="1"`, each wrapping its content in a
   `.scene-inner` div. Every scene exits by tweening `.scene-inner` to `opacity: 0` and is hard-set
   to `opacity: 0` at its own boundary — no stale visibility.
2. Audio on tracks 0 (music) and 8 (sfx).
3. **Plate system.** Each UI scene renders a `.stage` (960x540 rounded viewport at x60/y300) that
   contains a `.plate` sized exactly 1920x1080 with `transform-origin: 0 0`. The plate holds an
   `<img>` of the real SVG and any overlay elements positioned in *plate coordinates*, so overlays
   scale with the crop. Crop math: to centre source point `(cx, cy)` at scale `S`,
   `transform: translate(480 - S*cx, 270 - S*cy) scale(S)`.

   | Scene | Plate | Focus (cx, cy) | Scale in → out |
   |---|---|---|---|
   | 2 | `01-snapserve-meet-ui.svg` | (840, 574) | 0.86 → 0.98 |
   | 3 | `02-gmeet-agent-live.svg` | (960, 470) | 0.50 → 0.545 |
   | 4 | `03-zoom-agent-live.svg` | (960, 440) | 0.50 → 0.535 |
   | 5a | `05-gmeet-agent-presenting.svg` | (748, 510) | 0.62 → 0.68 |
   | 5b | `05-gmeet-agent-presenting.svg` | (1355, 540) | 0.85 (cut) |

4. **Overlay technique.** The plates are static SVG, so animated product moments are drawn as
   absolutely-positioned children of `.plate` that either sit on top (rings, ripples, highlights)
   or cover a baked region with a rect in the exact underlying fill and re-render it live:
   - plate 01: white cover over the URL field text, live-typed monospace URL + caret
   - plate 02: `#1F2A37` cover over the baked waveform, 7 live `#8AB4F8` bars
   - plate 03: `#1F2A24` cover, 7 live `#4ADE80` bars
   - plate 05: white curtains over the slide kicker / title / bullets / chart bars that retract to
     reveal; white covers over `3 / 12` and `Slide 3 of 12` re-rendered so they can flip to 4
5. **Square typography zones.** Headline block y 96–286, stage y 300–840, caption zone y 880–1010.
   Captions from the plates are re-typeset at 27px in the caption zone so they are legible in feed.
6. Contrast: all body copy ≥ #94A3B8 on `#07080C`; eyebrows use accent colours that clear AA.

## Scene copy

| Scene | Eyebrow | Headline | Caption zone |
|---|---|---|---|
| 1 | `NEW` | YOUR AGENT / JOINS THE MEETING | Google Meet · Zoom · Teams |
| 2 | CONNECTIONS · MEETING BOTS | Paste the link. | `https://meet.google.com/abc-defg-hij` → Join meeting |
| 3 | LIVE IN GOOGLE MEET | It's in the room. | "Sure — I can walk you through pricing and book a follow-up right now." |
| 4 | LIVE IN ZOOM | Same agent. Zoom too. | "I've noted that — I'll send the proposal and book your follow-up." |
| 5 | AGENT-DRIVEN SLIDES | And it presents your deck. | It calls `next_slide` itself — slide 3 of 12 → 4 of 12 |
| 6 | — | Meeting agents. Live now. | app.snapserve.ai |

## Delivery

`npm run check` to zero errors, render to `brag.mp4`, pick a poster from the presenting beat, bake
it as frame 0, write `share-copy.txt`.
