# SnapServe meeting-agent launch video — UI plates

1920x1080 PNG (flattened) + SVG (editable source) for every on-screen UI shot.
Import the PNGs into Hera as image layers; use the SVGs if you need to animate
individual elements (waveform bars, slide counter, badges).

| File | Scene |
| --- | --- |
| `01-snapserve-meet-ui` | SnapServe dashboard, Meeting bots page — paste a meeting link, agent joins |
| `02-gmeet-agent-live` | Google Meet call, agent on camera, speaking |
| `03-zoom-agent-live` | Zoom call, agent on camera, speaking |
| `05-gmeet-agent-presenting` | Google Meet, agent screensharing the deck and driving slides |
| `06-zoom-agent-presenting` | Zoom, agent screensharing the deck and driving slides |
| `04-endcard` | End card / CTA |

## Presenting scene (frames 05 / 06)

This matches the real product behaviour: the agent stays on camera for voice
while the deck goes out as a separate Recall screenshare, and the agent advances
slides itself via the `next_slide` / `previous_slide` / `goto_slide` tools.

Animate in this order:

1. Deck panel scales up from 96% with the "SnapServe Agent is presenting" pill
   sliding down from the top bar.
2. Slide body types/fades in: kicker, then headline lines, then bullets staggered
   ~120ms apart, then the bar chart growing from the baseline.
3. Agent tile ring pulses and the waveform bars animate while the caption line
   types out at the bottom.
4. Slide counter flips `3 / 12` to `4 / 12` while the "Agent slide control" card
   flashes `next_slide` — this is the beat that sells agent-driven presenting.

## Re-rendering PNGs from the SVGs

```bash
cd artifacts/dashboard/public/brand/video
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for f in *.svg; do
  "$CHROME" --headless --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=1 --window-size=1920,1080 \
    --screenshot="$PWD/${f%.svg}.png" "file://$PWD/$f"
done
```

Keep the SVG sources ASCII-only (use `&#8212;` and `&#183;` instead of literal
em dash / middle dot) — raw high bytes break the headless-Chrome XML parse.
