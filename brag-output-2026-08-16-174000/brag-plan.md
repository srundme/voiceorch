# /brag plan — SnapServe Meeting Agents (1:1 LinkedIn feature film)

## Invocation

`/brag --format square --tone app-store --duration 24`
Feature launch: **SnapServe agents can now join Google Meet and Zoom — and present your slides.**

## Planning rubric

1. **What is it?** SnapServe — a voice-agent platform. New capability: Meeting bots. An agent
   joins an existing Meet / Zoom / Teams room as a real participant.
2. **Who is it for?** Founders and revenue teams who already run SnapServe phone agents and now
   want the same agent on video calls.
3. **What is the feature?** Three things, in order: (a) paste a Meet/Zoom link and the agent joins,
   (b) it's on camera, speaks and answers live, (c) it screenshares a deck and **advances the slides
   itself** via the `next_slide` / `goto_slide` tools.
4. **Why now?** Nobody's voice agent shows up to the meeting. This one does — and it presents.
5. **Hook (first 2s)?** The three-bar mark snaps together, then "YOUR AGENT / JOINS THE MEETING"
   with the Meet and Zoom marks landing under it.
6. **What UI do we show?** The real product plates, no mockups invented for the video:
   `01-snapserve-meet-ui` (Connections → Meeting bots), `02-gmeet-agent-live`,
   `03-zoom-agent-live`, `05-gmeet-agent-presenting`. These live in
   `artifacts/dashboard/public/brand/video/` and are the source of truth.
7. **Icons?** SnapServe only: the three-bar mark (`snapserve-logo-white.svg`) and the headset agent
   glyph (`snapserve-agent-icon.svg`). Google Meet and Zoom marks appear only where the product
   itself shows them — they name the rooms we join.
8. **Tone?** app-store / polished. Ink canvas, one idea per beat, big readable type, no confetti.
9. **Payoff?** "Meeting agents. Live now." + `app.snapserve.ai`.

## Format: square — 1080x1080

Square layout law: **headline zone on top (y 96–286), UI stage in the middle (960x540 at y 300),
caption zone at the bottom (y 880–1010).** The plates are 16:9; the stage crops and pushes into
them so product text stays readable at LinkedIn feed size, and the readable version of every
caption is re-typeset large in the bottom zone.

## Brand contract

| Token | Value | Source |
|---|---|---|
| Mark | three stacked bars, opacity 1 / .60 / .36 | `snapserve-logo-white.svg` (= user-supplied logo, white for dark canvas) |
| Wordmark | `Snap` 700 + `Serve` 400 | same |
| Agent glyph | headset robot | `snapserve-agent-icon.svg` |
| Canvas | `#07080C` ink | dark to match the Meet/Zoom plates |
| Accent (Meet beats) | `#8AB4F8` | plate 02 / 05 |
| Accent (Zoom beat) | `#4ADE80` | plate 03 |
| Slide surface | `#FFFFFF` / `#0F172A` type | plate 05 |

## Storyboard — 24.0s

| # | Time | Beat | On screen | Motion | SFX |
|---|---|---|---|---|---|
| 1 | 0.0–3.2 | Hook | Three-bar mark builds; `NEW` pill; "YOUR AGENT / JOINS THE MEETING"; Meet + Zoom marks | bars wipe in staggered, headline lines rise, marks pop with back-ease | bell |
| 2 | 3.2–7.4 | Join | Plate 01 cropped to "2. Join now (paste link)" | URL types into the field, cursor lands, Join button pulses, "In call" card ringed | click |
| 3 | 7.4–11.6 | Live in Meet | Plate 02, full frame with slow push | agent waveform bars animate, LIVE pill pulses, caption typed large below | soft impact |
| 4 | 11.6–14.6 | Live in Zoom | Plate 03, full frame | green waveform, TALKING pill pulse, caption swap | switch |
| 5 | 14.6–20.6 | **Presenting** | Plate 05 — beat A on the deck, beat B on the rail | curtains reveal kicker → title → bullets → chart; then pull to rail: `next_slide` flashes, `Slide 3 of 12` → `4 of 12`, footer `3 / 12` → `4 / 12` | soft impact + switch |
| 6 | 20.6–24.0 | Endcard | Mark + wordmark, "Meeting agents. Live now.", Meet · Zoom · Teams, app.snapserve.ai | mark rebuilds, tagline rises | bell |

Readability check: every headline holds ≥ 1.6s settled; every typed caption finishes ≥ 1.2s before
its cut; the two slide-counter flips hold 1.4s.

## Music cue guidance

`happy-beats-business-moves-vol-12` at 0.40. Scene cuts sit on the 3.2 / 7.4 / 11.6 / 14.6 / 20.6
grid; the presenting beat gets the longest hold so the `next_slide` flip lands in open air.
