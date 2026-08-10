# SnapServe brand kit

**Official visual identity** — logo, colors, type, and usage. No redesign; this freezes what the product already ships.

Product: [app.snapserve.ai](https://app.snapserve.ai)  
**PDF:** [`SnapServe-Brand-Kit.pdf`](./SnapServe-Brand-Kit.pdf)  
Assets: [`assets/`](./assets/)  
Print source: [`brand-guide.html`](./brand-guide.html)  
In-app components: `artifacts/dashboard/src/components/logo.tsx`  
CSS tokens: `artifacts/dashboard/src/index.css`

---

## Name

| Correct | Incorrect |
|---------|-----------|
| **SnapServe** | Snap Serve, Snapserve, SNAPSERVE, SnapServe AI as the legal product name in UI |

One word. Capital **S** on Snap and **S** on Serve.

---

## Mark

Three horizontal rounded bars (signal / equalizer), stacked and tapering in width and opacity.

| File | Use |
|------|-----|
| [`assets/snapserve-mark.svg`](./assets/snapserve-mark.svg) | Vector mark on light backgrounds (ink) |
| [`assets/snapserve-mark-white.svg`](./assets/snapserve-mark-white.svg) | Vector mark on dark backgrounds |
| [`assets/snapserve-icon.png`](./assets/snapserve-icon.png) | PNG icon (default / dark UI) |
| [`assets/snapserve-icon-light.png`](./assets/snapserve-icon-light.png) | PNG icon for light UI |
| [`assets/snapserve-mark.png`](./assets/snapserve-mark.png) | Larger PNG mark |

**Not brand:** `artifacts/dashboard/public/logo.svg` (green placeholder). Do not use it as the SnapServe logo.

---

## Wordmark

**Snap** (Bold / 700) + **Serve** (Regular / 400).

Preferred typeface: Tex Gyre Heros, then Helvetica, then Arial.

| File | Use |
|------|-----|
| [`assets/snapserve-wordmark.png`](./assets/snapserve-wordmark.png) | Wordmark for dark / default |
| [`assets/snapserve-wordmark-light.png`](./assets/snapserve-wordmark-light.png) | Wordmark for light UI |

Lockup = mark + wordmark side by side (see `BrandMark` in the dashboard).

---

## Color palette

### Product UI (chrome)

App primary is **ink / greyscale** — not teal or saffron.

| Role | Hex | Notes |
|------|-----|--------|
| Ink (primary) | `#0F172A` | ≈ HSL `222 28% 12%` — buttons, mark, wordmark on light |
| Paper / background | `#F4F7FA` | ≈ HSL `210 24% 97%` |
| Foreground / body | `#0F172A` | Near-ink text |
| Primary on dark | `#FAFAFA` | White primary buttons in dark mode |

### Marketing accents only

Do **not** use these as default app CTA chrome. OK for landing, posters, Voiceathon, gradients.

| Name | Hex | CSS token |
|------|-----|-----------|
| Saffron | `#FF9933` | `--color-brand-saffron` |
| Teal | `#14B8A6` | `--color-brand-teal` |
| Indigo | `#6366F1` | `--color-brand-indigo` |

**Brand gradient:** `linear-gradient(135deg, #FF9933 0%, #14B8A6 50%, #6366F1 100%)`

---

## Typography

| Role | Stack |
|------|--------|
| Wordmark | Tex Gyre Heros, Helvetica, Arial, sans-serif |
| App UI sans | Inter, system-ui |
| App display | Plus Jakarta Sans, Inter, system-ui |
| Mono | JetBrains Mono, SF Mono, Menlo, monospace |

---

## Clear space and size

- Leave clear space around the mark at least **½ the mark height** on all sides.
- Minimum mark size in UI: **16×16 px**; prefer **20–24 px** in nav.
- Do not stretch, skew, or rotate the mark.
- Do not add outlines, shadows, or gradients to the bars unless using the official marketing gradient as a *background* behind a mono mark.

---

## Do / Don’t

**Do**
- Use the three-bar mark + SnapServe wordmark from this kit.
- Keep product UI ink/white; reserve saffron/teal/indigo for marketing moments.
- Keep SnapServe first when co-branding with Sarvam.

**Don’t**
- Use the green `logo.svg` placeholder as SnapServe.
- Recolor the three bars to random brand colors without design review.
- Stack competing logos above SnapServe in a product lockup.
- Write “Snap Serve” as two words.

---

## Co-brand with Sarvam

SnapServe is the product; Sarvam is the family / powered-by partner.

| File | Use |
|------|-----|
| [`assets/snapserve-powered-by-sarvam.png`](./assets/snapserve-powered-by-sarvam.png) | Official “SnapServe powered by Sarvam” lockup (white text; invert for light backgrounds in CSS if needed) |

Also in app public: `snapserve-sarvam-family.png` (family co-brand art). Prefer the powered-by lockup in footers and certificates.

---

## In-app usage

| Component | Role |
|-----------|------|
| `SnapServeIcon` | Inline SVG three-bar mark (`currentColor`) |
| `SnapServeLogo` | Text wordmark (+ optional icon) |
| `BrandMark` | PNG icon + wordmark lockup |
| `SnapServeSarvamLockup` / `PoweredBySarvam` | Co-brand |

Share this folder (`docs/brand/`) as the single link for “SnapServe brand.”
