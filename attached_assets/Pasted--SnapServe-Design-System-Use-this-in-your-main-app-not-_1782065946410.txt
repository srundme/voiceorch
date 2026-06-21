# SnapServe Design System

Use this in your **main app** (not the landing page). Copy tokens, fonts, and config below.

---

## Fonts

Paste in your app `<head>` (or root layout):

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Plus+Jakarta+Sans:wght@500;600;700&display=swap"
  rel="stylesheet"
/>
```

| Role | Font | Weights |
|------|------|---------|
| Body / UI | Inter | 400, 500, 600, 700 |
| Headlines | Plus Jakarta Sans | 500, 600, 700 |
| Code / data / IDs | JetBrains Mono | 400, 500 |

---

## Color Palette

### Brand

| Name | Hex | Use |
|------|-----|-----|
| Saffron | `#FF9933` | Accents, warnings, gradient start |
| Teal | `#14B8A6` | Primary actions, links, selection, glow |
| Indigo | `#6366f1` | Gradient end |

**Brand gradient**
```css
linear-gradient(135deg, #FF9933 0%, #14B8A6 50%, #6366f1 100%)
```

### Surfaces — App shell

| Name | Hex | Use |
|------|-----|-----|
| Page | `#080808` | Dot-grid marketing background |
| Base | `#0a0a0a` | Main app background |
| Raised | `#111111` | Cards, panels |
| Card | `#111111` | Inner cards |
| Elevated | `#141414` | Hover / elevated panels |

### Surfaces — CRM / Dashboard (Memory UI)

| Name | Hex | Use |
|------|-----|-----|
| CRM bg | `#0b0f14` | Dashboard shell |
| CRM surface | `#0d1219` | Sidebar, header |
| CRM card | `#111820` | Inner dashboard cards |
| CRM muted | `#1a2535` | Avatars, icon backgrounds |
| CRM border | `#1e2a3a` | Dashboard borders |
| CRM accent | `#5b9fd4` | Dashboard links, icons |
| CRM label | `#5a6a7e` | Muted dashboard labels |

### Borders

| Name | Hex |
|------|-----|
| Default | `#27272a` |
| Subtle | `#1c1c1c` |
| Strong | `#3f3f46` |

### Text

| Name | Hex | Use |
|------|-----|-----|
| Primary | `#fafafa` | Headings, main body |
| Secondary | `#a1a1aa` | Descriptions |
| Muted | `#71717a` | Labels, captions |
| Faint | `#52525b` | Timestamps, meta |
| Disabled | `#3f3f46` | Disabled state |

### Semantic

| Name | Hex | Use |
|------|-----|-----|
| Success | `#22c55e` | Live, online, saved |
| Success muted | `rgba(34, 197, 94, 0.2)` | Success badges |
| Error | `#ef4444` | Errors, network drop |
| Error muted | `rgba(239, 68, 68, 0.1)` | Error backgrounds |
| Warning | `#FF9933` | Smart reconnect, alerts |
| Info | `#3b82f6` | Links in CRM, tabs |
| Star | `#fbbf24` | Favorites |

### Selection

```css
background: #14B8A6;
color: #0a0a0a;
```

---

## CSS Variables (copy entire block)

Save as `snapserve-tokens.css` and import in your app entry file.

```css
:root {
  /* Fonts */
  --font-sans: "Inter", system-ui, -apple-system, sans-serif;
  --font-display: "Plus Jakarta Sans", "Inter", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;

  /* Brand */
  --color-brand-saffron: #ff9933;
  --color-brand-teal: #14b8a6;
  --color-brand-indigo: #6366f1;
  --gradient-brand: linear-gradient(135deg, #ff9933 0%, #14b8a6 50%, #6366f1 100%);
  --gradient-brand-text: linear-gradient(135deg, #ff9933, #14b8a6, #6366f1);

  /* Surfaces */
  --color-bg-page: #080808;
  --color-bg-base: #0a0a0a;
  --color-bg-raised: #111111;
  --color-bg-card: #111111;
  --color-bg-elevated: #141414;
  --color-bg-hover: rgba(20, 184, 166, 0.03);

  /* CRM / Dashboard */
  --color-crm-bg: #0b0f14;
  --color-crm-surface: #0d1219;
  --color-crm-card: #111820;
  --color-crm-muted: #1a2535;
  --color-crm-border: #1e2a3a;
  --color-crm-accent: #5b9fd4;
  --color-crm-label: #5a6a7e;

  /* Borders */
  --color-border: #27272a;
  --color-border-subtle: #1c1c1c;
  --color-border-strong: #3f3f46;

  /* Text */
  --color-text-primary: #fafafa;
  --color-text-secondary: #a1a1aa;
  --color-text-muted: #71717a;
  --color-text-faint: #52525b;
  --color-text-disabled: #3f3f46;

  /* Semantic */
  --color-success: #22c55e;
  --color-success-muted: rgba(34, 197, 94, 0.2);
  --color-error: #ef4444;
  --color-error-muted: rgba(239, 68, 68, 0.1);
  --color-warning: #ff9933;
  --color-info: #3b82f6;
  --color-star: #fbbf24;

  /* Selection */
  --color-selection-bg: #14b8a6;
  --color-selection-text: #0a0a0a;

  /* Shadows */
  --shadow-glow-brand: 0 0 24px rgba(255, 153, 51, 0.2), 0 0 48px rgba(20, 184, 166, 0.12);
  --shadow-glow-brand-hover: 0 0 32px rgba(255, 153, 51, 0.35), 0 0 60px rgba(20, 184, 166, 0.2);
  --shadow-card: 0 32px 80px rgba(0, 0, 0, 0.5);

  /* Radius */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;
  --radius-full: 9999px;

  /* Typography */
  --text-xs: 0.6875rem;
  --text-sm: 0.8125rem;
  --text-base: 0.9375rem;
  --text-lg: 1.125rem;
  --text-xl: 1.25rem;
  --text-2xl: 1.5rem;
  --text-display: clamp(2.1rem, 4.5vw, 3.25rem);
  --leading-tight: 1.12;
  --leading-normal: 1.5;
  --leading-relaxed: 1.7;
  --tracking-tight: -0.035em;
  --tracking-normal: 0.02em;

  /* Motion */
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --duration-fast: 0.2s;
  --duration-normal: 0.4s;
}
```

---

## Base theme class

```css
.snapserve-theme {
  font-family: var(--font-sans);
  background-color: var(--color-bg-base);
  color: var(--color-text-primary);
  -webkit-font-smoothing: antialiased;
}

.snapserve-theme ::selection {
  background: var(--color-selection-bg);
  color: var(--color-selection-text);
}
```

Apply on root:
```html
<body class="snapserve-theme">
```

---

## Typography utilities

```css
.snapserve-headline-xl {
  font-family: var(--font-display);
  font-size: var(--text-display);
  font-weight: 600;
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-tight);
  color: var(--color-text-primary);
}

.snapserve-headline-lg {
  font-family: var(--font-display);
  font-size: clamp(2rem, 4vw, 3rem);
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: -0.03em;
  color: var(--color-text-primary);
}

.snapserve-body {
  font-size: var(--text-base);
  line-height: var(--leading-relaxed);
  color: var(--color-text-secondary);
}

.snapserve-label {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
  letter-spacing: var(--tracking-normal);
}

.snapserve-mono {
  font-family: var(--font-mono);
}

.snapserve-gradient-text {
  background: var(--gradient-brand-text);
  background-size: 200% auto;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
```

---

## Buttons

```css
.snapserve-btn-glow-wrap {
  display: inline-flex;
  border-radius: var(--radius-full);
  padding: 1.5px;
  background: var(--gradient-brand);
  background-size: 200% 200%;
  box-shadow: var(--shadow-glow-brand);
}

.snapserve-btn-glow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border-radius: var(--radius-full);
  background: #000;
  padding: 12px 24px;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-primary);
  border: none;
  cursor: pointer;
}

.snapserve-btn-outline {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border-radius: var(--radius-full);
  border: 1px solid var(--color-border-strong);
  background: transparent;
  padding: 12px 24px;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-primary);
  cursor: pointer;
}

.snapserve-btn-outline:hover {
  border-color: var(--color-brand-teal);
  background: rgba(20, 184, 166, 0.05);
}
```

---

## Cards & panels

```css
.snapserve-card {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

.snapserve-crm-card {
  background: var(--color-crm-card);
  border: 1px solid var(--color-crm-border);
  border-radius: var(--radius-md);
}

.snapserve-dot-bg {
  background-color: var(--color-bg-page);
  background-image: radial-gradient(circle, #1f1f1f 0.8px, transparent 0.8px);
  background-size: 18px 18px;
}
```

---

## Tailwind CSS v4

Add to `index.css`:

```css
@import "tailwindcss";

@theme {
  --font-sans: "Inter", system-ui, sans-serif;
  --font-display: "Plus Jakarta Sans", "Inter", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;

  --color-brand-saffron: #ff9933;
  --color-brand-teal: #14b8a6;
  --color-brand-indigo: #6366f1;

  --color-surface-page: #080808;
  --color-surface-base: #0a0a0a;
  --color-surface-raised: #111111;
  --color-surface-card: #111111;

  --color-crm-bg: #0b0f14;
  --color-crm-surface: #0d1219;
  --color-crm-card: #111820;
  --color-crm-border: #1e2a3a;
  --color-crm-accent: #5b9fd4;

  --color-border: #27272a;
  --color-border-strong: #3f3f46;

  --color-ink: #fafafa;
  --color-ink-secondary: #a1a1aa;
  --color-ink-muted: #71717a;
  --color-ink-faint: #52525b;

  --color-success: #22c55e;
  --color-error: #ef4444;
  --color-warning: #ff9933;
  --color-info: #3b82f6;
}
```

Usage:
```html
<div class="bg-surface-base text-ink font-sans">
<h1 class="font-display">
<div class="bg-crm-card border-crm-border">
<button class="bg-brand-teal text-ink">
```

---

## Tailwind CSS v3

```js
// tailwind.config.js
export default {
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        brand: {
          saffron: '#FF9933',
          teal: '#14B8A6',
          indigo: '#6366f1',
        },
        surface: {
          page: '#080808',
          base: '#0a0a0a',
          raised: '#111111',
          card: '#111111',
        },
        crm: {
          bg: '#0b0f14',
          surface: '#0d1219',
          card: '#111820',
          border: '#1e2a3a',
          accent: '#5b9fd4',
        },
        ink: {
          DEFAULT: '#fafafa',
          secondary: '#a1a1aa',
          muted: '#71717a',
          faint: '#52525b',
        },
        border: {
          DEFAULT: '#27272a',
          strong: '#3f3f46',
        },
        success: '#22c55e',
        error: '#ef4444',
      },
      borderRadius: {
        lg: '16px',
        xl: '24px',
      },
    },
  },
};
```

---

## React / JS theme object

```js
export const snapserveTheme = {
  fonts: {
    sans: '"Inter", system-ui, sans-serif',
    display: '"Plus Jakarta Sans", "Inter", system-ui, sans-serif',
    mono: '"JetBrains Mono", ui-monospace, monospace',
  },
  colors: {
    brand: { saffron: '#FF9933', teal: '#14B8A6', indigo: '#6366f1' },
    background: {
      page: '#080808',
      base: '#0a0a0a',
      card: '#111111',
      crm: '#0b0f14',
      crmCard: '#111820',
    },
    border: { default: '#27272a', crm: '#1e2a3a', strong: '#3f3f46' },
    text: {
      primary: '#fafafa',
      secondary: '#a1a1aa',
      muted: '#71717a',
      faint: '#52525b',
    },
    semantic: {
      success: '#22c55e',
      error: '#ef4444',
      warning: '#FF9933',
      info: '#3b82f6',
    },
  },
  gradient: {
    brand: 'linear-gradient(135deg, #FF9933 0%, #14B8A6 50%, #6366f1 100%)',
  },
  radius: { sm: 8, md: 12, lg: 16, xl: 24, full: 9999 },
};
```

---

## JSON tokens

```json
{
  "fonts": {
    "sans": "Inter",
    "display": "Plus Jakarta Sans",
    "mono": "JetBrains Mono"
  },
  "brand": {
    "saffron": "#FF9933",
    "teal": "#14B8A6",
    "indigo": "#6366f1"
  },
  "background": {
    "page": "#080808",
    "base": "#0a0a0a",
    "card": "#111111",
    "crm": "#0b0f14",
    "crmCard": "#111820"
  },
  "border": {
    "default": "#27272a",
    "crm": "#1e2a3a"
  },
  "text": {
    "primary": "#fafafa",
    "secondary": "#a1a1aa",
    "muted": "#71717a"
  },
  "semantic": {
    "success": "#22c55e",
    "error": "#ef4444",
    "warning": "#FF9933",
    "info": "#3b82f6"
  }
}
```

---

## Quick integration

### Vite / React
```js
// src/main.jsx
import './styles/snapserve-tokens.css';
```

### Next.js
```js
// app/layout.tsx
import '@/styles/snapserve-tokens.css';

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>{/* font links */}</head>
      <body className="snapserve-theme">{children}</body>
    </html>
  );
}
```

### Replit
1. Create `styles/snapserve-tokens.css` — paste CSS variables block above
2. Add font `<link>` tags to `index.html`
3. Import CSS in `main.jsx`
4. Add `class="snapserve-theme"` on `<body>`

---

## When to use which surface

| UI area | Background | Border | Text |
|---------|------------|--------|------|
| App shell | `#0a0a0a` | `#27272a` | `#fafafa` |
| Sidebar / nav | `#0a0a0a` | `#27272a` | `#a1a1aa` |
| Memory / CRM | `#0b0f14` | `#1e2a3a` | `#fafafa` |
| CRM cards | `#111820` | `#1e2a3a` | `#a1a1aa` |
| Primary button | `#14B8A6` | — | `#0a0a0a` or `#fafafa` |
| Glow CTA | gradient border | — | `#fafafa` on `#000` |

---

*SnapServe by AITEL — design tokens from landing page v1*
