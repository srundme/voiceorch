# SnapServe Sales Pipeline

Internal CRM for the SnapServe founding sales team: field visits, inbound enquiries, demos, pilots, proposals, payments, subscriptions, renewals and sprint reporting. It is an **internal tool** — customers never see it.

- UI: `/admin-ui/sales` (inside the existing admin panel build)
- API: `/api/sales/*` (inside the existing `api-server`)
- Data: 21 `sales_*` tables in the same Postgres as the platform
- Money is stored as integer **paise**; dates and "today" use the configured timezone (default `Asia/Kolkata`)

---

## 1. Architecture

| Piece | Where | Notes |
|---|---|---|
| Frontend | `artifacts/admin/src/pages/sales/*`, `components/sales/*`, `lib/sales-api.ts`, `hooks/use-sales-api.ts` | Lazy-loaded under the `/sales/*` route in `App.tsx`. Not behind the admin-token gate. |
| Bootstrap page | `artifacts/admin/src/pages/sales-setup.tsx` | Route `/sales-setup`, behind the normal admin-token gate (`ProtectedRoute`). |
| Router | `artifacts/api-server/src/sales/router.ts` (mounted from `src/routes/sales.ts` → `src/routes/index.ts`) | All business rules live in `src/sales/*-service.ts`. |
| Schema | `lib/db/drizzle/0127_sales_pipeline.sql`, `0128_sales_pipeline_2.sql`, `0129_sales_pipeline_3.sql` | Only references other `sales_*` tables — no foreign keys to platform tables. |

### Two separate auth systems

- **Platform admin** (`X-Admin-Token` = `ADMIN_TOKEN` or `SUPER_ADMIN_TOKEN`) is used for exactly **one** sales endpoint: `POST /api/admin/sales/bootstrap`.
- **Sales users** have their own accounts (`sales_users`), password hashes, invites (`sales_invites`) and server-side sessions (`sales_sessions`). Sessions are an opaque random token in the `ss_sales` cookie; only its SHA-256 hash is stored.
  - Cookie: `HttpOnly`, `SameSite=Strict`, `Path=/api/sales`, `Secure` when `NODE_ENV=production`.
  - CSRF: every non-GET/HEAD/OPTIONS request under `/api/sales` must send `X-Sales-Request: 1` (the frontend client does this), otherwise `403 Missing X-Sales-Request header`.
  - All `/api/sales` responses are `Cache-Control: no-store`.
- Platform Clerk/Google sessions and developer API keys grant **no** access to `/api/sales`.

### How production serves it

The root `Dockerfile` (and `artifacts/api-server/Dockerfile`) build the admin app with `BASE_PATH=/admin-ui/` and set `ADMIN_DIST_PATH=artifacts/admin/dist/public`, so `api-server` serves the admin SPA statically at `/admin-ui/` (SPA fallback to `index.html`). The sales UI is therefore at `https://<api-host>/admin-ui/sales` on the **same origin** as `/api/sales` — required for the `SameSite=Strict` cookie.

The `deploy/self-hosted/` distribution does **not** include the admin panel, so the sales UI is not available there.

### Migrations

`src/index.ts` binds the port first, then runs `bootstrapMigrationJournal()` and Drizzle `migrate()` against `lib/db/drizzle` in the background. `0127_sales_pipeline`, `0128_sales_pipeline_2` and `0129_sales_pipeline_3` are in `meta/_journal.json`, so they apply **automatically on the next boot**. No manual step.

- `0127` creates all tables and seeds `sales_targets`: daily targets 2026-10-03 → 2026-11-01 (16 visits / 6 conversations / 3 demos / 2 pilots per day, 0 on Sundays which are "review" days) and cumulative paid milestones (Oct 9: 2/5, Oct 16: 6/15, Oct 23: 12/30, Nov 1: 20/50 operating/stretch).
- `0128` adds `is_inbound`, `customer_notes`, proposal `sent_at` / `declined_at` / `decline_reason`, and indexes.
- `0129` adds `sales_touchpoints` (one row per enquiry: the original source plus every repeat webhook/import enquiry and merged leads), backfills an `original` touchpoint for every existing company and a `webhook` touchpoint for past repeat enquiries, and creates a scheduled demo activity + appointment task for any opportunity already in `Demo booked` that had no demo activity at its demo time.
- All use `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` / `NOT EXISTS` guards. If migration fails the server stays up and logs `DB migration failed — server will stay up for diagnostics`; check that log line after deploy.

---

## 2. Setup

### Environment variables

See [`sales.env.example`](./sales.env.example).

| Variable | Required | Used for |
|---|---|---|
| `DATABASE_URL` | yes | Same Postgres as the platform. |
| `ADMIN_TOKEN` | for bootstrap | Sent as `X-Admin-Token` to create the first founder invite. (`SUPER_ADMIN_TOKEN` also accepted.) |
| `SALES_WEBHOOK_SECRET` | only for the lead webhook | HMAC secret. If unset, the webhook returns `503 Lead webhook is not configured`. Everything else works without it. |
| `NODE_ENV=production` | yes in prod | Turns on the `Secure` cookie flag. Already set by the Dockerfiles. |
| `ADMIN_DIST_PATH` | yes in prod | Serves `/admin-ui/`. Already set by the Dockerfiles. |

There are **no hardcoded sales credentials** anywhere. Accounts exist only after an invite is accepted.

### First founder (one time)

Works only while there is **no active founder with a password**; afterwards it returns `409 An active founder already exists; founders invite teammates from the sales app`.

**Option A — UI.** Sign in to the admin panel, open `/admin-ui/sales-setup`, enter the founder's email, click **Create founder invite**, and copy the link.

**Option B — curl.**

```bash
curl -sS -X POST "https://<api-host>/api/admin/sales/bootstrap" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -d '{"email":"founder@example.com"}'
```

Response (`201`): `{ "invite": {...}, "token": "...", "inviteUrlPath": "/sales/invite/<token>" }`. Open `https://<api-host>/admin-ui` + `inviteUrlPath`.

The invite page asks for a name and a password (**minimum 10 characters**), creates the account, and signs the user in. Invites expire after **7 days**; creating a new invite for the same email revokes the previous pending one. The invite token is shown only once — treat the link like a password.

### Inviting a teammate

Founder → **Settings → Team** → invite by email with role `teammate` or `founder` (`POST /api/sales/users`). Copy the returned link and send it privately; **no email is sent**. Founders can also rename, change role, deactivate/reactivate users and revoke pending invites. Deactivating a user revokes all of their sessions immediately. The last active founder cannot be demoted or deactivated.

---

## 3. Roles (enforced server-side)

| Action | Founder | Teammate |
|---|---|---|
| Read everything (companies, pipeline, pilots, calendar, reports, settings, targets) | ✅ | ✅ |
| Manage users / invites (`/sales/users`, `/sales/invites/:id`) | ✅ | ❌ 403 |
| Change settings / targets | ✅ | ❌ 403 |
| Verify / reject / adjust (correct, refund) payments | ✅ | ❌ |
| Approve pilot extension | ✅ | ❌ |
| Override active-pilot capacity (with reason) | ✅ | ❌ |
| Change a pilot's attempt allowance from the default | ✅ | ❌ |
| Bypass pipeline stages (with reason) | ✅ | ❌ |
| Create / edit / delete expenses | ✅ | ❌ (read only) |
| Demo data seed / clear | ✅ | ❌ |
| Edit companies, contacts, opportunities, proposals, payments (record), subscriptions, pilots | any | only for companies they own (pilots: also if they own the pilot; opportunities: also if they own the opportunity) |
| Create leads | any owner | owned by self or unassigned |
| Assign company owner | any | only claim an unowned lead for themselves |
| Tasks / activities | any | own only; may claim unassigned tasks |
| Default Today/tasks scope | team | mine |

Every mutation writes a row to `sales_audit` (actor, entity, before/after, reason).

---

## 4. Daily usage

- **Today** (`/sales`) — the day's dashboard: new paying vs sprint goal, revenue, activity vs daily target, active pilots, overdue follow-ups, today's appointments, unassigned inbound leads, upcoming renewals, overdue / missing next actions, and a prioritised action list. Founders can switch between team and mine, and filter the team view to one owner.
- **Reminders** — the bell in the header lists your open tasks that are overdue or due in the next 2 hours (refreshed every minute). In-app only; nothing is pushed or emailed.
- **Demo booked** — the stage evidence (buyer + appointment time) creates or links one scheduled demo activity with an appointment task, so the demo shows in Today and the calendar. Changing the opportunity's demo time moves that activity.
- **Next actions** — completing or cancelling the task behind a company's next action clears the company's next action; rescheduling it moves the company's due date. Setting a new next action reopens the task. "Missing next action" means no next action **or** no due date.
- **Duplicates** — a fuzzy name match flags the new company for review. On the company page, the owner (or founder) can **Keep separate**; a founder can **Merge** a fresh lead (no pilots, proposals, payments or subscriptions, still `Identified`) into the matched company — contacts, activities, tasks and touchpoints move, the lead is deleted, and an audit row is written (`POST /api/sales/companies/:id/dedupe-review`).
- **Pipeline** — opportunities by stage: `Identified → Qualified → Demo booked → Demo completed → Pilot ready → Pilot running → Results reviewed → Proposal → Paid → Live`, plus side stages `Later` and `Lost`. Each forward move checks requirements (e.g. Qualified needs need, monthly calling volume, budget fit yes/no and a decision maker; Paid needs accepted terms **and** a verified first-month payment; Live needs a past production start date and complete onboarding checks). Moving backwards needs a note. Skipping stages is founder-only, needs a reason, can only skip demo/pilot stages and can reach Proposal at most. `Lost` and `Live` are final. CSV export available.
- **Pilots** — pilot lifecycle `Draft → Setup → Calling → Review due → Completed` (or `Cancelled` with a reason). Entering Setup checks readiness and the active capacity (default 6 non-demo pilots in Setup/Calling/Review due). Results are entered as snapshots (manual or CSV) and validated (e.g. answered ≤ attempts, meaningful ≤ answered). A printable pilot report is at `/sales/pilots/:id/report`. One extension per pilot (founder, default 100–200 extra attempts, with reason, cost limit and review date).
- **Calendar** — activities, pilot reviews, extension reviews, tasks, renewals and targets for a date range; mine or team.
- **Customers** — subscriptions: go live (creates Day 1/7/14/25 review tasks and a renewal task 5 days before renewal), pause/resume/cancel, renewals.
- **Reports** — date-ranged activity totals (optional group by city/sector/source/owner), funnel, stage ageing (0-7/8-14/15-30/31+ days), loss reasons, pilot costs, cash, new paying companies, MRR, renewals, pilot cohorts, acquisition cost by source, targets vs actuals and a forecast. CSV exports: companies, activities, payments, pilots, expenses.
- **Settings** — Team (founder), Configuration (timezone, sprint dates, goals, cities, sectors, sources, offer price/minutes/GST, pilot rules, daily targets, response target, business hours, default inbound owner, forecast assumptions; founder to save), Targets (founder: **Fill missing days from Configuration** → `POST /api/sales/targets/generate` adds rows only for days that have none, Sundays as review days, plus a sprint-end milestone from the goals; changing a day's type pre-fills its visits), Lead import, Demo data (founder), Webhook.

Defaults (from `settings-schema.ts`): sprint 2026-10-03 → 2026-11-01; goals 20 new paid (operating) / 50 (stretch) / ₹12,50,000 stretch MRR; offer ₹25,000/month, 5,000 minutes, 18% GST; pilot 200 attempts, 3 days; response target 15 business minutes; business hours 09:30–19:00 Mon–Sat.

---

## 5. Metric rules (exactly as implemented)

All report figures are computed in `report-service.ts` / `metrics.ts` / `revenue-core.ts`. Rates always return numerator and denominator; a zero denominator gives `null`, never 0% or ∞.

- **New paying company** — a company becomes newly paying on the date its **verified** `first_month` payments, **net of corrections and refunds**, cumulatively first reach the accepted proposal's monthly fee (or the subscription fee if there is no accepted proposal). Renewal payments never set `first_paid_at`. It is recomputed on every verify/reject/adjust. Reports count companies whose `first_paid_at` is in the period.
- **New live** — subscriptions whose `live_at` is in the period. Reported separately from new paying companies (paying = verified first-month payment; live = switched on).
- **MRR** — sum of monthly fees of non-demo subscriptions with status `active`. Paused and cancelled are excluded. Active subscriptions whose renewal date has passed without a verified renewal payment **stay in MRR** but are flagged overdue and reported separately (`overdueMrrPaise`, `overdueSubscriptions`). MRR is as of the period end (or today if earlier).
- **Renewals** — a verified renewal payment moves the renewal date forward one month, so a past renewal date means unpaid. A verified renewal payment cannot be rejected; record a refund adjustment instead.
- **Cash collected** — verified payments with `received_at` in the period **plus** corrections/refunds created in the period (on verified payments). **Fee and tax are kept separate** (`feePaise`, `taxPaise`, `totalPaise`), also broken down by payment kind. Recorded (unverified) and rejected payments never count.
- **New pilot** — counted once, on the day its onboarding started (`onboarding_started_at`, set when the pilot first enters Setup). The activity flag `flag_pilot_started` is informational only.
- **Pilot cohorts** — pilots grouped by week (Monday) or month of onboarding start. *Converted* = the company's `first_paid_at` is on or after that pilot's onboarding start. Also shows active, completed, cancelled, pending, cohort age in days.
- **Extensions** — an extension stays inside its original pilot; it never creates a new pilot or cohort entry. Cohorts show how many pilots used an extension. Results beyond the revised allowance are kept and flagged (`overAllowance`), not discarded.
- **Activity counts** — only `completed` activities with `occurred_at` in the period; visits, first visits, buyer conversations and demos come from activity flags.
- **Funnel** — counts of events inside the period (not a cohort), each step with a rate vs the previous step.
- **Pilot cost** — latest snapshot cost of pilots started in the period + expenses in category `pilot_cost` dated in the period.
- **Acquisition cost (CAC)** — expenses marked `isAcquisition` in the period, attributed by expense source; new paying companies counted by original lead source. `costPerNewPaidPaise` is **`null` when that source has 0 new paid** (no fake zero/infinite CAC).
- **Targets vs forecasts** — targets are plans (from `sales_targets`) shown next to actuals, never mixed with them. The forecast is labelled as derived only from the configured assumptions: remaining target visits × visit→conversation × conversation→demo × demo→pilot × pilot→paid, plus active pilots × pilot→paid. If any assumption is missing, `projected` is `null`.
- **Demo exclusion** — every row has `is_demo`. Reports, Today, calendar, exports and lists filter on the demo flag, so demo data never mixes with real figures; duplicate detection, webhook matching and lead import only match non-demo companies.

---

## 6. Demo mode

- Founder → **Settings → Demo data → Seed** creates 3 clearly fictional companies (names start with `Demo —`, `.example.invalid` emails, `+91 00000 0000x` phones) with contacts, activities, opportunities and stage history, a pilot with a snapshot, a proposal, a subscription, a payment, a task and an ad expense. Seeding twice is a no-op.
- The header **demo switch** (stored per browser) shows demo data only, with an amber "Demo mode" banner. Nothing in demo mode counts toward real results.
- **Clear** deletes all `is_demo = true` rows. Demo pilots do not consume active-pilot capacity.

---

## 7. CSV imports

Both imports parse the CSV in the browser and send JSON rows (max **5,000 rows** per request).

### Leads — Settings → Lead import

Columns: `name` (required), `website`, `city`, `sector`, `source`, `campaign`, `contactName`, `phone`, `email`, `enquiredAt` (ISO 8601 with offset).

1. **Preview** (`POST /api/sales/imports/leads/preview`) classifies each row:
   - `reject` — invalid, unknown sector/source (must match Settings), invalid phone/email, or no phone/email/website to dedupe on.
   - `skip` — same company as an earlier row in the file, or already exists with nothing new.
   - `update` — exact match (domain, phone or email) and the file fills empty website/city/sector or adds a new contact. Existing values are never overwritten.
   - `review` — similar name but no shared phone/email/domain. Not merged; the reviewer must choose `create` or `skip`.
   - `create` — new company.
2. **Commit** (`POST /api/sales/imports/leads/commit`) re-plans inside one transaction and applies it; a summary is stored in `sales_imports`.

**Idempotency:** re-importing the same file creates nothing new — matched rows become `skip`/`update`.

### Pilot snapshots — Pilot detail → Import CSV

Columns: `snapshotKey` (optional), `asOf` (ISO 8601 with offset, required), `attempts`, `distinctRecords`, `answered`, `meaningful`, `qualifiedPeople`, `acceptedOutcomes`, `callbackRequests`, `confirmedAppointments`, optional `connectedMinutes`, and `costPaise` **or** `costRupees` (not both).

**Idempotency:** snapshots are keyed by `(pilot, snapshotKey)`; with no key, the key is `import:<asOf>`. Re-importing the same row is `unchanged`; a changed row is `corrected` (with an audit row). Rejected rows are listed with the reason; valid rows still import.

---

## 8. Lead webhook

`POST /api/sales/webhooks/leads` — for a website form or a future ad-platform connector to push inbound leads.

> **There is no Meta / Instagram / Google Ads connector.** Nothing pulls leads from any ad platform. This endpoint is what your own form backend, Zapier-style tool, or a future connector would call.

### Request

Headers:

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `X-SnapServe-Signature` | `sha256=` + hex HMAC-SHA256 of the **exact raw body bytes** using `SALES_WEBHOOK_SECRET` |
| `X-Event-Id` | Unique id for this enquiry (required, max 200 chars). Used for idempotency. |

No `X-Sales-Request` or cookie is needed.

Body:

```json
{
  "source": "website_form",
  "campaign": "oct-hr-consultancy",
  "enquiredAt": "2026-10-05T10:15:00+05:30",
  "company": { "name": "Acme HR", "website": "acmehr.example", "city": "Bengaluru", "sector": "HR consultancy" },
  "contact": { "name": "Priya", "phone": "+91 98xxxxxxxx", "email": "priya@acmehr.example" },
  "consent": { "text": "I agree to be contacted", "capturedAt": "2026-10-05T10:15:00+05:30", "method": "website_form_checkbox" }
}
```

- `source` must be one of the configured sources (default: `field_visit`, `instagram_ad`, `website_form`, `referral`, `other`), otherwise `400` with the allowed list.
- `sector` is stored only if it matches a configured sector; otherwise ignored.
- Optional `eventId` in the body must equal `X-Event-Id`.
- `consent` is stored as contact-permission evidence.

### Signing example

```bash
SECRET='<SALES_WEBHOOK_SECRET>'
BODY='{"source":"website_form","enquiredAt":"2026-10-05T10:15:00+05:30","company":{"name":"Acme HR"},"contact":{"phone":"+919800000000"}}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.*= //')"

curl -sS -X POST "https://<api-host>/api/sales/webhooks/leads" \
  -H "Content-Type: application/json" \
  -H "X-SnapServe-Signature: $SIG" \
  -H "X-Event-Id: form-2026-10-05-0001" \
  --data-raw "$BODY"
```

Sign and send the same bytes (don't re-serialise the JSON after signing).

### Responses

| Status | Body | Meaning |
|---|---|---|
| `201` | `{ "duplicate": false, "eventId", "companyId", "created": true }` | New company created (marked inbound, first-response task created). |
| `201` | `{ "duplicate": false, "eventId", "companyId", "created": false }` | Matched an existing company by domain/phone/email ("repeat enquiry"): new contact added if unknown, a first-response task created, a `webhook` touchpoint recorded (the original source is never overwritten), audit row written. |
| `200` | `{ "duplicate": true, "eventId", "companyId" }` | Same `X-Event-Id` already processed — nothing changed. Safe to retry. |
| `400` | `{ "error", ... }` | Missing/oversized `X-Event-Id`, invalid body, unknown source, body `eventId` mismatch. |
| `401` | `Invalid signature` | Bad or missing signature. |
| `429` | `Too many requests` | Over 60 requests/min per IP. |
| `503` | `Lead webhook is not configured` | `SALES_WEBHOOK_SECRET` not set. |

Every event (raw payload included) is stored in `sales_webhook_events`. The first-response task is due `responseTargetMinutes` (default 15) **business minutes** after `enquiredAt` and goes to the company owner. New inbound companies are owned by the **default inbound owner** from Settings if that user is active; otherwise owners rotate round-robin across active sales users. Leads with no owner (e.g. created before any user existed) show as unassigned inbound on Today.

---

## 9. Integrations — what works and what doesn't

The sales pipeline **does not** place calls, charge money, or send messages/emails.

- **Phone / WhatsApp / email / map buttons** only open external apps: `tel:`, `https://wa.me/<number>?text=…` (WhatsApp opens with a prefilled draft; the user still presses send), `mailto:`, Google Maps search.
- **Invites** are links you copy and send yourself.
- **Payments** are recorded manually and verified by a founder. No Razorpay/payment-gateway link.
- **Pilots**: the SnapServe campaign ID (`campaignRef`), report link and recording links are **stored as text only**. Pilot results come from manual entry or CSV snapshots — nothing is pulled from the platform automatically.
- **Lead webhook** is the only inbound integration (section 8). No Meta/Instagram/Google Ads connector.
- **CSV export** is a download; nothing is pushed to Google Sheets or other tools.

---

## 10. Backup and restore

The sales data is entirely in `sales_*` tables in the platform Postgres. Your existing full-DB backup covers it; a separate sales-only dump is useful before risky changes.

### Backup

```bash
# Sales tables only (custom format, compressed)
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges \
  --table='public.sales_*' \
  --file="sales-$(date +%Y%m%d-%H%M).dump"

# Or the full database
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges \
  --file="snapserve-full-$(date +%Y%m%d-%H%M).dump"
```

Schedule: at least **daily** (e.g. cron or a Railway cron service), keep 14–30 days, store off-host (encrypted bucket). Dumps contain contact details and password hashes — treat them as confidential. Also take one before any manual DB work.

### Restore

1. Stop writes (scale the api-server to 0 or put the app in maintenance).
2. Sales-only restore into the same DB (replaces sales data):
   ```bash
   pg_restore --dbname="$DATABASE_URL" --no-owner --no-privileges \
     --clean --if-exists sales-YYYYMMDD-HHMM.dump
   ```
   For a full-DB restore, restore into a **new** database and point `DATABASE_URL` at it.
3. Start the api-server. Migrations are idempotent and will not overwrite restored rows.
4. Existing sessions in the restored `sales_sessions` remain valid until they expire; to force everyone to sign in again, run `UPDATE sales_sessions SET revoked_at = now() WHERE revoked_at IS NULL;`.

### Test a restore (monthly)

```bash
createdb sales_restore_test
pg_restore --dbname=sales_restore_test --no-owner --no-privileges sales-YYYYMMDD-HHMM.dump
psql sales_restore_test -c "SELECT count(*) FROM sales_companies; SELECT count(*) FROM sales_payments; SELECT max(created_at) FROM sales_audit;"
dropdb sales_restore_test
```

---

## 11. Private deployment checklist

- **The admin-ui static files are public** (anyone can download the JS bundle at `/admin-ui/`), but **all `/api/sales/*` data endpoints require a sales session**, and bootstrap requires `X-Admin-Token`. The webhook is protected by HMAC.
- **Recommended:** restrict `/admin-ui/*` and `/api/sales/*` with an IP allow-list, VPN, or Cloudflare Access (or similar). If you do, **exclude `/api/sales/webhooks/leads`** so your form backend can still reach it (it has its own HMAC check).
- **HTTPS is required** in production: with `NODE_ENV=production` the cookie is `Secure`, so login will not stick over plain HTTP. Serve the UI and API from the same origin.
- **Rotate `SALES_WEBHOOK_SECRET`** if it leaks or a sender changes: update the env var, redeploy, update the sender. There is a single secret, so requests signed with the old one fail with `401` immediately — coordinate the switch.
- **Sessions:** 14 days, sliding — while in use, the expiry is pushed forward (at most once every 5 minutes). Logout revokes the session server-side; deactivating a user revokes all their sessions.
- **Lockout:** 8 wrong passwords lock the account for 15 minutes. Login errors are always the generic `Invalid email or password` (no account enumeration).
- **Rate limits** (per `router.ts`; `/api/sales/` is exempt from the global platform IP limiter in `lib/rate-limit.ts`):
  - Login: 10 attempts / 15 min per IP + email.
  - Invite view/accept: 30 / 15 min per IP.
  - Signed-in API: 600 / min per session (per IP when there is no cookie).
  - Lead webhook: 60 / min per IP.
  - `POST /api/admin/sales/bootstrap` falls under `/api/admin`, which is exempt from the global limiter — keep `ADMIN_TOKEN` strong.
- `app.set("trust proxy", 1)` is set, so per-IP limits use the first proxy hop's `X-Forwarded-For`. If you add another proxy layer (e.g. Cloudflare in front of Railway), verify IPs are still correct.
- Never commit `.env` files. Use the platform's secret manager (Railway Variables).

---

## 12. Running tests

From the repo root:

```bash
pnpm --filter @workspace/api-server exec vitest run src/sales
```

- **Default:** DB-backed tests run on an in-process **PGlite** database with `0127` + `0128` + `0129` applied — no Postgres needed.
- **Real Postgres:** set `SALES_TEST_DATABASE_URL`. Tests create a throwaway schema `sales_test_<pid>_<ts>`, run there and drop it afterwards. Use a disposable database, not production.
  ```bash
  SALES_TEST_DATABASE_URL=postgres://user:pass@localhost:5432/sales_test \
    pnpm --filter @workspace/api-server exec vitest run src/sales
  ```
- If the DB cannot start, DB-backed tests are skipped with a `[sales tests] skipping DB-backed tests` warning — check for it in CI output.

Test files: `metrics.test.ts`, `stages.test.ts`, `phase2-helpers.test.ts`, `sales-api.test.ts`, `sales-workflows.test.ts`, `sales-audit-fixes.test.ts`.

---

## 13. Known limitations

- No ad-platform connectors (Meta/Instagram/Google Ads); inbound leads arrive only via the webhook, CSV, or manual entry.
- No outbound email/WhatsApp/SMS, no calling from the CRM, no payment gateway — all external actions are manual.
- Pilot results are not pulled from SnapServe campaigns; enter snapshots manually or by CSV.
- No self-service password reset. Workaround: a founder deactivates the user, sends a new invite to the same email, and the user sets a new password when accepting (active accounts cannot be re-invited). There is no 2FA.
- Only one webhook secret (no overlap window during rotation).
- One extension per pilot.
- Single timezone for the whole team (Settings → timezone).
- Seeded targets cover the 2026-10-03 → 2026-11-01 sprint only; for a new sprint, update Settings and use **Fill missing days from Configuration**.
- Lead import fuzzy-name matches are never auto-merged; they need a create/skip decision. Merging companies later is founder-only and limited to fresh leads.
- Reminders are in-app only (header bell); there are no push, email or SMS notifications.
- Not included in the `deploy/self-hosted` distribution.
- CSV imports are capped at 5,000 rows per request.
