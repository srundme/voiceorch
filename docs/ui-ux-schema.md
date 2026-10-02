# SnapServe UI / UX schema (A–Z)

**Date:** 2026-09-19  
**Source of truth:** live code in this repo, not mockups.  
**Apps:** customer dashboard (`artifacts/dashboard`), admin (`artifacts/admin`), public pages, docs.

This file is the product map: surfaces, chrome, tokens, alignment rules, every route, every tab, every primary button.

---

## 1. Product surfaces

| Surface | Host (typical) | Who | Shell |
|---|---|---|---|
| Customer dashboard | `app.snapserve.ai` | Operators, partners, managed clients | Left sidebar + Stripe page |
| Sign-in / sign-up | same origin `/sign-in`, `/sign-up` | Unauth | Centered dark card, no sidebar |
| Public booking / join | `/book`, `/join` | Callers, no login | Standalone `PageHeader` |
| Docs | `/docs` | SnapServe host only | Docs sidebar |
| Admin | separate admin app | Internal (token) | Left sidebar, dark default |
| Partner white-label | custom host | Partner clients | Same dashboard, branded login + trimmed nav |

Unused in the live router: `artifacts/dashboard/src/pages/landing.tsx` (marketing draft). `/` currently redirects signed-in users to `/app` and signed-out users to the sign-in card.

---

## 2. Design tokens

Canonical file: `artifacts/dashboard/src/index.css`. Tailwind v4 `@theme inline`. shadcn **new-york**, `baseColor: neutral`. **App chrome is greyscale ink — not teal CTAs.** Saffron / teal / indigo exist only as marketing accents.

### 2.1 Type

| Token | Family |
|---|---|
| `--app-font-sans` | Inter, system-ui |
| `--app-font-display` | Plus Jakarta Sans |
| `--app-font-serif` | Georgia |
| `--app-font-mono` | JetBrains Mono |
| Body | 16px, tracking `-0.01em` |

Admin uses **Poppins** for both sans and mono (`artifacts/admin/src/index.css`).

### 2.2 Radius & elevation

| Token | Value |
|---|---|
| `--radius` | `0.625rem` (dashboard) / `0.5rem` (admin) |
| Cards | 16px + `--shadow-card`; hover lift `--shadow-card-hover` |
| Inputs | height `2.5rem`, radius 10px |
| Buttons | radius 10px (component `rounded-md`) |

### 2.3 Light (`:root`) — cool paper + ink

| Role | HSL |
|---|---|
| Background | `210 24% 97%` |
| Foreground / primary | `222 28% 12%` |
| Primary foreground | white |
| Card | white |
| Muted foreground | `215 16% 30%` (strong for outdoor glare) |
| Destructive | `0 72% 48%` |
| Charts | greyscale steps `--chart-1`…`5` |

### 2.4 Dark (`.dark`) — charcoal + white primary

| Role | HSL |
|---|---|
| Background | `222 24% 8%` |
| Primary | `0 0% 98%` (white buttons) |
| Primary foreground | `222 28% 8%` |
| Card | `222 20% 11%` |

Theme storage: dashboard `snapserve-ui-theme-v3` (default **light**); admin `admin-ui-theme` (default **dark**).

### 2.5 Marketing-only accents (do not use on app chrome)

`--color-brand-saffron #ff9933` · `--color-brand-teal #14b8a6` · `--color-brand-indigo #6366f1` · `--gradient-brand`.

---

## 3. Alignment laws (do not invent a third pattern)

| Surface | Layout | Title | Actions |
|---|---|---|---|
| **StripePage** (in-app) | `flex items-start justify-between gap-4` | Left, `h1` 24–26px | Right, `justify-end gap-2` |
| **StripeTabPage** tab row | `flex items-end justify-between` | Tabs left, underline `h-0.5 bg-foreground` | `tabActions` right |
| **PageHeader** (public) | `flex items-center justify-between px-6 h-14` | Brand left | Actions right `gap-3` |
| **Utility strip** (desktop) | `h-10 … justify-end px-4` | *(none)* | Theme + bell only |
| **Mobile top bar** | `h-[50px]` | Menu left, brand | Theme + user `ml-auto` |
| **Dialog footer** | `sm:flex-row sm:justify-end` | — | Cancel left of confirm, confirm right |
| **Sidebar footer** | stacked | Docs, wallet chip, user | Full width |
| **Acting-as banner** | `justify-between` | Copy left | **Exit** `ml-auto` |

**Primary CTA** = `Button` variant `default` (ink in light, white in dark).  
**Secondary** = `outline` or `ghost`.  
**Destructive** = `destructive`, usually in a confirm dialog, not the page header.

Content width: Stripe pages `max-w-[1200px]` unless `fullBleed`. Header padding `px-5 sm:px-6`.

---

## 4. Button system

File: `artifacts/dashboard/src/components/ui/button.tsx`.

Base: `inline-flex items-center justify-center gap-2`, icon `size-4`, `hover-elevate`.

| Variant | Use |
|---|---|
| `default` | Primary CTA (Get number, New campaign, Invite Member) |
| `outline` | Secondary (Open agent, Refresh) |
| `secondary` | Quiet filled |
| `ghost` | Icon-only chrome, table row |
| `destructive` | Delete / erase |
| `link` | Text link |

| Size | Classes |
|---|---|
| `default` | `min-h-9 px-4 py-2` |
| `sm` | `min-h-8 px-3 text-xs` |
| `lg` | `min-h-10 px-8` |
| `icon` | `h-9 w-9` |

Header CTAs in tabbed pages use `h-9` + `text-xs sm:text-[13px]`.

---

## 5. Dashboard chrome

File: `artifacts/dashboard/src/components/layout.tsx`.

### 5.1 Desktop sidebar

| State | Width |
|---|---|
| Expanded | `216px` |
| Collapsed | `52px` |
| Persist | `localStorage` `snapserve:sidebar-collapsed` |
| Visibility | `hidden md:flex` |

**Top of sidebar (in order):** brand + collapse chevron → **Search…** (`⌘K`, `flex-1 text-left`) → **New agent** (primary, full width; collapsed = icon only).

**New agent modal:** Vibe **Build with AI** vs **Configure manually**. Managed workspaces: open builder only (no Vibe).

### 5.2 Primary nav (top group, no label)

| Label | Href | Notes |
|---|---|---|
| Home | `/app/home` | |
| Campaigns | `/app/campaigns` | |
| Agents | `/app/agents` | |
| Phone numbers | `/app/phone-numbers` | |
| Connections | `/app/connections` | |
| History | `/app/history` | Pending-callback badge |
| Analytics | `/app/analytics` | |

### 5.3 MORE

| Label | Href |
|---|---|
| Knowledge | `/app/knowledge-bases` |
| Memory | `/app/memory` |
| Squads | `/app/squads` |
| Bookings | `/app/scheduling` |

Partners also get **PARTNER → Partner Hub** (`/app/partner`).

### 5.4 Settings accordion (nested, `ml-2.5 border-l`)

Persist: `snapserve:settings-open`.

| Label | Href |
|---|---|
| Workspace | `/app/settings` |
| Providers | `/app/providers?tab=provider-keys` |
| Developers | `/app/api-keys` |
| Billing | `/app/wallet` |

Sidebar footer: Docs (hidden for managed) · wallet chip → Billing · user (Settings / theme / Sign out).

### 5.5 Managed-client nav (partner workspace)

Same primary seven. MORE = Knowledge + Bookings only (no Memory, Squads). Settings = Workspace, Developers, Billing (no Providers). Blocked prefixes: docs, memory, squads, providers, vibe, test-simulator, meet, partner hub, etc. (`lib/managed-client-surface.ts`).

### 5.6 Desktop utility strip

`h-10 justify-end` — **ThemeToggle + Bell only**. No page title here (StripePage owns the title). Hidden on `/app/vibe`.

### 5.7 Mobile

- Top: hamburger → left sheet `w-[min(100vw,280px)]`; brand; theme + user `ml-auto`.
- Bottom nav `grid-cols-5`: **Home | Campaigns | Create | Agents | History**.
- Main: `pt-[50px+safe]` / `pb-[3.5rem+safe]`.

### 5.8 Extra banners

- Impersonation (admin acting as user).
- Partner **acting-as** amber bar, Exit right.
- Voiceathon promo `justify-between` (not on white-label / managed).

Full-screen (no Layout): `/app/onboarding`, `/app/vibe`.

---

## 6. Shared page primitives

| Component | Job |
|---|---|
| `StripePage` | Canonical in-app page: optional back · title/desc left · actions right · optional tabs · `max-w-[1200px]` |
| `StripeTabPage` | Same + `?tab=` underline tabs + `tabActions` |
| `PageHeader` | Public/auth/onboarding brand bar |
| `DetailNav` | Outline back + crumbs (campaign/lead), no title |
| `AgentContextBar` | Agent select for Stripe `actions` (`?agentId=`) |
| `MetricStrip` | `grid-cols-2 sm:grid-cols-4` KPI cards, label over value |
| `SchedulingTabNav` | Bookings \| Setup → Connections calendar |
| `EmptyState` | Centered illustration + title + optional CTA |
| `GlobalSearch` | ⌘K palette |

**Back** always goes to `back.href` (not `history.back()`), so Connections setup does not skip the hub.

---

## 7. Audience gates

1. **Onboarding** — if `completed === false`, force `/app/onboarding` except partner-join / team-join. Skipped for managed clients.
2. **Managed workspace** — blocked routes bounce to `/app/home`.
3. **White-label host** — partner password login; `/sign-up` → `/sign-in`; docs/legal redirect to partner URLs.
4. **Idle logout** — dashboard only.

---

## 8. Dashboard pages A–Z

### Analytics — `/app/analytics`

- **Header right:** date pills Today / Yesterday / 7d / 30d.
- KPI cards + volume trend. Per-agent: `/app/analytics/agents/:id`.

### API keys / Developers — `/app/api-keys`

Tabs (`?tab=`):

| key | Label | Features |
|---|---|---|
| `api-keys` | API keys | Create, copy, revoke `sk_live` keys |
| `webhooks` | Event subscriptions | HMAC endpoints, event types |

No header CTA (create is in-list). Legacy `/app/webhooks` → this tab.

### Agents — `/app/agents`, `/app/agents/:id`

List rail (search + New) + builder. Not a StripeTabPage.

**Builder tabs (left → right):**

| id | Label | Features |
|---|---|---|
| `overview` | Overview | Name, language, readiness, test call / webcall |
| `prompt` | Script | System prompt, greeting, generate-prompt sheet |
| `voice` | Sound | STT / LLM / TTS, speakers, clones, Gemini Live, pace Fast/Balanced/Patient |
| `tools` | Actions | End call, email, WhatsApp, booking tools, custom HTTP, KB attach |
| `outcomes` | After the call | Dispositions, post-call notify |
| `analytics` | Activity | Per-agent call stats |
| `settings` | Settings | Engine, limits, website embed, integrations, IRDAI/DPDP/TRAI |
| `versions` | Versions | Publish, restore, compare |

Header: title left; readiness chips **Script / Sound**; save / publish right. Dialogs: pipeline, clone register, OTP dest, discard, delete.

### Automatic calls (Sheets) — `/app/automatic-calls`

List titled Google Sheets; back to Campaigns. **Connect sheet** header-right. Row: start / pause / resume / stop. Wizard `/new`, detail `/:id`. Empty: No Google Sheets yet.

### Bookings / Scheduling — `/app/scheduling`

Tab nav: **Bookings** | **Setup** (Connections calendar).  
Header right: **Set up calendar**. Filters: status, source, sync, calendar. Desktop table / mobile cards.

| Route | Page |
|---|---|
| `/app/scheduling/bookings/:id` | Booking detail |
| `/app/scheduling/calendars` | Calendars |
| `/app/scheduling/event-types` | Event types list |
| `/app/scheduling/event-types/:id` | Event type editor |
| `/app/scheduling/availability` | Hours / timezone |
| `/app/scheduling/conferencing` | Meet / Zoom / Teams |

Advanced tabs only appear when already on those URLs.

### Campaigns — `/app/campaigns`

Stripe title **Campaigns**. Description: Meta / Website / Sheets / CSV / Zoho.

**Primary:** source chips **New from** (form, Meta, CSV, Zoho, Sheets). Secondary: Export, Campaign guide, filters, MetricStrip. Wizard dialog. Empty: No campaigns yet.

**Detail** `/app/campaigns/:id` — crumbs, then tabs:

| id | Label |
|---|---|
| `overview` | Batches, **Create Batch**, pause/resume |
| `analytics` | Campaign KPIs |
| `live-queue` | Live dials |
| `incoming` | Inbound on campaign numbers |
| `callbacks` | Scheduled callbacks |
| `transfers` | Warm/cold transfers |
| `bookings` | Slots booked from this campaign |
| `config` | Timezone, hours, concurrency, dispositions, lead transfer, agent/squad |

**Batch wizard** `/app/campaigns/:id/batches/new` — source → mapping → execution → summary; footer **Next / Create**.  
**Batch detail** `.../batches/:batchId`.  
**Lead** `.../leads/:leadId` — Overview / Interactions / Notes / Memory / Tasks.

### Connections — `/app/connections`

Back Home. **Refresh** right. Shortcut grid: Phone numbers, WhatsApp, Email, Meetings. Then Sheets, HubSpot/Zoho, webhooks, Zapier/Make. Query `?setup=meta|calendar|…`. WhatsApp still at `/app/whatsapp`.

### History — `/app/history` (alias `/app/calls`)

| key | Label |
|---|---|
| `all-calls` | Calls (default, no `?tab=`) |
| `callbacks` | Callbacks |
| `transfers` | Transfers |

Calls: filters status / agent / disposition / q / date; table; open `/app/history/:id` (recording, transcript, translate, prev/next). Sidebar badge = pending callbacks.

### Home — `/app/home`

**Empty (no agents):** centered **Build with AI** (`/app/vibe`) vs **Configure manually**; managed skips AI.  
**Populated header right:** **Open agent** (outline) · **New campaign** (primary).  
Body: 4-up MetricStrip, volume chart, What’s running, Agents rail. Empty queue copy: Nothing in the queue yet.

### Knowledge — `/app/knowledge-bases`

**Add knowledge** right. Packs: FAQ / text / file / website. Delete dialog. Empty: No knowledge yet.

### Meet — `/app/meet`

Not in primary nav (Connections shortcut). Join Meet / Zoom / Teams; calendar; agent picker.

### Memory — `/app/memory`

Title **Customer Intelligence**. Full-bleed 3 panes: agents | callers | detail. Caller tabs: overview / facts / episodes / timeline / calls. Mobile: drill one pane at a time. Hidden for managed clients.

### Onboarding — `/app/onboarding` (no sidebar)

Full-screen: name, role, referral, prior platforms. Progress bar. **Continue** (Enter). Blocks the rest of `/app` until done.

### Partner — `/app/partner`

Clients, invites, branding/DNS, wallet ops. CTAs: Create client, Invite, set rate, transfer balance. Client: `/app/partner/clients/:clerkId`. Join: `/app/partner-join`. Team invite: `/app/join`.

### Phone numbers — `/app/phone-numbers`

Back Home. Owner: **Get number** header-right. Tabs **My numbers** | **Verification**. `?tab=buy-number` opens purchase on the list. Dialogs: buy, assign, routing, release. Managed: assign only, no Get number, no tabs. Legacy `/app/kyc` → Verification.

### Profile — `/app/settings/profile`

Account profile form (also reachable from user menu).

### Providers — `/app/providers`

| key | Label | Tab-row CTA |
|---|---|---|
| `provider-keys` | Provider keys | **Add Provider** |
| `voices` | Voices | Clone / register (tabActions) |
| `my-clones` | My clones | Clone / register |

BYOP STT/LLM/TTS keys + Cartesia/Sarvam voice library. Hidden for managed clients. `/app/voices` → `?tab=voices`.

### Settings / Workspace — `/app/settings`

| key | Label | Tab-row CTA |
|---|---|---|
| `workspace` | Workspace | — |
| `team` | Team | **Invite Member** (owner) |

Team: members table, roles, remove. `/app/team` → `?tab=team`.

### Squads — `/app/squads`, `/app/squads/:id`

**New team** right. Members, follow-up cancel. Hidden for managed.

### Test simulator — `/app/test-simulator`

Not in nav. Agent + tool select, params, **Run**, result log.

### Vibe — `/app/vibe` (no sidebar, no utility strip)

AI studio: chat + preview + scheduling wizard + webcall. Managed → `/app/agents?create=1`.

### Wallet / Billing — `/app/wallet`

| key | Label |
|---|---|
| `wallet` | Wallet — balance, Razorpay presets, autopay, txns, invoices |
| `usage` | Usage |

Managed copy: partner-funded, rate set by partner. `/app/usage` → `?tab=usage`.

### WhatsApp — `/app/whatsapp`

WABA / templates / chatbot / calling. Entry from Connections.

---

## 9. Redirects (legacy → current)

| From | To |
|---|---|
| `/app` | `/app/home` |
| `/app/call-plans*` | `/app/home` |
| `/app/people` | `/app/campaigns` |
| `/app/automation` | `/app/home` |
| `/app/channels` | ChannelsRedirect |
| `/app/command-center` | CommandCenterRedirect |
| `/app/events*` | `/app/home` |
| `/app/activity` | `/app/history` |
| `/app/callbacks` | `/app/history?tab=callbacks` |
| `/app/transfers` | `/app/history?tab=transfers` |
| `/app/voices` | `/app/providers?tab=voices` |
| `/app/usage` | `/app/wallet?tab=usage` |
| `/app/kyc` | `/app/phone-numbers?tab=verification` |
| `/app/webhooks` | `/app/api-keys?tab=webhooks` |
| `/app/team` | `/app/settings?tab=team` |
| `/app/meta-leads` | `/app/connections?setup=meta` |

---

## 10. Public & unauth pages

| Route | Layout | Features |
|---|---|---|
| `/`, `/sign-in`, `/sign-up` | Centered dark card `max-w-[400px]`, DotGrid, logo top, fields stacked, full-width submit | Direct SnapServe: ₹500 credit chip, Google + password. Partner host: email/password only, signup blocked |
| `/book/:slug` | PageHeader | Public slot picker, confirm CTA |
| `/book/cancel`, `/book/reschedule` | PageHeader | Manage booking |
| `/join/:token` | Standalone | Webcall join (no login) |
| `/workshop/:slug` | Standalone | Workshop form |
| `/events/:slug` | Public event | |
| `/events/judge/:token` | Judge portal | |
| `/events/certificates/:code/verify` | Cert verify | |
| `/privacy`, `/terms` | Legal | SnapServe host only; else partner URL |
| `/impersonate` | Token entry | Admin → user session |
| 404 | `not-found` | |

---

## 11. Docs (`/docs`)

SnapServe host only; managed clients redirected home.

Top tabs: Guides · API Reference · Changelog.

**Guide groups:**

- **Get started:** Introduction, What you can build, Platform concepts, Jarvis, Quick Start (API), Authentication, Claude skill & MCP  
- **Build agents:** Vibe, Agents & builder, Variables, Knowledge base, Caller memory, Test an agent  
- **Connect & channels:** Connections, WhatsApp, Bookings calendar, Meeting agents, Website embed, Phone numbers  
- **Calls & campaigns:** Calls & history, Campaigns, Event subscriptions, Wallet & billing  
- **Account:** Team workspace, Compliance  
- **Reference:** API Reference, SDKs, Errors, Pricing, FAQ, Changelog  

Docs chrome: left TOC, search, prev/next at page bottom.

---

## 12. Admin schema

Auth: `localStorage.adminToken`. No RBAC in UI. Default theme **dark**. Sidebar `w-64`; mobile sheet `w-72`. Top bar `h-14 justify-between`: menu + ⌘K left; search icon + theme + alerts right. Content `max-w-7xl mx-auto p-4 md:p-6`. Page headers: title left, actions `justify-end`. Login: centered card, password token, full-width **Authenticate**.

### 12.1 Sidebar groups

| Group | Default open | Items |
|---|---|---|
| Command Center | yes | Overview, Alerts |
| Analytics | no | SaaS Overview, Daily P&L, Users, Activation, Retention, Calls, Agents, Providers, Unit Economics, Board Unit Economics, Legacy Funnel, Signups, Company Pulse, Board Growth/Moat/Retention, All Agents, Usage Monitor, Analytics Directory |
| Revenue | no | Revenue, Wallets, Recharges, Phone Numbers |
| Cost & Pricing | no | Overview, Provider Costs, Customer Pricing, histories, Simulator, legacy pricing |
| Customers | yes | Users, Workspaces, Agents, Partners |
| Voice Operations | no | Live Calls, Call Analytics, Quality, Failures, Provider Performance |
| Product & Infrastructure | no | Overview, Managed Keys/Numbers, Providers, Voices, Prompts, System Prompts, Ambient, Integrations, Scheduling |
| Operations | no | Alerts, Health, Deployments, Emails, Email Reports, Audit |
| Programs | no | Voiceathon, Events, Team Guides, Partner inquiries |
| Settings | no | Platform, Admin Settings, DPDP, Control Hub, Money Hub |

**Routed, not in sidebar:** Family (companies/policies/KB/agents), Book Interns, several aliases (`/voices`, `/prompt-template`, `/health`, …).

### 12.2 Admin pages (purpose + typical right actions)

| Path | Purpose | Typical actions |
|---|---|---|
| `/` | Ops KPIs, failed calls, top users | Refresh |
| `/analytics*` | SaaS, P&L, growth, activation, retention, unit econ | Export CSV |
| `/call-analytics` | Volume + execution-id lookup | Search |
| `/finance` | Ledger, cash, cohorts | Date range |
| `/revenue/wallets` | Wallet liability | Search, Export |
| `/recharges` | Top-ups | Refresh, search |
| `/revenue/phone-numbers` | DID purchases | Refresh, search |
| `/cost-pricing*` | Versioned COGS / customer prices / simulator | New rate, Simulate |
| `/users`, `/users/:id` | Directory + impersonate, wallet, agents | CSV, Impersonate |
| `/users/:id/agents/:agentId` | Edit customer agent | Save |
| `/customers/workspaces` | Workspace economics | — |
| `/partners` | Partner program | New partner |
| `/all-agents` | Platform agent directory | Refresh |
| `/voice/live` | Active sessions | — |
| `/voice/failures` | Failure center | — |
| `/voice/call-quality` | Provider quality | — |
| `/voice/calls/:callId` | Call 360 | — |
| `/platform` | Live + failed with filters | Reset filters |
| `/managed-keys` | Platform API keys | New Key |
| `/managed-numbers` | DID pool | Add, Save |
| `/product/voices` | List/unlist Cartesia | Save Selection |
| `/product/prompt-templates` | Active prompt | Save / upload |
| `/product/system-prompts` | Template library | New Domain |
| `/product/ambient-sounds` | Ambient library | Add Sound |
| `/scheduling` | Platform bookings | Status/agent filters |
| `/usage*` | STT/TTS/LLM monitor | Add pricing / allocation |
| `/operations/alerts` | Alert rules | — |
| `/operations/health` | Connectivity | — |
| `/operations/deployments` | Railway deploys | Refresh |
| `/operations/emails` | Compose + log | Compose |
| `/operations/audit` | Audit trail | Apply / Clear |
| `/settings` | Platform toggles | Test notify |
| `/settings/admin` | Slack/email channels | Save |
| `/dpdp` | Data erasure | Erase (confirm) |
| `/events`, `/events/:id` | Workshop feedback | New event, Export |
| `/voiceathon*` | Competition | Create event, judges, results |
| `/landing-leads` | Partner-with-us form | Search |
| `/team-guides` | PDF downloads | Download |
| `/book-interns` | Curriculum progress | Search |
| `/family/*` | Insurance KB + agents | Add policy/doc, Create agent |

Section underline tab sets live in `nav-config.ts` (`ANALYTICS_TABS`, `MONEY_TABS`, `COST_PRICING_TABS`, `VOICE_TABS`, …).

---

## 13. Other SnapServe UIs (not the product dashboard)

| Artifact | What it is |
|---|---|
| `artifacts/snapserve-promo` | Motion promo player (GSAP/Three), not a site |
| `artifacts/snapserve-book` | Intern curriculum SPA (modules, exam, certificate) + `/voiceathon` playbook |
| `artifacts/mockup-sandbox` | Component preview; includes unused landing + console mockups |
| `artifacts/product-deck` | 16-slide investor deck |

---

## 14. Responsive checklist

| Breakpoint | Behavior |
|---|---|
| `< md` | No desktop sidebar; sheet + 5-tab bottom nav; no utility strip |
| `md+` | 216px sidebar; utility strip |
| Memory | 3 columns desktop; stacked drill-down mobile |
| Bookings | Cards `sm:hidden` / table `sm+` |
| Vibe | Side panels become Sheets on mobile |
| Stripe actions | `flex-wrap justify-end` so CTAs wrap under title on narrow widths |

---

## 15. Empty, error, loading

| State | Pattern |
|---|---|
| Loading shell | `AppLoader` + SnapServe icon |
| Page crash | Layout ErrorBoundary: message + **Reload** centered |
| Empty lists | `EmptyState` + one primary CTA matching the page (New campaign, Add knowledge, Get number, …) |
| Form errors | Inline under field + toast (`Toaster`) |
| Sign-in error | Red box above form, left-aligned text |

---

## 16. How to add a page without breaking UX

1. Put it in **NAV_GROUPS** or Settings — do not add a second top bar.  
2. Wrap with **StripePage** / **StripeTabPage**.  
3. Title + one-line description left; **one** primary button right (`size sm` / `h-9`).  
4. Secondary actions outline/ghost, still in the right cluster or in the row.  
5. Confirm destructive work in a dialog; footer buttons `justify-end`.  
6. Use token colors (`bg-primary`, `text-muted-foreground`) — not teal/saffron in chrome.  
7. If it is a new tab on an existing hub, add `?tab=` and a legacy redirect.  
8. If managed clients must not see it, add the prefix to `isBlockedForManagedClient`.

---

*This schema tracks the dashboard and admin as of the files cited. If a screen and this file disagree, the screen’s source file wins — then update this document.*
