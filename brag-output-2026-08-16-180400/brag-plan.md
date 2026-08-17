# /brag plan — SnapServe Meeting Agents (morph, 1:1)

## Invocation

`/brag --format square --tone polished --duration 25`
User direction: black/grey logo palette, official fonts, continuous morph
(logo → agent → Meet → Zoom → Teams), 5/5 craft, SFX + stronger music.

## Planning rubric

1. **What is it?** SnapServe meeting bots — a voice agent that joins Meet / Zoom / Teams and presents slides.
2. **Who?** Founders and revenue teams already running SnapServe agents.
3. **Feature?** Paste a link, the agent walks in on camera, then screenshares and drives `next_slide`.
4. **Why now?** The agent is no longer phone-only.
5. **Hook?** The three-bar mark never cuts — it *becomes* the agent, then Meet, Zoom, Teams.
6. **UI?** Real plates: `01-snapserve-meet-ui`, `02-gmeet-agent-live`, `05-gmeet-agent-presenting`.
7. **Icons?** Official three-bar mark, official headset agent, official Meet/Zoom marks, geometric Teams mark.
8. **Tone?** Polished / cinematic. Black + grey only on the canvas. Product plates keep their native UI colour.
9. **Payoff?** Morph returns to the three-bar mark. "Meeting agents. Live now." `app.snapserve.ai`.

## Format: square — 1080x1080 — 25.0s

## Brand contract

| Token | Value | Source |
|---|---|---|
| Canvas | `#000000` | SnapServeLoader / logo lockup |
| Grey rungs | `#111111` / `#2A2A2A` / `#6B6B6B` | three-bar opacities 1 / .60 / .36 on black |
| Type | Tex Gyre Heros (wordmark) + Inter (UI) | `logo.tsx` |
| Mark | three bars, 88/72/56, rx 10 | `SnapServeIcon` |
| Agent | headset robot | `snapserve-agent-icon.svg` |

## Storyboard — 25.0s

Continuous morph lives on a persistent stage (never unmounts). Product scenes fade around it.

| # | Time | Beat | Motion | SFX |
|---|---|---|---|---|
| 1 | 0.00–1.60 | Logo | Bars wipe in, wordmark settles | bell 000 |
| 2 | 1.60–3.70 | → Agent | Liquid blob + blur cross-morph | switch + soft impact |
| 3 | 3.70–5.80 | → Meet | Same morph language | drop |
| 4 | 5.80–7.38 | → Zoom | Same | switch |
| 5 | 7.38–9.50 | → Teams | Same, then "ONE AGENT. EVERY ROOM." | bong |
| 6 | 9.50–14.20 | Join | Morph shrinks to chrome; plate 01 types URL, cursor clicks Join | card-slide, click, mouseclick |
| 7 | 14.20–18.20 | Live | Plate 02, waveform, caption types | soft impact |
| 8 | 18.20–22.20 | Presents | Plate 05, curtains, `next_slide` 3→4 | card-place + switch |
| 9 | 22.20–25.00 | End | Morph returns to centre, becomes the three-bar mark again | bell 003 |

## Music cue guidance

`happy-beats-business-moves-vol-11` @ 0.36. Morph landings lock to 1.60 / 3.70 / 5.80 / 7.38 / 9.50. Product in at 9.50. Presenting flip ~17.91. Endcard 22.65.

Audio-reactive treatment: subtle — hero glow opacity breathes with a sine (no waveform visualizer on the canvas).
