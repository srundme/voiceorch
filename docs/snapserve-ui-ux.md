# SnapServe AI: UI and UX specification

How the SnapServe product looks and behaves today, page by page, as built in the code. Covers the customer dashboard (`artifacts/dashboard`), its public pages and docs site, and the internal admin app (`artifacts/admin`).

Status: describes the code as of 1 Oct 2026. Where something exists in code but is not reachable, it is listed under [Known gaps](#14-known-gaps-and-inconsistencies).

---

## Contents

1. [Product surfaces](#1-product-surfaces)
2. [Design system](#2-design-system)
3. [App shell and layout](#3-app-shell-and-layout)
4. [Navigation and routing](#4-navigation-and-routing)
5. [Sign-in and onboarding](#5-sign-in-and-onboarding)
6. [Build pages](#6-build-pages): Home, Agents, Knowledge, Memory, Squads, Vibe Studio
7. [Deploy pages](#7-deploy-pages): Phone numbers, Campaigns, Google Sheets calls, Flows, Connections, WhatsApp, Meta Lead Ads, Bookings, Meeting bots
8. [Monitor pages](#8-monitor-pages): Call logs, Call detail, Callbacks, Transfers, Analytics
9. [Settings pages](#9-settings-pages): Developers, Workspace and Team, Providers and Voices, Billing
10. [Partner (reseller) pages](#10-partner-reseller-pages)
11. [Public pages](#11-public-pages): sign-in, booking, events, workshop, legal, landing
12. [Docs site](#12-docs-site)
13. [Admin app](#13-admin-app)
14. [Known gaps and inconsistencies](#14-known-gaps-and-inconsistencies)
15. [Cross-cutting UX rules](#15-cross-cutting-ux-rules)

---

## 1. Product surfaces

| Surface | Where | Who | Theme |
|---|---|---|---|
| Customer dashboard | `app.snapserve.ai/app/*` | Customers, team members, partner clients | Light by default, dark available |
| Public pages | `/`, `/sign-in`, `/book/*`, `/events/*`, `/workshop/*`, `/join/*`, `/privacy`, `/terms` | Anyone | Mixed (see each page) |
| Docs and API reference | `/docs/*` | Developers (SnapServe host only) | Always light, slate |
| Admin app | separate app (`artifacts/admin`) | SnapServe staff | Dark by default |
| White-label portals | partner custom domains | Partner clients | Partner logo and name over the same dashboard |

Stack: React, Vite, Tailwind CSS v4, shadcn/ui (Radix, "new-york" style), wouter router, TanStack Query, Recharts, framer-motion, lucide-react icons, React Flow (`@xyflow/react`) for flows.

---

## 2. Design system

Source: `artifacts/dashboard/src/index.css`, `artifacts/dashboard/index.html`, `artifacts/dashboard/components.json`. There is no `tailwind.config.js`; Tailwind v4 maps CSS variables through `@theme inline`.

### 2.1 Design direction

- **Calm, ink-on-paper product UI.** Light "cool paper" background, near-black ink for primary buttons, greyscale charts. Colour is reserved for status.
- **Marketing colours are separate.** Saffron, teal and indigo gradients exist only for marketing surfaces, never for product controls.
- **Dark mode** is charcoal with an inverted primary (white buttons, dark text).

### 2.2 Colour tokens (HSL)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `210 24% 97%` | `222 24% 8%` | Page background |
| `--foreground` | `222 28% 12%` | `210 20% 96%` | Body text |
| `--card` | `0 0% 100%` | dark surface | Cards, panels |
| `--elevated` | `210 20% 95%` | dark raised | Table headers, raised strips |
| `--primary` / `--primary-foreground` | ink / white | `0 0% 98%` / `222 28% 8%` | Primary buttons |
| `--secondary` | `210 18% 94%` | dark | Secondary buttons |
| `--muted` / `--muted-foreground` | `210 16% 93%` / `215 16% 30%` | dark | Quiet fills, helper text |
| `--accent` | `210 16% 92%` | dark | Hover fills |
| `--border` | `214 18% 86%` | dark | Hairlines |
| `--input` | `214 16% 88%` | dark | Field borders |
| `--ring` | `222 14% 40%` | dark | Focus ring |
| `--destructive` | `0 72% 48%` | red | Delete, errors |
| `--sidebar` | `210 22% 96%` | dark | Sidebar surface |
| `--chart-1` … `--chart-5` | greyscale ink ramp | light-to-dark greys | Charts |
| `--text-faint` / `--text-meta` | `215 14% 36%` / `215 12% 28%` | | Meta text |

Marketing only: `--color-brand-saffron #ff9933`, `--color-brand-teal #14b8a6`, `--color-brand-indigo #6366f1`, plus gradient and glow shadows.

### 2.3 Status colour language

The same meaning is used everywhere (badges, dots, chips):

| Meaning | Colour | Examples |
|---|---|---|
| Success, live, ready | Emerald | Completed call, Active campaign, Connected, Ready, Verified KYC, Listed voice |
| In progress | Blue (pulsing) | Call in progress |
| Waiting, warning | Amber | Calling (pulsing), Pending, Paused, Pending invite, Low wallet, Callback badge |
| Failed, blocking | Red / destructive | Failed, Renewal unpaid, No phone, Validation error |
| Booked | Violet | Booked outcome, WhatsApp "received" |
| Transferred, callback | Orange | Transferred, Callback requested |
| Neutral, inactive | Muted grey | Draft, Cancelled, Stopped, Archived |

WhatsApp message status: pending (muted), sent (sky), delivered (emerald), read (teal), failed (red), received (violet).

### 2.4 Typography

| Role | Font | Loaded weights |
|---|---|---|
| UI text (`--app-font-sans`) | Inter | 400 to 700, optical size 14 to 32 |
| Display (`--app-font-display`) | Plus Jakarta Sans | 500 to 700 |
| Code, IDs, numbers (`--app-font-mono`) | JetBrains Mono | 400, 500 |
| Serif (rare) | Georgia | system |

Scale in use: page title 24px (26px on larger screens), page description 14px, buttons 14px, inputs 13px, table headers 11px uppercase on the elevated background. Phone numbers, call IDs and API keys are set in mono.

### 2.5 Shape, depth and motion

- **Radius:** `--radius` 10px (`0.625rem`). Cards 16px, popovers, dialogs and sheets 12px, inputs and buttons 10px.
- **Shadows:** `--shadow-card`, `--shadow-card-hover` (cards lift on hover), `--shadow-popover`.
- **Glass:** popovers, dialogs and sheets use a light backdrop blur (`.glass-surface`).
- **Motion:** custom `fade-in`, `slide-in-left`, `pulse`, `voice-bar-pulse`; `tw-animate-css` utilities (`animate-in fade-in zoom-in-95` on sign-in); framer-motion for the onboarding wizard and Vibe Studio.
- **Touch:** `.touch-target` gives 44px minimum targets under 767px; `.pb-safe` respects the iPhone home indicator.

### 2.6 Theme

- Light is the default (chosen for outdoor readability). Options: Light, Dark, System.
- Stored in `localStorage` key `snapserve-ui-theme-v3` and synced to the server preferences, so the choice follows the user across devices.
- A script in `index.html` sets the `dark`/`light` class before first paint, so there is no flash.
- Toggles: the sun/moon button in the top utility strip and "Light/Dark appearance" in the user menu. "System" is in Workspace settings → Appearance.

### 2.7 Component library

Primitives in `artifacts/dashboard/src/components/ui/`: alert-dialog, badge, button, card, checkbox, command (cmdk), dialog, dropdown-menu, form (react-hook-form), input, label, popover, progress, scroll-area, select, sheet, skeleton, slider, switch, table, tabs, textarea, toast/toaster, tooltip. Decorative: dot-grid-background, dotted-surface, silk-aurora (WebGL), siri-wave (voice visual).

Shared product components:

| Pattern | Component | Notes |
|---|---|---|
| Page shell | `StripePage`, `StripeTabPage` | Title, description, back link, tabs, actions; see 3.4 |
| Empty states | `EmptyState` (hero, panel, inline), `PageHero`, `GhostEmpty` | Every list has one |
| Metrics | `MetricStrip`, `MetricCard` | 4-up stat tiles |
| Upsell moments | `MomentCard` | e.g. low-balance prompt |
| Status | `StatusDot` (`components/workspace`) | success, danger, warning, neutral |
| Tables | `ui/table` | Desktop tables collapse to cards on mobile |
| Detail drawer | `CallDetailDrawer` | Opens call detail without leaving the list |
| Detail back nav | `DetailNav` | Call, campaign, batch, lead detail |
| Feedback | toasts (`use-toast`), skeletons, inline `animate-pulse` | |

Icons: lucide-react for UI chrome; `@workspace/brand-icons` for the sidebar product icons (HomeIcon, AgentIcon, KnowledgeIcon, and so on). Charts: Recharts, themed by `use-chart-theme`.

---

## 3. App shell and layout

Source: `artifacts/dashboard/src/components/layout.tsx`.

### 3.1 Desktop (768px and wider)

```text
┌──────────────┬───────────────────────────────────────────────────────────┐
│ SnapServe  « │ [acting-as banner]  [Voice-a-thon banner]                 │
│ [Search ⌘K]  │                                         [☀/☾] [🔔]        │
│ [+ New agent]├───────────────────────────────────────────────────────────┤
│              │  ← Back                                                   │
│ Home         │  Page title                              [Secondary] [Primary]
│ BUILD        │  One-line description                                      │
│  Agents      │  [Tab] [Tab] [Tab]                                         │
│  Knowledge   │ ─────────────────────────────────────────────────────────  │
│  Memory      │                                                            │
│  Squads      │        Page content, max width 1200px, centred             │
│ DEPLOY       │                                                            │
│  Phone nos.  │                                                            │
│  Campaigns   │                                                            │
│  Flows       │                                                            │
│  Connections │                                                            │
│  Bookings    │                                                            │
│ MONITOR      │                                                            │
│  Call logs 3 │                                                            │
│  Analytics   │                                                            │
│ ▸ Settings   │                                                            │
│──────────────│                                                            │
│ Documentation│                                                            │
│ [₹ wallet ▬] │                                                            │
│ (KS) Name  ▾ │                                                            │
└──────────────┴───────────────────────────────────────────────────────────┘
```

- **Sidebar width:** 216px expanded, 58px collapsed (icons only). Collapse state saved in `snapserve:sidebar-collapsed`.
- **Header:** SnapServe wordmark (or the partner's logo and name), an emerald "Partner" badge for partners, collapse button.
- **Search:** opens the command palette; shows ⌘K when expanded.
- **New agent:** primary button; opens the New agent modal (Vibe Build or Manual Build; managed clients get only "Open builder").
- **Footer:** "Powered by {company}" on partner branding, Documentation link (hidden for managed clients), wallet chip, user menu.
- **Top utility strip (desktop only):** theme toggle and a bell icon. The shell has no page title; each page renders its own header.

### 3.2 Mobile (under 768px)

```text
┌───────────────────────────────┐
│ ☰  SnapServe          (KS)    │  50px top bar + safe area
├───────────────────────────────┤
│                               │
│   Page content                │
│   (tables become cards)       │
│                               │
├───────────────────────────────┤
│ Home  Campaigns  (+)  Agents  Call logs │  56px bottom nav + safe area
└───────────────────────────────┘
```

- The hamburger opens a 280px sheet with the same sidebar.
- The centre "+" opens the New agent modal.

### 3.3 Sidebar navigation

| Group | Item | Route | Notes |
|---|---|---|---|
| (top) | Home | `/app/home` | |
| BUILD | Agents | `/app/agents` | |
| | Knowledge | `/app/knowledge-bases` | |
| | Memory | `/app/memory` | hidden for managed clients |
| | Squads | `/app/squads` | hidden for managed clients |
| DEPLOY | Phone numbers | `/app/phone-numbers` | |
| | Campaigns | `/app/campaigns` | also active on `/app/automatic-calls` |
| | Flows | `/app/flows` | |
| | Connections | `/app/connections` | also active on WhatsApp, Meta leads, automatic calls |
| | Bookings | `/app/scheduling` | |
| MONITOR | Call logs | `/app/history` | amber count of pending callbacks (polled every 30s, capped at 99+; a dot when collapsed) |
| | Analytics | `/app/analytics` | |
| PARTNER | Partner Hub | `/app/partner` | partners only |
| Settings (collapsible) | Developers | `/app/api-keys` | |
| | Workspace | `/app/settings` | |
| | Providers | `/app/providers?tab=provider-keys` | hidden for managed clients |
| | Billing | `/app/wallet` | |

The Settings group opens automatically when the current page is inside it; its open state is saved in `snapserve:settings-open`.

### 3.4 Page template (`StripePage`)

Every standard page uses the same header and container:

- Header padding 20px (24px on larger screens); optional back chevron; title 24/26px; description 14px; optional tab row; actions on the right.
- Content centred at **max 1200px** wide, unless the page is `fullBleed` (Campaigns, Memory).
- `lockScroll` pages scroll internally inside a full-height frame: the agent builder, the flow canvas and Vibe Studio.
- Tabs are kept in the URL as `?tab=` so links and the back button work.

### 3.5 Wallet chip

Shows the balance and estimated minutes left (balance ÷ the account's per-minute rate, default ₹5/min).

| Balance | Colour |
|---|---|
| ₹500 or more | Emerald |
| ₹100 to ₹499 | Amber |
| Under ₹100 | Red |

A thin bar fills to 100% at ₹1,000. Clicking opens Billing.

### 3.6 User menu

Avatar initials, name, email, then: Settings, Light/Dark appearance, Sign out.

### 3.7 Command palette

- Opens with ⌘K / Ctrl+K or the sidebar Search button (`GlobalSearch.tsx`, cmdk).
- Searches after 2 characters with a 280ms pause.
- Result groups: Dial flows (campaigns), Leads, Batches, Bookings, Callbacks, each with an icon and a status badge.

### 3.8 Banners

| Banner | When | Look |
|---|---|---|
| Impersonation | Staff "log in as" session | Above the app; exit returns to admin |
| Acting as client | Partner opened a client workspace | Amber bar with "Exit to Partner Hub" |
| Voice-a-thon | Direct SnapServe users | Promo bar, dismissible (saved in `voiceathon_banner_dismissed`); hidden for partners and managed clients |

### 3.9 Session behaviour

- Signs out after **10 minutes idle**, synced across tabs.
- A 401 from the API signs out with a "session revoked" message shown on the sign-in page.
- Each route has an error boundary that resets when you navigate.

---

## 4. Navigation and routing

Router: wouter (`artifacts/dashboard/src/App.tsx`).

### 4.1 Sitemap

```text
/                      → sign-in (signed out) or /app (signed in)
/sign-in, /sign-up     → sign-in page
/app                   → /app/home
├─ /app/onboarding     (full screen, no sidebar)
├─ /app/vibe           (full screen, no sidebar)
├─ /app/home
├─ /app/agents, /app/agents/:id
├─ /app/knowledge-bases
├─ /app/memory
├─ /app/squads, /app/squads/:id
├─ /app/phone-numbers            (?tab=my-numbers | verification)
├─ /app/campaigns
│   └─ /:id (?tab=analytics | settings)
│       ├─ /batches/new
│       ├─ /batches/:batchId
│       └─ /leads/:leadId
├─ /app/automatic-calls, /new, /:id
├─ /app/flows, /app/flows/:id
├─ /app/connections               (?setup=sheets | calendar | whatsapp | email | website | meta)
├─ /app/whatsapp
├─ /app/scheduling
│   ├─ /bookings/:id
│   ├─ /calendars
│   ├─ /event-types, /event-types/:id
│   ├─ /availability
│   └─ /conferencing
├─ /app/meet
├─ /app/history                   (?tab=callbacks | transfers)
│   └─ /app/history/:id
├─ /app/analytics, /app/analytics/agents/:id
├─ /app/api-keys                  (?tab=overview | api-keys | webhooks)
├─ /app/settings                  (?tab=workspace | team), /app/settings/profile
├─ /app/providers                 (?tab=provider-keys | voices | my-clones)
├─ /app/wallet                    (?tab=wallet | usage)
├─ /app/partner, /app/partner/clients/:clerkId
├─ /app/partner-join, /app/join   (invite acceptance)
└─ /app/test-simulator
Public: /book/:slug, /book/cancel, /book/reschedule, /join/:token,
        /workshop/:slug, /events/:slug, /events/judge/:token,
        /events/certificates/:code/verify, /docs/*, /privacy, /terms, /impersonate
```

### 4.2 Legacy redirects

| Old URL | Goes to |
|---|---|
| `/app/calls`, `/app/calls/:id` | Same page as `/app/history` (kept as aliases) |
| `/app/callbacks` | `/app/history?tab=callbacks` |
| `/app/transfers` | `/app/history?tab=transfers` |
| `/app/activity` | `/app/history` |
| `/app/team` | `/app/settings?tab=team` |
| `/app/voices` | `/app/providers?tab=voices` |
| `/app/usage` | `/app/wallet?tab=usage` |
| `/app/kyc` | `/app/phone-numbers?tab=verification` |
| `/app/webhooks` | `/app/api-keys?tab=webhooks` |
| `/app/meta-leads` | `/app/connections?setup=meta` |
| `/app/command-center`, `/app/automation`, `/app/call-plans/:id` | `/app/home` |
| `/app/call-plans` | `/app/flows` |
| `/app/people` | `/app/campaigns` |
| `/app/events*` | `/app/home` |
| `/app/channels?channel=…` | the matching agent tool, Meet or Connections page |

### 4.3 Guards

1. **Signed out** on any `/app` URL → home (sign-in). Partner and team invite links are remembered and restored after sign-in.
2. **Onboarding not finished** → `/app/onboarding` (not for managed clients or invite pages).
3. **Managed (partner client) workspaces** cannot open: docs, Memory, Squads, Providers, Voices, Vibe, Test simulator, Meet, Usage, Activity, KYC, Partner. They are sent to Home.

---

## 5. Sign-in and onboarding

### 5.1 Sign-in and sign-up (`/`, `/sign-in`, `/sign-up`)

```text
┌──────────────────────────────────────────────┐
│ black, dot-grid background, soft vignette    │
│        ┌──────────────────────────┐          │
│        │   [icon] SnapServe       │          │
│        │   Create your account    │          │
│        │   Get started with your  │          │
│        │   voice agents.          │          │
│        │  [🎁 15 free minutes on us]│         │
│        │  [ G  Sign up with Google ]│         │
│        │  Already have an account? │          │
│        │  Sign in                  │          │
│        │  Terms · Privacy          │          │
│        └──────────────────────────┘          │
└──────────────────────────────────────────────┘
```

- **Card:** max 400px, dark glass (`#0f0f12` at 90%), fades and zooms in.
- **SnapServe host:** Google sign-in only, no password. Toggle between "Sign in to SnapServe" and "Create your account". Purple pill "15 free minutes on us" (new signups get a ₹75 welcome credit).
- **Partner host:** partner logo and name; email and password form; no sign-up ("Need an account? Ask {company}…"); errors for wrong password and portal lockout.
- **States:** loader until the brand loads, red banner for a revoked session, "Signing in…" while submitting.
- **After Google:** new users fire the Meta "CompleteRegistration" pixel event.

### 5.2 Onboarding wizard (`/app/onboarding`)

Full screen, no sidebar, Typeform style: one question per screen, progress bar on top, slide transitions, Enter to continue.

1. Your name (required).
2. Student or professional (picks and advances).
3. How did you hear about us: Instagram, YouTube, reference, Google, AI search.
4. Have you used voice agents before? If no, finish here.
5. Which ones: Vapi, Retell, Bolna, other (optional).

Finishing goes to **Home** (never straight into Vibe). The name is kept for a Vibe welcome greeting.

### 5.3 First run

- **No agents yet:** Home shows a full-screen "Create your first agent" empty state with "Configure manually" (primary) and "Build with AI" (Vibe; hidden for managed clients).
- **Invite links:** `/app/partner-join?token=` and `/app/join?token=` show a preview card (company or owner, role, email match warning) with "Accept invitation" / "Join team" and "Not now".

---

## 6. Build pages

### 6.1 Home (`/app/home`)

Header "Home", "Overview of your call volume, metrics, and activity." Actions: **Open agent** (outline), **New campaign** (primary).

```text
[Low balance: "Upgrade for more minutes." → Billing]          (only when under ₹100)
┌ Calls today ┐┌ Success rate ┐┌ This week ┐┌ Minutes left ┐   4 metric tiles
│ all-time    ││ avg duration ││ completed ││ ₹ balance    │   (amber when low)
└─────────────┘└──────────────┘└───────────┘└──────────────┘
┌ Call volume, last 7 days (completed vs failed)      View analytics → ┐
└──────────────────────────────────────────────────────────────────────┘
┌ What's running ───────────────┐ ┌ Agents (up to 6) ─────┐
│ active sheets and campaigns   │ │ #id, status → builder │
├ Recent calls (last 6) ────────┤ ├ Finish setup ─────────┤
│ → call detail                 │ │ ✓ agent ✓ campaign ○ phone/channels
├ Needs attention ──────────────┤ ├ Wallet ───────────────┤
│ Sheets disconnected, low      │ │ → Billing             │
│ wallet, recent failed calls   │ └───────────────────────┘
└───────────────────────────────┘
```

- Empty queue: "Nothing in the queue yet" with New campaign and Open agent.
- Refresh: stats every 30s, 7-day chart every 60s, recent calls every 30s.

### 6.2 Agents (`/app/agents`, `/app/agents/:id`)

A split-pane studio: agent list on the left, builder on the right (`agents/builder.tsx`).

```text
┌ Agents ─────────┬─ [☰] Agent name ✎  #id ⧉  ● Live   Auto-saved   [Call] [Live test] [Save now] [⋯] ┐
│ [search]        │  Agent | Voice | Calling | Tools | After call | More                           │
│ 12 total · 4 live│ ───────────────────────────────────────────────────────────────────────────── │
│ ● Sales bot  #41│                                                                                │
│   Support    #38│   Section content (forms, cards)                                              │
│   …             │                                                                                │
│ [Create w/ Vibe]│                                      ┌ Live test (floating web call) ┐        │
└─────────────────┴──────────────────────────────────────└───────────────────────────────┘────────┘
```

**List panel:** search, "X total · Y live", rows with name, `#id`, live dot, squad chip or speech/voice provider line, delete on hover (with confirm). On mobile the list is a left sheet. Opening `/app/agents` jumps to the last agent you edited.

**Create agent dialog (3 steps):** Single agent or Team (two agents with a handoff) → Phone or Phone + meetings → names (team: names, roles, handoff announcement and greeting). Option: "Or build with AI (guided)".

**Editor header:** rename, copy agent ID, Live/Draft chip, save state (Auto-saving, Pending, Invalid, Failed, Auto-saved), readiness chips for Agent and Voice. Actions: **Call** (outbound test), **Live test** (floating web call), **Save now**. More menu: Phone test, Publish version, Refine with AI, API keys, Delete agent. Auto-saves about 1.2s after edits; warns before leaving with unsaved changes.

**Sections** (kept in `?section=`):

| Tab | Contents |
|---|---|
| Agent | Script mode (free text, or identity + flow), knowledge attachment, welcome (who speaks first, greeting), call vs meeting script, variables. **Generate with AI** opens a side sheet: name, company, use case, direction, language, call flow, key knowledge → generating → preview with guardrail checks and a diff → Apply. |
| Voice | Speech-to-text provider, model, language, multilingual; voice stack (Classic, Gemini Live, OpenAI Realtime); voice provider, model, voice, speed, Play preview; turn-taking (barge-in, endpointing, semantic turn stop, background noise). |
| Calling | Inbound and outbound number assignment (pick-a-number dialog, trial quota), telephony provider (Vobiz, Plivo, Twilio). |
| Tools | Calendar and event type, Google Meet, booking tools (book, check availability, list, reschedule, cancel), end call, send email, send WhatsApp, custom tools with parameters, gender detection, voice memory, recording, summaries. |
| After call | Outcomes (dispositions) with WhatsApp/email rules; voicemail (answering-machine detection, message). |
| More → Activity | 30-day stats, bar chart, latency pills. |
| More → Settings | Compliance (IRDAI, DPDP, TRAI), webhook URL and secret, auto-redial, call rules (attempts, retry delay, pace, parallel calls, business hours, timezone), advanced speech tuning. |
| More → Versions | Published vs Draft; publish, compare, restore, archive, delete. |

**Testing:** outbound test calls ask for OTP verification of new destination numbers; recent numbers are offered. `?webcall=1` opens the live test automatically.

### 6.3 Knowledge (`/app/knowledge-bases`)

- Header "Knowledge", **Add knowledge**. An info card explains how knowledge is used on calls.
- **Grid of packs:** type chip (FAQ, Text, Website, File), status (Ready, Indexing…, Needs attention, Checking…, Importing…, Failed), piece count, attached agents, created time, delete on hover. Footer totals.
- **Add knowledge (3 steps):** type (Q&A, paste text, upload file up to 20MB, website link) → details → attach to agents ("Skip for now", "Attach to N").
- **Pack detail** (replaces the grid): back arrow, status banner, "Retry failed pages" for partial website crawls, editable entries, "Add Q&A pair" / "Add entry", and **Test search**: type a question and see "What the agent would see" with ranked matches.
- Empty: "No knowledge yet" with "Add your first pack".

### 6.4 Memory: Customer Intelligence (`/app/memory`)

Full-width, three columns: agents → callers → caller detail (panels switch on mobile).

- Caller detail tabs: Summary, Facts, Episodes, Calls.
- "Update for next call" form, memory summary, facts with icons, episode timeline, call links.
- Actions: edit or delete a fact (double-click confirm), reset memory.
- Deep link: `?agentId=&caller=`.

### 6.5 Squads (`/app/squads`, `/app/squads/:id`)

- Card grid: name, description, member count, status. **New team**.
- Create dialog: name, description, members (agent, role, instructions), handoff message and greeting. `?seedAgent=` pre-fills an agent.
- Detail: members, handoff settings, connected phone numbers and campaigns, task list (handoff, follow-up) with status colours.

### 6.6 Vibe Studio (`/app/vibe`)

AI agent builder: full screen, no sidebar, chat first.

```text
┌ Chat | Agent | Connect | Test ─────────────────────────────── [☀/☾] ┐
│                                                                       │
│  Assistant: What should your agent do?                                │
│  [template chips]                                                     │
│  You: …                                                               │
│  ┌ progress: Name ✓ Company ✓ Language … ┐  inline voice/phone pickers│
│                                                                       │
│  [ message input …                                       ] [Send]     │
└───────────────────────────────────────────────────────────────────────┘
```

- Agent, Connect and Test tabs unlock once an agent exists. Agent embeds the full builder; Connect sets up phone, WhatsApp and calendar; Test has the web call and an outbound test call.
- Streaming states: idle, thinking, streaming, building, done. Session history in a sheet.
- `?refine=<agentId>` refines an existing agent. Managed clients are redirected to the manual builder.

---

## 7. Deploy pages

### 7.1 Phone numbers (`/app/phone-numbers`)

Header "Phone Numbers", **Get number**. Tabs (owners only): **My numbers**, **Verification**.

- Hero when empty: "Take your agent live" with Get number and Open agents.
- **KYC banner:** verified, in progress, failed, or "Verify identity" / "Resume verification".
- **Number cards:** number in mono, country, type; badges Autopay, Wallet renew, Renewal unpaid (red), "Your Plivo number · Free", From provider, Workspace. Actions: **Rules**, **Assign/Reassign**, **Release**.
- Bring-your-own numbers from other telephony keys are listed with a provider badge.

**Get number flow:**

1. KYC gate if not verified (PAN + Aadhaar, or GSTIN).
2. Search: country (India default plus 8 others), digit filter, results list.
3. Purchase: rental, ₹100 setup, **18% GST**, pay now, renews every 30 days; promo code; renewal choice **Autopay** (needs a card mandate) or **Wallet only** (7-day grace warning).
4. Pay from wallet (only when balance is over ₹20,000 and covers the total) or **Pay ₹X by card** (Razorpay: UPI, card, netbanking).

Other dialogs: assign to agent (partners see client agent groups), routing rules (caller prefix, time of day or always → agent; "Add rule"), release confirm.

**Verification tab:** Prepare → Verify → Done steps; Vobiz KYC widget in a modal ("Open in tab", "I'm done", "Secured by VoBiz"); states completed, failed, in progress ("Continue"); document checklist for individual or company.

Managed clients: no buy and no KYC; assign only.

### 7.2 Campaigns (`/app/campaigns`)

Full width. Header "Campaigns", **New campaign**, plus source chips: Website, Meta, Sheets, CSV, Zoho CRM.

```text
[Campaigns][Active][Live calls][Queued leads][Leads today][Booked today]   (refresh 10s)
[search] [source ▾] [status ▾] [Clear]                       [?] [Export CSV]
┌ Campaign │ Status │ Source │ Live │ Answered % │ Booked │ Action ───────┐
│ Diwali…  │ ● Active│ CSV   │ 3    │ 42%        │ 7      │ Open  ⋯       │
│ health: Healthy · No agent · No phone · Validation error · Webhook offline · Outside hours
└──────────────────────────────────────────────────────────────────────────┘
```

- Row menu: pause, resume, stop, edit, delete (delete requires typing the name).
- Empty states differ for "no campaigns yet", "no match for filters" and "could not load" (Retry). Mobile uses cards.

**Campaign detail (`/app/campaigns/:id`):** execution strip (status, pause/resume/stop, agent, number, funnel). Tabs:

- **Leads:** funnel, leads workspace (filters, saved views, outcome buckets), batches, CRM import; clicking a call opens the call drawer.
- **Analytics:** campaign charts.
- **Settings:** business hours, lead transfer, CRM integration, webhook secrets, re-campaign dialog.

Refreshes every 10 to 15 seconds.

**New batch wizard (`/batches/new`):** source (CSV, Meta, webhook) → column mapping → validation preview (valid, warning, error) → consent → schedule (timezone aware) → duplicate policy → start. Maps agent variables; enforces IRDAI rules.

**Batch detail:** play, pause, stop, redial; countdown to scheduled start; leads workspace.

**Lead profile (`/leads/:leadId`):** identity header with attempt status, outcome and contact-state badges; tabs for timeline, calls, notes, tasks; memory sidebar; recording player; update callback; retry lead.

### 7.3 Google Sheets automatic calls (`/app/automatic-calls`)

- List titled "Google Sheets", back to Campaigns, **Connect sheet**. Columns: name, status (draft, running, paused, stopped), sheet, enqueued, dialed, failed, actions (Start, Pause, Resume, Stop, Open).
- Wizard: connect Google → choose sheet → map phone, name and email columns → pick agent → modes (start mode, write-back, call log destination) with row preview.
- Detail: pipeline controls, error banner (e.g. "Reconnect Google"), stats, link to the sheet.

### 7.4 Flows (`/app/flows`, `/app/flows/:id`)

**List:** **New flow** (disabled until an agent exists). Rows: name, trigger, step count, agent, total runs, last run, status (Active emerald, Paused amber), menu Open/Delete. Create dialog: name, agent, trigger.

**Builder:**

```text
┌ ← Flow name  ● Active   [Save] [Activate/Pause] [Test run] [Run on people] [Runs] [Versions] [Stop runs] ┐
├──────────────┬───────────────────────────────────────────────┬────────────────────────┤
│ Step palette │   ( Trigger ) ──▶ [ Make call ] ──▶ ◇ Condition│ Inspector              │
│ Make call    │                         ├─yes─▶ [ Send WhatsApp ]│ trigger / step settings│
│ WhatsApp     │                         └─no──▶ [ Delay ] ──▶ … │ flow settings          │
│ Email …      │                                               │                        │
└──────────────┴───────────────────────────────────────────────┴────────────────────────┘
```

- Step types: make call, send WhatsApp, send email, send webhook, update sheet, schedule callback, join meeting, delay, wait for reply, condition, branch.
- Drag nodes, auto-layout, select edges; nodes show validation issues once saved.
- Dialogs: test run, run on people, runs history sheet, versions.
- Step stats refresh every 10s while the flow is active.

### 7.5 Connections (`/app/connections`)

Hub of integration cards; each has a brand icon, status chip (Ready emerald, Set up muted, "N ready" for phones), short description and a **Manage** / **Connect** button:

Phone numbers · Google Sheets · Bookings calendar · Meeting bots · WhatsApp · Email (Brevo) · Form intake (website) · Meta Lead Ads.

Setup opens in place via `?setup=sheets | calendar | whatsapp | email | website | meta`. A `returnTo` / `returnLabel` sends the user back to Vibe or the agent's Outcomes section when done.

### 7.6 WhatsApp (`/app/whatsapp`, usually reached from Connections)

- **Workspace channel:** shared ("Legacy Instant WhatsApp") or your own number (Vobiz or Meta). Buy a number via Razorpay or wallet; business setup dialog (number source, business name, WABA and phone IDs, tokens, inbound agent).
- **Messages list** with WhatsApp status colours (see 2.3); WhatsApp calls list on own numbers.
- **Agent connections (advanced):** cards showing Meta connected / Active / Paused, Request a Call, Post-call; inbound/outbound webhook URLs with Copy. **Connect WhatsApp** dialog: Meta Cloud API (direct) or Webhook (BSP/Zapier); name, agent, URLs or Meta token/phone/WABA, templates; switches for post-call messages and "WhatsApp can trigger a call". The outbound signing secret is shown once in an amber banner.

### 7.7 Meta Lead Ads (in Connections)

5-step setup guide; form cards (form name, webhook URL with copy, Active/Paused, Pause/Resume/Delete, agent and phone selects, Save assignment, leads table with name, phone, status, received). **Connect form** dialog: page/form name, Form ID, Page access token.

### 7.8 Bookings and scheduling (`/app/scheduling`)

Tab nav: **Bookings**, **Setup** (always); Calendars, Event types, Availability, Conferencing (advanced pages).

- **Bookings list:** "Set up calendar". Filters: status, source (agent, web, API), calendar sync, calendar. Columns: attendee, slot, status, via (Agent call / Web), calendar sync (Synced, Scope issue, Sync failed, No calendar, with tooltips), booked. Mobile cards.
- **Booking detail:** attendee, slot, notes; **Confirm**, **Cancel**, **Reschedule**.
- **Event types:** list, quick-create (title, `/book/` slug, description, duration, calendar), copy link, full editor (duration, buffers and more).
- **Availability:** pick calendar, weekly rows (on/off, times), date overrides (block a day or custom hours).
- **Calendars** and **Conferencing:** connect Google, test, remove, scope warnings for Meet links.

### 7.9 Meeting bots (`/app/meet`)

Explains three ways a bot joins (now, from calendar, from bookings), then:

1. **Pick agent** (meeting-capable agents only; "New agent"; link to meeting prompt).
2. **Join now:** meeting URL → **Join meeting**; session list with status and **Leave**.
3. **Calendar join:** connect Google; upcoming events with a "Joining" switch each.

Collapsible **Advanced** (waiting room, length, slides).

---

## 8. Monitor pages

### 8.1 Call logs (`/app/history`)

Header "History" with tabs **Calls**, **Callbacks**, **Transfers**.

```text
[Total calls][Completed][Voicemail][Failed][Avg duration]
[search] [status ▾] [agent ▾] [outcome ▾] [from–to] [sort ▾]   [Clear] [Export CSV]
┌ Date & time │ Call ID │ Agent │ From │ To │ Type │ Status │ Outcome │ Duration │ Cost ┐
│ 1 Oct 17:42 │ 9f3a…   │ Sales │ …    │ …  │ Campaign │ ● Completed │ Booked │ 2:14 │ ₹11.2 │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- All filters, sort and page (50 rows) live in the URL.
- Call type badges: Web call, Campaign, Live call, with direction icons.
- Status badges: Calling (amber, pulsing), In progress (blue, pulsing), Completed (emerald), Failed (red), Pending/Cancelled (muted), Transferred/Callback (orange), Booked (violet), Voicemail, Busy, No pickup.
- Clicking a row opens the **call drawer** (prev/next through the list).
- Refresh every 3s while any call is live, otherwise 15s. Scroll position is restored.
- Empty: "No calls found" with Clear filters. Error: Retry.

### 8.2 Call detail (`/app/history/:id` or drawer)

- Header: back (or prev/next in the drawer), Call #id, status, execution ID, agent link, times, cost, direction.
- Tabs: **Transcript** (agent and caller bubbles, tool calls highlighted amber, translate to Indian languages), **Summary**, **Tools**, **Logs**, **Recording**, **Metadata**.
- Side panels: edit outcome inline, domain fields, success evaluation (PASS/FAIL), caller memory, campaign links.

### 8.3 Callbacks (History → Callbacks)

Collapsible guide (callback, auto-redial, network drop); metric strip; sub-tabs **Pending**, **Triggered**, **Failed**, **Cancelled**. Rows: agent, number, reason badge, status, scheduled time, attempts; actions cancel, reschedule, view call. Refresh every 30s.

### 8.4 Transfers (History → Transfers)

Amber card for active transfers; list grouped by day (Today, Yesterday…). Each: call link, agent, transferred to, summary, status (Initiated, Connected, Completed), elapsed time; mark connected or completed. Refresh every 10s only while a transfer is live.

### 8.5 Analytics (`/app/analytics`)

- Date presets: Today, Yesterday, 7 days, 30 days. Optional back to a campaign (`?campaignId=`).
- KPI grid: Total leads, Connected, Connection rate, Interested, Booked, Transferred, Booking rate, Callback success, Avg duration, plus conversion bars.
- Daily trend chart (connected, booked, transferred).
- **Agent analytics** (`/app/analytics/agents/:id`): the same panel as the builder's Activity tab.

---

## 9. Settings pages

### 9.1 Developers (`/app/api-keys`)

Tabs **Overview**, **API keys**, **Event subscriptions**.

- **Overview:** "Build with SnapServe APIs" hero, Generate API key, Read docs, API base URL, six recipe cards (outbound call, campaigns, phone numbers, fetch outcomes, event subscriptions, Claude skill).
- **API keys:** New key (max 5 active); the full key is shown once with copy and "I've saved my key"; active keys (name, masked prefix, last used, revoke); revoked keys faded; curl example.
- **Event subscriptions:** endpoints with on/off switch, event badges, copy secret, edit/delete. Add endpoint: HTTPS URL, `call.completed` / `call.failed`, description (warning on legacy `call.ended`). New secret shown once.

### 9.2 Workspace and Team (`/app/settings`)

**Workspace tab:**

- Quick overview tiles: active phone numbers, API keys, event subscriptions, wallet balance.
- Category cards: Account (Profile, Change password), API and developers, Telephony, AI configuration, Billing and usage (including concurrent call slots), Security (audit logs).
- General settings: Account and billing (**Add slot (₹1,000)** from wallet, copy wallet ID), Change password (email users) or a Google note, Request timeout (10s, 30s, 60s, none), Appearance (Light, Dark, System).
- **Danger zone:** Delete workspace (two-step confirm, type DELETE).
- Help links (partner URLs for managed clients).

**Team tab:** "Multi-user access" badge; tiles for total, active (emerald), pending (amber); member list (avatar, role badge, Active or Pending invite with "Resend email", remove). **Invite member**: email, name, role (Admin, Developer, Member, Viewer).

**Profile (`/app/settings/profile`):** read-only name, email, avatar.

### 9.3 Providers and Voices (`/app/providers`)

Tabs **Provider keys** (bring your own telephony, LLM, speech and voice keys; **Add provider**), **Voices**, **My clones** (voice cloning).

**Voices:** search; filters for language, gender, accent; sort A–Z, Z–A, language. Cards: avatar, name, badges, description, provider badge, Listed (emerald) or Available (muted), favourite star, **Preview/Stop**. "Showing X of Y library voices".

### 9.4 Billing (`/app/wallet`)

Tabs **Wallet** and **Usage**. Toolbar: "₹5 / minute · INR · GST on top-ups" (or the partner's rate).

**Wallet tab:**

- Low balance card (under ₹100) that scrolls to Add funds.
- **Available balance**, "Welcome credit applied" check, approximate minutes left.
- **Add funds:** presets ₹500 to ₹5,000 (partners ₹5,000 to ₹50,000) or custom (minimum ₹100); breakdown **wallet credit + 18% GST = you pay**; **Pay ₹total** opens Razorpay in redirect mode and returns with `?topup=success|failed`.
- **Auto-pay:** set up a card mandate (Razorpay recurring, card only), then a threshold and top-up amount (saved on blur).
- **Invoices and receipts:** GST tax invoice PDFs.
- **Transaction history:** type icons (Free credit, Top-up, Auto top-up, Call usage, Partner earning/credit/transfer), +/− amounts, status.
- Managed clients see "Partner-funded wallet" and cannot top up.

**Usage tab:** four cards (total spend, calls, minutes, average cost per call); call charges table where each row expands into speech, LLM, voice, platform fee and total.

### 9.5 Test simulator (`/app/test-simulator`)

Choose an agent and a booking tool, fill its parameters, **Run**; results appear as history cards (errors with a red border).

---

## 10. Partner (reseller) pages

### 10.1 Partner Hub (`/app/partner`)

Header: company name, platform rate vs client price. Tabs:

- **Overview:** earnings, clients, client minutes and calls, partner wallet; recent earnings.
- **Clients:** table with rates and balances, **Open client**; create client (email, password, name, rate, send credentials), set rate, transfer wallet funds. Status Active (emerald) / Pending (amber).
- **Invites:** pending invites, resend, revoke.
- **Settings (white-label):** logo, login title and subtitle, slug, subdomain, custom domain with DNS records table (copy cells, **Verify DNS**), mail-from DNS, support/docs/terms/privacy URLs, default client rate.

Non-partners see a centred "Partner Hub" empty state.

### 10.2 Partner client (`/app/partner/clients/:clerkId`)

Back to Partner Hub; tiles for balance, rate, this month's usage, spend and calls. Actions: **Transfer funds**, **Update rate**, **Log in as client** (acting-as banner), send an agent to the client, assign partner numbers to client agents, client API keys (create, reveal, revoke), **Unlock login** when locked.

---

## 11. Public pages

| Page | Route | Look and behaviour |
|---|---|---|
| Sign-in / sign-up | `/`, `/sign-in`, `/sign-up` | See 5.1 |
| Public booking | `/book/:slug` | Slate gradient background, host brand mark; two columns: slot grid by day (14 days) and form (name, email, notes); badges for duration, Google Meet, manual approval; **Confirm booking**; success "Booking confirmed!" with Meet link; "Page not found" for bad slugs |
| Cancel booking | `/book/cancel?token=` | Confirm "Yes, cancel this appointment" or "Keep appointment"; states for missing, invalid, already cancelled |
| Reschedule | `/book/reschedule?token=` | Pick a new slot; success shows new time and Meet link |
| Web call join | `/join/:token` | Browser call with an agent |
| Event registration | `/events/:slug` | About, eligibility, rules, prizes, leaderboard, FAQ; registration (team, institution, city, leader with mobile OTP "Send OTP"/"Verify", "Add teammate", **Register team**); success with reference code |
| Judge portal | `/events/judge/:token` | Assignments list; rubric scores, private feedback; Save draft, Finalize score |
| Certificate check | `/events/certificates/:code/verify` | Valid/invalid with recipient, team, type, event, date |
| Workshop feedback | `/workshop/:slug` | 12-section survey (ratings, chips, NPS, open text); closed and success states |
| Privacy, Terms | `/privacy`, `/terms` | Prose page, max 768px; partner hosts redirect to the partner's own policy URLs |

### 11.1 Marketing landing page (built, not live)

`artifacts/dashboard/src/pages/landing.tsx` exists but no route uses it. Its own visual style: black background, Inter and Cal Sans, purple `#a855f7` and cyan `#06b6d4` accents, marquee ticker, glowing orbs, animated counters.

Sections: fixed nav (Features, vs Bolna, Pricing, Sign in, Get started) → hero "The Voice AI Platform That Remembers" with "Start building free" and "15 free minutes · No card required" → feature ticker → 5 feature cards (Memory, Resilience, Identity, Campaigns, Scheduling) → memory architecture → stats → auto-redial → Bolna comparison table → pricing (Starter, Production, Enterprise at ₹5/min) → closing CTA → footer.

---

## 12. Docs site

`/docs/*`, SnapServe host only. Always light (white and slate), independent of the app theme.

```text
┌ [SnapServe Docs]  Documentation | API Reference | Changelog        [Dashboard] [Get API key] ┐
├──────────────┬──────────────────────────────────────────────┬───────────────────┤
│ [Search ⌘K]  │ Breadcrumb                                    │ On this page      │
│ Get started  │ Page title                       [Copy page]  │  • Section        │
│ Build agents │ Description · Last updated                    │  • Section        │
│ Connect…     │ Prose, callouts, code blocks, param tables    │                   │
│ Calls…       │ [← Previous]                     [Next →]     │                   │
│ Account…     │                                               │                   │
│ Reference    │                                               │                   │
└──────────────┴──────────────────────────────────────────────┴───────────────────┘
```

- The right table of contents appears on very wide screens; on mobile the sidebar is a sheet.
- Search uses fuzzy matching (Fuse.js) over the nav.
- Building blocks: callouts (info, warn, tip), doc cards, endpoint snippets, language tabs, parameter tables.

**Sidebar:**

| Group | Pages |
|---|---|
| Get started | Introduction, What you can build, Platform concepts, Jarvis, Quick start (API), Authentication, Claude skill and MCP |
| Build agents | Vibe builder, Agents and builder, Variables, Contextual knowledge, Caller memory, Test an agent |
| Connect and channels | Connections, WhatsApp, Bookings calendar, Meeting agents, Website web call embed, Phone numbers |
| Calls and campaigns | Calls and history, Campaigns, Event subscriptions, Wallet and billing |
| Account and compliance | Team workspace, Compliance |
| Reference | API reference, SDKs, Errors, Pricing, FAQ, Changelog |

**API reference:** overview page, then one page per endpoint: method badge and path, "Try it" (copy cURL), authorization, path/query/header parameters, body, responses by status; the right rail has "On this page" and a terminal-style code panel with request and response examples.

---

## 13. Admin app

`artifacts/admin`, for SnapServe staff. Sign-in at `/login` with an admin token.

### 13.1 How it differs from the dashboard

| Aspect | Dashboard | Admin |
|---|---|---|
| Default theme | Light | Dark |
| Font | Inter | Poppins (numbers tabular) |
| Colour | Cool ink, status colours | Neutral greys |
| Radius | 10px | 8px |
| Navigation | Product sidebar | Grouped collapsible nav tree with "Admin" badge |
| Auth | Google or partner password | Admin token |

**Shell:** 256px sidebar, top bar with command palette (⌘K), alerts bell, theme toggle.

### 13.2 Sections

| Group | Pages |
|---|---|
| Command centre | Overview (Real/Test toggle, KPIs, calls and minutes today, spike alerts, call volume, failed calls), Platform, Control hub, Health |
| Analytics | SaaS overview, Daily P&L, Unit economics, Users, Activation, Retention, Agents, Providers, Analytics hub, Call analytics (execution ID, date, user, agent, status, duration, cost), Legacy funnel, Board pages (pulse, growth, retention, moat, unit economics), Signups and email reports |
| Usage | Overview, STT/TTS/LLM by service, by user, by workspace, history, pricing, allocations, alerts |
| Revenue | Money hub, Finance (audit ledger, daily close, Razorpay gaps, economics, cohorts, investor; CSV export), Wallets, Recharges, Phone purchases, Call pricing |
| Cost and pricing | Overview, Provider costs, Customer pricing, History, Simulator |
| Customers | Users (lifecycle, segment and category filters; balance, revenue, profit, calls, minutes, agents; CSV), User detail (wallet, impersonate), Admin agent editor, Workspaces, Partners, All agents |
| Voice operations | Live calls, Failures, Call quality, Call 360 |
| Product and infrastructure | Managed keys (LLM, STT, TTS, telephony, integrations: test, rotate), Managed numbers and trial limits, Providers, Voices, Prompt templates, System prompts, Ambient sounds, Integrations and Google Calendar connections, Scheduling |
| Operations | Alerts, Health, Deployments, Emails, Audit logs |
| Demos and programmes | Voice-a-thon (events, teams, judges, leaderboard, certificates), Events, Intern bookings, Landing leads, Team guides, Family module (companies, policies, agents) |
| Settings | Platform settings, Admin alert channels, DPDP erasure |

---

## 14. Known gaps and inconsistencies

Found while mapping the code; worth deciding on:

1. **Landing page is not live.** `landing.tsx` is built but has no route; signed-out visitors land on the sign-in card. Its footer links are `#` placeholders.
2. **Bell icon does nothing.** The top-bar bell has no notifications behind it.
3. **Unreachable pages:** in-app Events list and Event team portal (all `/app/events*` redirect to Home), Activity log (redirects to History).
4. **Two visual languages for marketing.** The landing page uses inline purple/cyan styles, while the dashboard tokens define saffron/teal/indigo as the marketing colours.
5. **All dashboard pages load up front.** `App.tsx` imports every page eagerly; only the API reference and the embedded agent editor are lazy, so the first load is heavy.
6. **Older header components remain** (`app-page-header.tsx`, `operate-shell.tsx` alongside `StripePage`); a few pages still use their own headers.
7. **Duplicate admin routes** for the same page (for example `/phone-purchases` and `/revenue/phone-numbers`, `/voices` and `/product/voices`).
8. **Investor overview, brochure and SnapServe book** still describe the old $5 / ₹500 welcome credit; the product now gives 15 free minutes (₹75).

---

## 15. Cross-cutting UX rules

1. **One page template.** Use `StripePage` for title, description, back link, tabs and actions; keep content within 1200px unless the page is a dense workspace.
2. **State in the URL.** Tabs (`?tab=`), builder sections (`?section=`), filters, sort and page are URL parameters, so links can be shared and the back button works.
3. **Every list has three states:** loading skeleton, empty state with a next action, and error with Retry.
4. **Mobile:** tables become cards, the sidebar becomes a sheet, primary navigation moves to the bottom bar, touch targets are 44px.
5. **Live data refreshes by polling:** 3s for live calls, 10s for campaigns, transfers and active flows, 30s for home stats and callbacks, 60s for charts.
6. **Status colours mean the same everywhere** (see 2.3).
7. **Money:** shown in rupees with paise (`₹1,234.56`); 18% GST is always shown on top-ups and number purchases; payments go through Razorpay (redirect mode for top-ups, popup for purchases, card-only mandates for auto-pay).
8. **Secrets are shown once** (API keys, webhook and signing secrets) with copy and an "I've saved it" step.
9. **Destructive actions confirm,** with type-to-confirm for campaigns and workspaces.
10. **Partner and managed workspaces** reuse the same screens with partner branding and hide self-serve billing, providers, Vibe and advanced tools.
11. **Setup flows return you** to where you started (`returnTo` / `returnLabel`) — for example back to the agent's Outcomes section or to Vibe.
