# Dashboard Design Tokens — Landing Page Alignment

Use this doc to bring your SnapServe **dashboard app** up to the same visual quality as the **landing page**.

**Source of truth (landing):** `design-system/SNAPSERVE-DESIGN-SYSTEM.md` + `design-system/snapserve-tokens.css`

**Core idea:** The landing page uses a **dual-surface system** — pure black/zinc chrome for shell & navigation, navy CRM panels for data-heavy views. Your dashboard currently leans too blue-navy everywhere and uses softer borders. Match landing by splitting surfaces and tightening contrast.

---

## Quick diagnosis — why the app feels “below” the landing page

| Landing page does | Dashboard currently does | Fix |
|-------------------|--------------------------|-----|
| `#0a0a0a` shell + `#27272a` borders (crisp zinc) | Navy HSL everywhere (`#1e2a3a` borders on all chrome) | Black shell, zinc borders; reserve navy for CRM panels only |
| 4-tier text: `#fafafa` → `#a1a1aa` → `#71717a` → `#52525b` | Mostly primary + muted only | Add faint/meta tier for timestamps, table meta |
| `16px` card radius, pill CTAs with gradient glow | `14px` cards, flat primary buttons | Bump radius; add glow wrap on hero CTAs |
| `15px` body, `13px` labels, Plus Jakarta on headings | `16px` default, `13px` inputs, Inter everywhere | Adopt landing type scale |
| Teal hover wash `rgba(20,184,166,0.05)` on interactive rows | Dark blue accent wash | Swap accent hover to teal tint |
| Dot-grid + subtle brand glow on marketing sections | Flat navy background | Optional dot-bg on auth/marketing routes |

---

## Fonts

| Role | Current font stack | Change to |
|------|--------------------|-----------|
| Body / UI (`--font-sans`) | `Inter`, system-ui, sans-serif | **Keep** — no change |
| Headlines (`--font-display`) | `Plus Jakarta Sans`, Inter, sans-serif | **Keep** — use on page titles, section headers, empty states |
| Code / IDs (`--font-mono`) | `JetBrains Mono`, SF Mono, Menlo, monospace | **Keep** — no change |

**Google Fonts in `index.html`:** change weights to match landing:

```
Inter (400, 500, 600, 700) · Plus Jakarta Sans (500, 600, 700) · JetBrains Mono (400, 500)
```

Remove `Inter 300` unless you use it — landing doesn't.

---

## Brand Tokens (global — light + dark)

| Variable | Current value | Hex preview | Change to |
|----------|---------------|-------------|-----------|
| `--color-brand-saffron` | `#ff9933` | 🟧 orange | **Keep** `#ff9933` |
| `--color-brand-teal` | `#14b8a6` | 🟦 teal | **Keep** `#14b8a6` |
| `--color-brand-indigo` | `#6366f1` | 🟣 indigo | **Keep** `#6366f1` |
| `--gradient-brand` | `135deg, #ff9933 → #14b8a6 → #6366f1` | saffron→teal→indigo | **Keep** `linear-gradient(135deg, #ff9933 0%, #14b8a6 50%, #6366f1 100%)` |
| `--gradient-brand-text` | same, used for `.gradient-text` clip | | **Keep** — add `background-size: 200% auto` + slow shift animation on marketing headings only |

---

## Glow Shadows (global — light + dark)

| Variable | Current value | Change to |
|----------|---------------|-----------|
| `--shadow-glow-brand` | `0 0 24px rgba(255,153,51,0.2), 0 0 48px rgba(20,184,166,0.12)` | **Keep** |
| `--shadow-glow-brand-hover` | `0 0 32px rgba(255,153,51,0.35), 0 0 60px rgba(20,184,166,0.2)` | **Keep** |
| `--shadow-glow-teal` | `0 0 0 1px rgba(20,184,166,0.3), 0 0 16px rgba(20,184,166,0.15)` | `0 0 0 1px rgba(20,184,166,0.35), 0 0 20px rgba(20,184,166,0.12), 0 0 40px rgba(20,184,166,0.06)` |

---

## Dark Mode Palette (`.dark` — what you actually see in the app)

All values are `H S% L%` (HSL). Approx hex shown for reference.

### Surfaces

| Variable | HSL value | ≈ Hex | Used for | Change to |
|----------|-----------|-------|----------|-----------|
| `--background` | `215 31% 6%` | `#0b0f14` | Page / app shell bg | `0 0% 4%` → **`#0a0a0a`** (landing shell black) |
| `--card` | `215 31% 9%` | `#111820` | Cards, panels | **Keep** `215 31% 9%` → `#111820` (CRM card — matches landing Memory UI) |
| `--elevated` | `215 28% 10%` | `#141820` | Hover surfaces, table headers | `0 0% 8%` → **`#141414`** (neutral lift, less blue) |
| `--popover` | `215 33% 7%` | `#0d1219` | Dialogs, dropdowns, sidebar | **Keep** `215 33% 7%` → `#0d1219` |
| `--sidebar` | `215 33% 7%` | `#0d1219` | Sidebar background | `0 0% 4%` → **`#0a0a0a`** (match landing left nav — black, not navy) |
| `--input` | `215 28% 12%` | `#171f2b` | Input / select background | **Keep** `215 28% 12%` |
| `--secondary` | `215 28% 13%` | `#19202d` | Secondary button bg | `0 0% 7%` → **`#111111`** (landing raised surface) |
| `--muted` | `215 31% 15%` | `#1a2535` | Muted surface (avatar bg, etc.) | **Keep** `215 31% 15%` |
| `--accent` | `173 60% 12%` | `#0d2422` | Hover wash on rows/items | `173 79% 40% / 0.06` → **`rgba(20,184,166,0.06)`** (landing row hover) |

### Borders

| Variable | HSL value | ≈ Hex | Used for | Change to |
|----------|-----------|-------|----------|-----------|
| `--border` | `215 32% 17%` | `#1e2a3a` | All component borders | `240 4% 16%` → **`#27272a`** (landing bento border — biggest visual upgrade) |
| `--sidebar-border` | `215 32% 14%` | `#18233a` | Sidebar border | `240 4% 16%` → **`#27272a`** |
| `--primary-border` | `rgba(20,184,166,0.25)` | teal/25% | Primary button border | **Keep** |
| `--secondary-border` | `rgba(255,255,255,0.06)` | white/6% | Secondary button border | `240 4% 25%` → **`#3f3f46`** (landing outline-btn border) |
| `--accent-border` | `rgba(20,184,166,0.12)` | teal/12% | Accent border | `rgba(20,184,166,0.20)` |
| `--destructive-border` | `rgba(200,70,70,0.30)` | red/30% | Destructive border | `rgba(239,68,68,0.35)` → match landing `#ef4444` |

**Add CRM-specific border** (for Memory/CRM views only — don't replace `--border` globally inside CRM):

```css
--crm-border: 215 32% 17%; /* #1e2a3a — use on nested CRM cards */
```

### Text

| Variable | HSL value | ≈ Hex | Used for | Change to |
|----------|-----------|-------|----------|-----------|
| `--foreground` | `0 0% 98%` | `#fafafa` | Primary text, headings | **Keep** |
| `--card-foreground` | `0 0% 98%` | `#fafafa` | Text on cards | **Keep** |
| `--popover-foreground` | `0 0% 98%` | `#fafafa` | Text in dialogs/dropdowns | **Keep** |
| `--muted-foreground` | `240 4% 64%` | `#a1a1aa` | Secondary text, labels, captions | **Keep** — use for descriptions |
| `--secondary-foreground` | `0 0% 90%` | `#e5e5e5` | Secondary button text | **Keep** |
| `--accent-foreground` | `0 0% 98%` | `#fafafa` | Text on accent surfaces | **Keep** |
| `--sidebar-foreground` | `0 0% 86%` | `#dbdbdb` | Sidebar nav text | `240 4% 64%` → **`#a1a1aa`** (landing nav muted) |
| `--sidebar-accent-foreground` | `0 0% 96%` | `#f5f5f5` | Sidebar active item text | **Keep** `#fafafa` |

**Add custom token** (not in shadcn by default — map in Tailwind):

```css
--text-faint: 240 4% 46%; /* #71717a — section labels */
--text-meta: 240 4% 35%;  /* #52525b — timestamps, IDs, table meta */
```

### Primary (buttons, active states, links)

| Variable | HSL value | ≈ Hex | Used for | Change to |
|----------|-----------|-------|----------|-----------|
| `--primary` | `173 79% 40%` | `#14b8a6` teal | Primary buttons, active nav, ring | **Keep** |
| `--primary-foreground` | `0 0% 4%` | `#0a0a0a` | Text on primary buttons | **Keep** — landing uses dark text on teal fills |
| `--ring` | `173 79% 40%` | `#14b8a6` teal | Focus ring on inputs/selects | **Keep** |
| `--sidebar-primary` | `173 79% 40%` | `#14b8a6` teal | Sidebar active item bg | Change to **`173 79% 40% / 0.15`** — teal tint bg, not solid fill (landing nav style) |
| `--sidebar-primary-foreground` | `0 0% 4%` | `#0a0a0a` | Text on active sidebar item | `0 0% 98%` → **`#14b8a6`** text on active nav (landing pattern) |
| `--sidebar-ring` | `173 79% 40%` | `#14b8a6` teal | Sidebar focus ring | **Keep** |

### Semantic

| Variable | HSL value | ≈ Hex | Used for | Change to |
|----------|-----------|-------|----------|-----------|
| `--destructive` | `0 65% 54%` | `#e05050` | Error/delete buttons | `0 84% 60%` → **`#ef4444`** (landing error) |
| `--destructive-foreground` | `0 0% 98%` | `#fafafa` | Text on destructive buttons | **Keep** |

### Charts

| Variable | HSL value | ≈ Hex | Change to |
|----------|-----------|-------|-----------|
| `--chart-1` | `173 79% 55%` | `#1de8d5` teal | **Keep** — brand teal |
| `--chart-2` | `206 80% 56%` | `#2fa3e8` blue | **Keep** — CRM accent family |
| `--chart-3` | `239 68% 67%` | `#7c82f0` indigo | **Keep** — brand indigo |
| `--chart-4` | `37 100% 60%` | `#ffaa1a` saffron | `33 100% 60%` → **`#ff9933`** (exact brand saffron) |
| `--chart-5` | `215 32% 30%` | `#334459` muted blue | `240 4% 35%` → **`#52525b`** (landing faint text — for gridlines/axis) |

### Card Shadows

| Variable | Current value | Change to |
|----------|---------------|-----------|
| `--shadow-card` | `0 1px 3px rgba(0,0,0,0.8), 0 0 0 1px rgba(30,42,58,0.8)` | `0 1px 3px rgba(0,0,0,0.85), 0 0 0 1px rgba(39,39,42,0.95)` |
| `--shadow-card-hover` | `0 4px 20px rgba(0,0,0,0.7), 0 0 0 1px rgba(20,184,166,0.15)` | `0 4px 24px rgba(0,0,0,0.65), 0 0 0 1px rgba(20,184,166,0.22), 0 0 32px rgba(20,184,166,0.06)` |

---

## Light Mode Palette (`:root` — only used if dark class is removed)

> The app currently forces dark mode. Update these only if you add light mode later.

| Variable | HSL value | ≈ Hex | Change to |
|----------|-----------|-------|-----------|
| `--background` | `220 20% 96%` | `#f2f4f8` | **Keep** (fine for future light mode) |
| `--foreground` | `220 14% 10%` | `#171a1f` | **Keep** |
| `--border` | `220 14% 88%` | `#dfe2e8` | **Keep** |
| `--card` | `0 0% 100%` | `#ffffff` | **Keep** |
| `--elevated` | `220 14% 94%` | `#eceff4` | **Keep** |
| `--primary` | `220 14% 12%` | `#1c2029` dark | `173 79% 40%` → **`#14b8a6`** (use brand teal in light mode too) |
| `--ring` | `220 9% 55%` | `#8a8f9c` | `173 79% 40%` → **`#14b8a6`** |

---

## Radius

| Variable | Current value | Change to |
|----------|---------------|-----------|
| `--radius` | `0.625rem` (10px base) | **`1rem` (16px base)** — landing uses 16px as the card default |
| Cards use | `14px` hardcoded | **`16px`** (`var(--radius)` or `rounded-2xl`) |
| Inputs / buttons use | `9px` hardcoded | **`10px`** for form controls; **`9999px`** (pill) for primary/marketing CTAs |
| Popover / dialogs use | `12px` hardcoded | **Keep `12px`** (`rounded-xl`) |

---

## Special / Utility Colors (hardcoded in component classes)

| Class | Property | Current value | Change to |
|-------|----------|---------------|-----------|
| `::selection` background | | `#14b8a6` teal | **Keep** |
| `::selection` text | | `#0a0a0a` | **Keep** |
| `.status-dot-active` | bg | `#22c55e` green | **Keep** |
| `.status-dot-inactive` | bg | `rgba(255,255,255,0.08)` | **Keep** |
| `.status-dot-live` | bg | `#14b8a6` teal + pulse | **Keep** |
| `.dot-bg` page bg | | `#080808` | **Keep** |
| `.dot-bg` dot color | | `#1f1f1f` | **Keep** — `18px` grid spacing |
| `.btn-glow-inner` bg | | `#000000` | **Keep** |
| `.btn-glow-inner` text | | `#fafafa` | **Keep** |
| Scrollbar thumb | | `hsl(var(--border))` | **Keep** — will auto-improve when `--border` → `#27272a` |

---

## Typography Scale (body styles)

| Property | Current value | Change to |
|----------|---------------|-----------|
| Base font size | browser default (16px) | **`0.9375rem` (15px)** — landing body size |
| Body letter-spacing | `-0.01em` | **Keep** |
| Table header font-size | `10px`, `600`, `uppercase`, `0.09em spacing` | **`11px`**, `600`, `uppercase`, **`0.05em`** — landing label style |
| Badge font-size | `10px`, `600`, `0.05em spacing` | **`11px`**, `600`, `0.05em` |
| Input font-size | `13px` | **Keep `13px`** (`0.8125rem`) |
| Button font-size | `13px`, weight `500`, `-0.01em spacing` | **`14px`**, weight **`500`**, `-0.01em` — landing CTA size |
| Page title font | Inter | **`Plus Jakarta Sans`**, `600`, `-0.03em` letter-spacing |

---

## Drop-in CSS block for `globals.css`

Paste inside `.dark { ... }` (shadcn) or replace existing token block:

```css
.dark {
  /* Surfaces — landing dual system */
  --background: 0 0% 4%;           /* #0a0a0a shell */
  --foreground: 0 0% 98%;
  --card: 215 31% 9%;              /* #111820 CRM card */
  --card-foreground: 0 0% 98%;
  --popover: 215 33% 7%;           /* #0d1219 */
  --popover-foreground: 0 0% 98%;
  --primary: 173 79% 40%;          /* #14b8a6 */
  --primary-foreground: 0 0% 4%;
  --secondary: 0 0% 7%;              /* #111111 */
  --secondary-foreground: 0 0% 90%;
  --muted: 215 31% 15%;            /* #1a2535 */
  --muted-foreground: 240 4% 64%;    /* #a1a1aa */
  --accent: 173 79% 40%;
  --accent-foreground: 0 0% 98%;
  --destructive: 0 84% 60%;        /* #ef4444 */
  --destructive-foreground: 0 0% 98%;
  --border: 240 4% 16%;            /* #27272a ← key change */
  --input: 215 28% 12%;
  --ring: 173 79% 40%;
  --radius: 1rem;

  /* Sidebar — black chrome like landing */
  --sidebar: 0 0% 4%;
  --sidebar-foreground: 240 4% 64%;
  --sidebar-primary: 173 79% 40%;
  --sidebar-primary-foreground: 173 79% 40%;
  --sidebar-accent: 173 79% 40%;
  --sidebar-accent-foreground: 0 0% 98%;
  --sidebar-border: 240 4% 16%;
  --sidebar-ring: 173 79% 40%;

  /* Charts — brand aligned */
  --chart-1: 173 79% 55%;
  --chart-2: 206 80% 56%;
  --chart-3: 239 68% 67%;
  --chart-4: 33 100% 60%;
  --chart-5: 240 4% 35%;

  /* Custom — landing text tiers */
  --text-faint: 240 4% 46%;
  --text-meta: 240 4% 35%;
  --crm-border: 215 32% 17%;

  /* Shadows */
  --shadow-card: 0 1px 3px rgba(0,0,0,0.85), 0 0 0 1px rgba(39,39,42,0.95);
  --shadow-card-hover: 0 4px 24px rgba(0,0,0,0.65), 0 0 0 1px rgba(20,184,166,0.22), 0 0 32px rgba(20,184,166,0.06);
  --shadow-glow-brand: 0 0 24px rgba(255,153,51,0.2), 0 0 48px rgba(20,184,166,0.12);
  --shadow-glow-brand-hover: 0 0 32px rgba(255,153,51,0.35), 0 0 60px rgba(20,184,166,0.2);
  --shadow-glow-teal: 0 0 0 1px rgba(20,184,166,0.35), 0 0 20px rgba(20,184,166,0.12), 0 0 40px rgba(20,184,166,0.06);
}

/* Accent hover — landing row wash */
.dark .hover\:bg-accent:hover,
.dark [data-highlighted] {
  background-color: rgba(20, 184, 166, 0.06) !important;
}

/* Active sidebar — teal text, not solid pill */
.dark [data-active="true"] {
  background-color: rgba(20, 184, 166, 0.08);
  color: #14b8a6;
}
```

---

## Surface usage map (landing parity)

| UI area | Background | Border | Text primary | Text secondary |
|---------|------------|--------|--------------|----------------|
| App shell / layout | `#0a0a0a` | `#27272a` | `#fafafa` | `#a1a1aa` |
| Sidebar | `#0a0a0a` | `#27272a` | `#a1a1aa` inactive / `#14b8a6` active | — |
| CRM / Memory views | `#0b0f14` | `#1e2a3a` | `#fafafa` | `#a1a1aa` |
| CRM inner cards | `#111820` | `#1e2a3a` | `#fafafa` | `#71717a` labels |
| Table meta / timestamps | — | — | — | `#52525b` |
| Primary button | `#14b8a6` | — | `#0a0a0a` | — |
| Glow CTA (onboarding) | `#000` inner | gradient border | `#fafafa` | — |
| Outline button | transparent | `#3f3f46` → `#14b8a6` hover | `#fafafa` | — |

---

## Component checklist (beyond tokens)

Tokens alone won't fully match landing quality. Also update:

- [ ] **Page titles** → `font-display` (Plus Jakarta Sans), `text-2xl`, `-tracking-wide`
- [ ] **Section labels** → `text-[11px] uppercase tracking-wider text-[#71717a]` (`.label` on landing)
- [ ] **Data tables** → header row `bg-[#141414]`, borders `#27272a`, mono for IDs
- [ ] **Cards** → `rounded-2xl` (16px), `border-[#27272a]` on shell cards, `border-[#1e2a3a]` on CRM cards
- [ ] **Primary CTA** on empty states → gradient glow wrap (copy `.glow-btn-wrap` from landing `index.css`)
- [ ] **Inputs** → `bg-[#171f2b]` on CRM views, `border-[#27272a]`, focus ring teal
- [ ] **Badges** → `11px`, `font-semibold`, success `#22c55e/20` bg
- [ ] **Remove** flat equalizer/waveform decorations unless they're on-brand SVG curves
- [ ] **Auth / onboarding routes** → optional `.dot-bg` background

---

## Copy-paste prompt for your dashboard repo

Paste this into Cursor (or send to your dev) with `snapserve-tokens.css` attached:

```
Align the SnapServe dashboard UI to match our landing page design system.

Reference files:
- design-system/DASHBOARD-TOKEN-MIGRATION.md (token diff — apply all "Change to" values)
- design-system/snapserve-tokens.css (source CSS variables)
- design-system/SNAPSERVE-DESIGN-SYSTEM.md (full spec)

Goals:
1. Dual-surface system: black/zinc shell (#0a0a0a, #27272a borders) + navy CRM panels (#0b0f14, #111820, #1e2a3a borders) only inside Memory/CRM views.
2. Update globals.css / tailwind.config dark theme HSL tokens per DASHBOARD-TOKEN-MIGRATION.md.
3. Sidebar: black background, zinc border, active nav = teal text on teal/8% bg (not solid teal pill).
4. Typography: 15px body, Plus Jakarta Sans on page titles, 11px uppercase section labels, 4-tier gray text (#fafafa / #a1a1aa / #71717a / #52525b).
5. Radius: 16px cards, 10px inputs, pill shape on primary marketing CTAs.
6. Card hover: teal rim glow per --shadow-card-hover.
7. Import snapserve-tokens.css and use .snapserve-btn-glow-wrap for hero empty-state CTAs.
8. Do not change business logic — tokens, Tailwind theme, and component classNames only.

Work through: globals.css → tailwind.config → sidebar → card components → tables → buttons → page headers. Run the app and verify shell feels like landing bento grid, CRM sections feel like MemoryCRMDashboard on landing.
```

---

## Files to copy from landing repo → dashboard repo

| File | Action |
|------|--------|
| `design-system/snapserve-tokens.css` | Copy to `src/styles/snapserve-tokens.css`, import in `main.tsx` |
| `design-system/snapserve-tokens.json` | Optional — for programmatic theme |
| Landing `src/index.css` | Copy `.glow-btn-wrap`, `.outline-btn`, `.label`, `.dot-bg` utilities |
| Google Fonts link | Update `index.html` weights |

---

*Generated from SnapServe landing page — June 2026*
