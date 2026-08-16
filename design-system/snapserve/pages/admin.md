# Admin console — page overrides

> **PROJECT:** SnapServe
> **Page:** `artifacts/admin`
> Generated 2026-08-17, then **overridden** to match MASTER. Do not implement the raw UI UX Pro Max palette (slate `#0F172A`, status-green CTA `#22C55E`, Fira Code / Fira Sans).

Only deviations from `design-system/snapserve/MASTER.md` live here.

## Job

Internal ops + analytics + user control. Not a marketing page. Not the customer dashboard.

## Keep from MASTER

- Official three-bar mark, Tex Gyre Heros wordmark, Inter UI, JetBrains Mono
- Existing CSS tokens in `artifacts/admin/src/index.css` (same ink/paper + charcoal-blue as the product)
- No teal / status-green CTAs in chrome. Status green/amber/red only on live / warn / fail **data**
- Lucide already in this app — do not add a second icon family on one page
- Variance 3, motion 3–4, **density 9** (tighter than customer dashboard)

## IA (this is the redesign)

Six groups. Every existing user-connected route stays reachable.

| Group | Default | Contains |
|---|---|---|
| Today | Open | `/`, `/platform`, `/health`, `/deployments` |
| Analytics | Closed | Calls, funnel, usage, signups, board pack |
| Money | Closed | Finance, recharges, phone purchases, call pricing |
| Customers | Open | Users, partners, all agents — never hide |
| Control | Closed | Keys, numbers, voices, prompts, emails, calendar, settings, DPDP, audit |
| Labs | Closed | Workshops, Voice-a-thons, interns, Family Insurance |

Command palette (`⌘K` / `Ctrl+K`) must list **every** page, including Labs and user tools.

## Home (`/`)

Exception-first: live, queue, 24h calls, VoBiz, spikes (per-user), failed-reason strip, health lights. Lifetime totals stay **below** — do not delete user / call / minute KPIs. Spike alerts and user-wallet figures stay on the home.

## Chrome

- Grouped sidebar with visible section labels (fix the old `section` bug)
- Mobile drawer — do not hide nav with no alternative
- Visible focus rings on nav, search, and icon buttons
- `motion-safe:` only on live pings; honor `prefers-reduced-motion`
- Sticky header must not cover focus (`scroll-padding-top` on main)

## Reject

- New fonts or a second brand for admin
- Removing Users, Partners, All Agents, Emails, Signups, DPDP, or user spike alerts
- Flat 38-item sidebar
