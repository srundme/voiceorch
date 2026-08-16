# SnapServe — locked design system

Generated with UI UX Pro Max, then **overridden** to match the live product.
Do not persist or implement the raw generator output. It invented recording-red `#DC2626`, waveform-blue `#2563EB`, and Plus Jakarta as chrome. Those are rejected.

## Product

Voice agents that join Google Meet / Zoom / Teams, talk on camera, present slides, run outbound campaigns, and book meetings. Stack: React + Vite + Tailwind + shadcn in `artifacts/dashboard`.

## Locked brand (never regenerate)

| Token | Value | Notes |
|---|---|---|
| Mark | Official three-bar logo | White on dark at opacities 1 / .60 / .36. Do not morph or redraw. |
| Wordmark | Tex Gyre Heros | `Snap` 700 / `Serve` 400. Fallback Helvetica / Arial. |
| UI type | Inter | `--app-font-sans`. Plus Jakarta is display-only, not a new family. |
| Mono | JetBrains Mono | Code, IDs, phone numbers. |
| Light chrome | Cool paper + ink | `--background: 210 24% 97%`, `--primary: 222 28% 12%`. No teal CTAs. |
| Dark chrome | Charcoal-blue + white primary | `--background: 222 24% 8%`, `--primary: 0 0% 98%`. |
| Radius | `0.625rem` | Existing `--radius`. |
| Marketing accents | Saffron / teal / indigo | Landing/docs only. Never app chrome. |

Source of truth for CSS: `artifacts/dashboard/src/index.css`.

## Keep from UI UX Pro Max

- **Style:** Minimalism & Swiss Style — grid, high contrast, geometric, essential. Light + dark.
- **Dials:** variance 3, motion 4, density 8 (dashboard). Marketing pages may drop density to 4–5.
- **Landing pattern:** Product Demo + Features — hero → product mock/video (click-to-play, captions, pause, reduced-motion static) → feature breakdown → optional comparison → CTA.
- **Effects:** 150–300ms hover, sharp/low shadows, no decoration for decoration.
- **Motion:** list stagger is fine on cards; **no `back.out` overshoot on tables**. Honor `prefers-reduced-motion`.
- **Icons:** Phosphor outline, one weight per layer. Lucide already in the app is acceptable — do not mix three families on one page. No emoji as icons.
- **Charts:** streaming area / ticker for live queue; executive summary cards for command center. Pause live charts when offscreen.
- **Stack:** shadcn `Table` for tabular data; Zod + FieldError for forms; virtualize lists over ~100 rows.

## Reject

- New palettes, new display fonts, AI purple/pink gradients on product chrome
- Glassmorphism / aurora / clay / neubrutalism as the app style
- Official headset agent icon in films unless the user reverses that
- Autoplay hero video without controls
- Toast-only form errors with no field links

## Where to use this skill on SnapServe

| Surface | File / area | Use the skill for |
|---|---|---|
| Marketing site | `pages/landing.tsx` | Feature-rich showcase, hero + demo, contrast, CTA hierarchy. Keep ink/paper. |
| Docs | `pages/docs/**` | Swiss type scale, sidebar active state, code-block contrast. |
| Onboarding | `pages/onboarding.tsx` | Step progress, focus, reduced-motion, one question per beat. |
| Agents builder | `pages/agents/**` | Form validation, error summary, chip semantics, dense settings. |
| Campaigns / batches | `pages/campaigns/**` | Tables, empty states, bulk actions, deep-link tabs. |
| Command center | `pages/command-center/**` | Real-time chart choice, live density, pause when hidden. |
| Calls / analytics | `pages/calls/**`, `pages/analytics.tsx` | Table overflow on mobile, virtualize, chart type. |
| Settings / wallet / KYC | `pages/settings/**`, `pages/wallet*.tsx`, `pages/kyc.tsx` | Trust forms, focus rings, error recovery. |
| Scheduling / book | `pages/scheduling/**`, `pages/book/**` | Booking UX, timezone clarity, keyboard. |
| WhatsApp / channels | `pages/whatsapp.tsx`, `pages/channels/**` | Inbox density, template cards, empty states. |
| New shadcn pieces | `components/ui/**` | Stack rules only — do not restyle tokens. |

## Do not use this skill for

- Hyperframes / LinkedIn brag films
- Replacing the three-bar or Tex Gyre Heros
- Inventing a second brand for dark studio vs dashboard

## How to invoke next time

```
Review the Agents builder for UX issues. Read design-system/snapserve/MASTER.md first.
Use ui-ux-pro-max domain searches. Do not change colors or fonts.
```

```
Polish the Campaigns table empty state and mobile overflow. Keep existing tokens.
```
