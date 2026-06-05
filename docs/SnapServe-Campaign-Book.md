# SnapServe Campaign Module — The Complete Technical Guide

> **Last updated:** 2026-06-05
> **Version:** 1.0
> **Purpose:** Deep-dive guide for the Campaign module — outbound calling at scale. Covers architecture, data flow, debugging, and operational procedures.

---

## Table of Contents

1. [Executive Overview](#1-executive-overview)
2. [Architecture & Data Model](#2-architecture--data-model)
3. [Campaign Lifecycle](#3-campaign-lifecycle)
4. [Batch Creation & Wizard Flow](#4-batch-creation--wizard-flow)
5. [Lead Import Methods](#5-lead-import-methods)
6. [Call Execution Engine](#6-call-execution-engine)
7. [Outcomes & Dispositions](#7-outcomes--dispositions)
8. [Command Center](#8-command-center)
9. [Campaign Analytics](#9-campaign-analytics)
10. [Callbacks & Retry System](#10-callbacks--retry-system)
11. [Call Transfers](#11-call-transfers)
12. [Incoming Calls](#12-incoming-calls)
13. [Campaign Bookings](#13-campaign-bookings)
14. [Lead CRM (Ops)](#14-lead-crm-ops)
15. [Frontend Pages](#15-frontend-pages)
16. [API Routes Reference](#16-api-routes-reference)
17. [Debugging Guide](#17-debugging-guide)
18. [Common Issues & Quick Fixes](#18-common-issues--quick-fixes)

---

## 1. Executive Overview

The **Campaign Module** is SnapServe's outbound calling engine. It enables users to create large-scale voice campaigns — upload thousands of leads, schedule them into batches, and have AI agents call them automatically.

### Key Concepts

| Concept | Definition |
|---------|------------|
| **Campaign** | A container with an agent, settings, and a pool of leads. Think of it as a "project." |
| **Batch** | A subset of leads within a campaign, scheduled to run at a specific time. Batches control when and how fast calls are made. |
| **Lead** | A person to call — has a phone number, name, email, and arbitrary metadata. |
| **Call Execution** | The actual act of placing a call via the telephony provider (Twilio/Plivo/Vobiz). |
| **Outcome** | The system-level result of a call (e.g., `booking_created`, `no_contact`). Immutable, set by the engine. |
| **Disposition** | The user-defined category of a call (e.g., "Interested", "Not Interested"). Set by the agent or LLM. |
| **Callback** | A request by the lead to be called back at a specific time. |
| **Transfer** | Handing off the call to a human agent (warm or cold). |

---

## 2. Architecture & Data Model

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         DASHBOARD (React)                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Campaign List │  │ Campaign Detail │  │ Batch Wizard   │  │ Command Center │ │
│  │   (/app/        │  │   (/app/        │  │   (/app/        │  │   (/app/        │ │
│  │  campaigns)    │  │  campaigns/:id) │  │ campaigns/     │  │  command-center)│ │
│  └──────────────┬──────┘  └──────────────┬──────┘  └──────────────┬──────┘  └──────────────┬──────┘ │
│         │                  │                  │                  │             │
│         └─────────────────────────────────────────────────────────────────────────────────┘             │
│                                    │                                     │
│                              API SERVER (Express)                       │
│  ┌──────────────────────────────────────────────────────────────────────────┐     │
│  │  Routes:                                                              │     │
│  │  /api/campaigns          │ CRUD campaigns                              │     │
│  │  /api/campaigns/:id/batches   │ CRUD batches                           │     │
│  │  /api/campaigns/:id/leads     │ CRUD leads                             │     │
│  │  /api/campaigns/:id/callbacks │ Callback management                    │     │
│  │  /api/campaigns/:id/transfers │ Transfer tracking                      │     │
│  │  /api/campaigns/:id/bookings  │ Booking tracking                       │     │
│  │  /api/campaigns/:id/incoming  │ Incoming call tracking                 │     │
│  │  /api/campaigns/:id/analytics │ Batch analytics                        │     │
│  │  /api/command-center          │ Real-time monitoring                   │     │
│  │  /api/campaign-webhook        │ Public lead ingestion                  │     │
│  │  /api/campaign-ops            │ Lead CRM (sources, transfers, notes)   │     │
│  │  /api/campaign-callbacks      │ Callback management (Phase 3B)         │     │
│  │  /api/campaign-incoming       │ Incoming calls (Phase 3C)              │     │
│  │  /api/campaign-bookings       │ Booking tracking (Phase 3D)            │     │
│  │  /api/campaign-transfers      │ Transfer tracking (Phase 3E)           │     │
│  │  /api/live-queue              │ Live call queue                        │     │
│  │  /api/batch-workspace         │ Batch management workspace             │     │
│  │  /api/lead-workspace          │ Lead management workspace              │     │
│  │  /api/wizard                  │ Agent/batch wizard                     │     │
│  └─────────────────────────────────────────────────────────────────────────────────┘     │
│         │                                                            │     │
│  ┌──────────────────────────────────────────────────────────────────────────┐     │
│  │  Orchestration Layer                                                │     │
│  │  ┌─────────────────────────────────────────────────────────────────────────────────┐    │
│  │  │  campaignCaller.ts         │  Fires outbound calls                   │    │
│  │  │  telephony/dial.ts          │  Twilio/Plivo/Vobiz dialing            │    │
│  │  │  pipeline.ts               │  Voice call pipeline (STT→LLM→TTS)     │    │
│  │  │  retryEngine.ts            │  Auto-retry failed calls                │    │
│  │  │  duplicate-detection.ts     │  Duplicate lead detection               │    │
│  │  │  operational-outcome.ts    │  Outcome tracking & timeline            │    │
│  │  └─────────────────────────────────────────────────────────────────────────────────┘    │
│  └─────────────────────────────────────────────────────────────────────────────────┘     │
│         │                                                            │     │
│  ┌──────────────────────────────────────────────────────────────────────────┐     │
│  │  DATA LAYER                                                          │     │
│  │  ┌──────────────────────────────────────────────────────────────────────────┐     │
│  │  │  Postgres (Drizzle)                                                  │     │
│  │  │  campaigns, campaign_batches, campaign_leads, call_executions,       │     │
│  │  │  call_callbacks, call_retries, incoming_calls, call_bookings,        │     │
│  │  │  call_transfers, lead_timeline, batch_daily_metrics,                │     │
│  │  │  batch_health_snapshots, lead_sources, lead_transfers,               │     │
│  │  │  lead_notes, lead_tasks, lead_tags, batch_import_runs,               │     │
│  │  │  scheduled_callbacks, workspace_dnc                                  │     │
│  │  └─────────────────────────────────────────────────────────────────────────────────┘     │
│  └─────────────────────────────────────────────────────────────────────────────────┘     │
└────────────────────────────0─────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Database Tables

#### `campaigns` — Campaign Container

```sql
id:                   serial (PK)
userId:               text (FK → users.clerk_id)
name:                 text
description:          text
agentId:              integer (FK → agents.id, onDelete: set null)
status:               text ("draft" | "active" | "paused" | "completed")
webhookToken:         text (unique, auto-generated UUID)
fieldMappings:        json (default { phone: "phone" })
fromNumber:           text (caller ID)
callDelaySeconds:     integer (default 5, delay between calls)
maxAttempts:          integer (default 1, retry count)
retryDelayMinutes:    integer (default 60, delay between retries)
totalLeads:           integer (default 0, auto-updated)
calledLeads:          integer (default 0, auto-updated)
concurrentCallLimit:  integer (default 20, max parallel calls)
isActive:             boolean (default false)
```

#### `campaign_batches` — Batch of Leads

```sql
id:                 serial (PK)
campaignId:         integer (FK → campaigns.id, cascade)
name:               text
status:             text ("draft" | "scheduled" | "running" | "completed" | "cancelled")
leadSource:         text ("csv" | "meta" | "webhook")
leadSourceId:       integer (FK → lead_sources.id)
scheduledStartAt:   timestamp
scheduledEndAt:     timestamp
totalLeads:         integer (default 0)
calledLeads:        integer (default 0)
fieldMappings:      json (default { phone: "phone" })
callDelaySeconds:   integer (default 5)
maxAttempts:        integer (default 1)
retryDelayMinutes:  integer (default 60)
timezone:           text (e.g., "America/New_York")
businessHoursStart: integer (0-23)
businessHoursEnd:   integer (0-23)
maxDailyCalls:      integer (limit calls per day)
duplicatePolicy:    text ("ignore" | "skip" | "reject_with_report")
batchFieldMapping:  json (override field mapping per batch)
```

#### `campaign_leads` — Individual Leads

```sql
id:                 serial (PK)
campaignId:         integer (FK → campaigns.id, cascade)
batchId:            integer (FK → campaign_batches.id, set null)
leadSourceId:       integer (FK → lead_sources.id)
phone:              text (not null)
normalizedPhone:    text (E.164 format, set by import)
name:               text
email:              text
leadData:           json (Record<string, string> — all imported fields)
callStatus:         text ("pending" | "calling" | "completed" | "failed" | "skipped" | "transferred")
operationalOutcome: text ("pending" | "booking_created" | "transfer_completed" | "callback_requested" | "interest_confirmed" | "no_contact" | "dnc_blocked" | "failed")
disposition:        text (user-defined category)
callId:             integer (FK → calls.id)
callAttempts:       integer (default 0)
lastAttemptAt:      timestamp
source:             text ("csv" | "webhook" | "instagram_ads")
externalLeadId:     text (e.g., Meta lead ID)
notes:              text
ownerId:            text (assigned user)
ownerType:          text ("unassigned" | "user" | "team")
leadScore:          integer (auto-calculated)
duplicateOfLeadId:  integer (FK → campaign_leads.id)
duplicateStatus:    text ("duplicate" | "original")
```

**Indexes:**
- `campaign_leads_campaign_id_idx` — Filter by campaign
- `campaign_leads_batch_id_idx` — Filter by batch
- `campaign_leads_call_status_idx` — Filter by status
- `campaign_leads_operational_outcome_idx` — Filter by outcome
- `campaign_leads_normalized_phone_idx` — Deduplication
- `campaign_leads_campaign_status_idx` — Compound: campaign + status

#### `call_executions` — Call Execution Log

```sql
id:            serial (PK)
campaignId:    integer (FK → campaigns.id)
leadId:        integer (FK → campaign_leads.id)
batchId:       integer (FK → campaign_batches.id)
callId:        integer (FK → calls.id)
attemptNumber: integer (1-based)
outcome:       text (operational outcome)
detectedIntent: text (LLM-detected intent)
startedAt:     timestamp
endedAt:       timestamp
```

#### `call_callbacks` — Callback Requests

```sql
id:            serial (PK)
campaignId:    integer (FK → campaigns.id)
leadId:        integer (FK → campaign_leads.id)
callbackAt:    timestamp (when to call back)
responseDueBy: timestamp (SLA deadline)
reason:        text (why callback was requested)
rawExtract:    text (raw transcript snippet)
status:        text ("pending" | "completed" | "cancelled")
```

**SLA tracking:**
- `overdue` — `responseDueBy` < now
- `due-soon` — `responseDueBy` within 15 minutes
- `ok` — `responseDueBy` > 15 minutes

#### `call_retries` — Retry Queue

```sql
id:            serial (PK)
campaignId:    integer (FK → campaigns.id)
leadId:        integer (FK → campaign_leads.id)
attemptNumber: integer
scheduledAt:   timestamp (when to retry)
status:        text ("pending" | "fired" | "cancelled" | "completed")
reason:        text (why retry was scheduled)
```

**Auto-processed by:** `retryEngine.ts` every 60 seconds.

#### `batch_daily_metrics` — Pre-aggregated Daily Stats

```sql
id:            serial (PK)
batchId:       integer (FK → campaign_batches.id)
date:          text ("YYYY-MM-DD" UTC)
leadsImported: integer
connected:     integer
booked:        integer
transferred:   integer
failed:        integer
callbacks:     integer
```

**Purpose:** Pre-aggregated so Phase 7 Analytics can avoid expensive historical scans.
**Unique:** `(batch_id, date)` — one row per batch per day.

#### `batch_health_snapshots` — Real-time Batch Health

```sql
id:            serial (PK)
batchId:       integer (FK → campaign_batches.id)
campaignId:    integer (FK → campaigns.id)
totalLeads:    integer
validLeads:    integer
duplicates:    integer
queued:        integer
calling:       integer
connected:     integer
completed:     integer
callbacks:     integer
incomingCalls: integer
booked:        integer
transferred:   integer
failed:        integer
noPickup:      integer
interested:    integer
outcomeBreakdown: json
```

**Purpose:** Command center snapshots. Updated every few minutes.

#### `lead_sources` — Reusable Lead Sources

```sql
id:            serial (PK)
userId:        text
sourceType:    text ("csv" | "webhook" | "instagram_ads" | "meta_lead_ads")
sourceName:    text
metaFormId:    text (Meta Lead Ads form ID)
webhookId:     integer
fieldMapping:  json (Record<string, string> — source field → role)
```

**Purpose:** Workspace-level reusable sources. Multiple campaigns can reference the same source.

#### `lead_transfers` — Lead Ownership Transfers

```sql
id:            serial (PK)
leadId:        integer (FK → campaign_leads.id)
campaignId:    integer (FK → campaigns.id)
callExecutionId: integer (FK → call_executions.id)
transferredTo: text (new owner)
outcome:       text
durationSeconds: integer
transferTime:  timestamp
```

#### `lead_notes` — CRM Notes

```sql
id:            serial (PK)
leadId:        integer (FK → campaign_leads.id)
userId:        text
content:       text
```

#### `lead_tasks` — CRM Tasks

```sql
id:            serial (PK)
leadId:        integer (FK → campaign_leads.id)
userId:        text
title:         text
status:        text ("pending" | "completed")
dueAt:         timestamp
```

#### `lead_tags` — CRM Tags

```sql
id:            serial (PK)
leadId:        integer (FK → campaign_leads.id)
userId:        text
tag:           text
```

#### `lead_timeline` — Event Timeline

```sql
id:            serial (PK)
leadId:        integer (FK → campaign_leads.id)
campaignId:    integer (FK → campaigns.id)
eventType:     text ("call_started" | "call_completed" | "call_failed" | "dnc_blocked" | "callback_requested" | "transfer_triggered" | "manual_retry" | "booking_created" | "outcome_set" | "disposition_set")
data:          json
```

#### `incoming_calls` — Inbound Call Tracking

```sql
id:                 serial (PK)
campaignId:         integer (FK → campaigns.id)
leadId:             integer (FK → campaign_leads.id)
callId:             integer (FK → calls.id)
phone:              text
incomingCallStatus: text ("unreviewed" | "reviewed" | "actioned")
incomingCallReason: text
matchedAt:          timestamp
```

#### `call_bookings` — Booking Records (Campaign-scoped)

```sql
id:                  serial (PK)
campaignId:          integer (FK → campaigns.id)
leadId:              integer (FK → campaign_leads.id)
callId:              integer (FK → calls.id)
batchId:             integer (FK → campaign_batches.id)
schedulingBookingId: integer (FK → bookings.id)
meetingTime:         timestamp
meetingStatus:       text ("scheduled" | "completed" | "cancelled")
meetingLink:         text
bookedBy:            text
notes:               text
```

#### `call_transfers` — Transfer Records

```sql
id:                 serial (PK)
callId:             integer (FK → calls.id)
transferTo:         text (target number)
transferName:       text
status:             text ("initiated" | "connected" | "completed" | "failed" | "cancelled")
providerTransferId: text
initiatedAt:        timestamp
connectedAt:        timestamp
completedAt:        timestamp
```

**Join path:** `call_transfers` → `call_executions` (via `call_id`) → `campaigns`

#### `scheduled_callbacks` — Callback Scheduling

```sql
id:            serial (PK)
campaignId:    integer (FK → campaigns.id)
leadId:        integer (FK → campaign_leads.id)
scheduledAt:   timestamp
status:        text ("pending" | "completed" | "cancelled")
```

#### `workspace_dnc` — Do-Not-Call List

```sql
id:            serial (PK)
userId:        text
phone:         text (E.164)
reason:        text
```

**Purpose:** Campaign-wide DNC list. All lead imports check against this.

---

## 3. Campaign Lifecycle

### 3.1 Phase 1: Create Campaign

**Dashboard:** `/app/campaigns` → "Create Campaign" button

**API:** `POST /api/campaigns`

```json
{
  "name": "Summer Sale 2026",
  "description": "Outbound calls for summer promotion",
  "agentId": 42,
  "fromNumber": "+1234567890",
  "concurrentCallLimit": 20,
  "callDelaySeconds": 5,
  "maxAttempts": 2,
  "retryDelayMinutes": 60,
  "fieldMappings": { "phone": "phone", "name": "name", "email": "email" }
}
```

**What happens server-side:**
1. Validate `CreateCampaignBody` (Zod schema)
2. Auto-generate `webhookToken` (UUID) for webhook ingestion
3. Set `status: "draft"`, `isActive: false`
4. Set `totalLeads: 0`, `calledLeads: 0`
5. Insert into `campaigns` table
6. Return campaign with `webhookToken`

**Field Mappings:**
- Maps source field names to roles: `{ "phone": "phone", "name": "name", "email": "email" }`
- When importing leads, the system looks up these fields in the raw data
- Example: if mapping is `{ "phone": "mobile", "name": "full_name" }`, the system extracts `mobile` as phone and `full_name` as name

### 3.2 Phase 2: Add Leads

**Dashboard:** Campaign Detail → "Import Leads" or "Upload CSV"

**Three methods:**
1. **CSV Upload** — `POST /api/campaigns/:id/import-leads`
2. **Webhook** — `POST /api/campaign/webhook/:token` (public, no auth)
3. **Meta Lead Ads** — Facebook integration via `POST /api/campaign/webhook/:token` with Meta format

See [Lead Import Methods](#5-lead-import-methods) for details.

### 3.3 Phase 3: Create Batch

**Dashboard:** Campaign Detail → "Create Batch" or Batch Wizard

**API:** `POST /api/campaigns/:id/batches`

```json
{
  "name": "Week 1 Batch",
  "leadSource": "csv",
  "scheduledStartAt": "2026-06-10T09:00:00Z",
  "scheduledEndAt": "2026-06-10T17:00:00Z",
  "timezone": "America/New_York",
  "businessHoursStart": 9,
  "businessHoursEnd": 17,
  "maxDailyCalls": 100,
  "duplicatePolicy": "skip"
}
```

**What happens:**
1. Validate batch data
2. Insert into `campaign_batches` with `status: "draft"`
3. Leads are associated with the batch (via `batchId`)
4. `totalLeads` is updated on both campaign and batch

### 3.4 Phase 4: Launch Batch

**Dashboard:** Campaign Detail → Batch → "Start" button

**API:** `PATCH /api/campaigns/:id/batches/:batchId` (set `status: "running"`)

**What happens:**
1. Batch status changes to `"running"`
2. Campaign status changes to `"active"` (if not already)
3. `fireStartBatch()` is called
4. For each pending lead: `scheduleCampaignCall(lead, campaign)` is called
5. Calls are queued with `callDelaySeconds` delay between them
6. `campaign.totalLeads` and `campaign.calledLeads` are updated

### 3.5 Phase 5: Monitor

**Dashboard:** Command Center (`/app/command-center`) or Campaign Detail

**Real-time data:**
- `GET /api/command-center` — Active campaigns, calling leads, completed calls
- `GET /api/campaigns/:id/batches/:batchId/analytics` — Batch-level stats
- `GET /api/live-queue` — Live call queue

### 3.6 Phase 6: Pause/Complete

**Pause:** `PATCH /api/campaigns/:id` (set `isActive: false`)
- New calls are not started
- In-progress calls continue

**Complete:** `PATCH /api/campaigns/:id` (set `status: "completed"`)
- Campaign is marked complete
- No more calls are made

---

## 4. Batch Creation & Wizard Flow

### 4.1 Batch Wizard (Frontend)

**Page:** `/app/campaigns/batch-wizard`

**Flow:**
1. **Select Campaign** — Choose which campaign to add batch to
2. **Name & Description** — Batch metadata
3. **Lead Source** — Choose source type: CSV, Meta, Webhook, or existing source
4. **Upload/Import** — Upload CSV file or connect to Meta
5. **Field Mapping** — Map CSV columns to lead fields (phone, name, email, custom vars)
6. **Scheduling** — Set start time, end time, timezone, business hours
7. **Call Settings** — Call delay, max attempts, retry delay, max daily calls
8. **Duplicate Policy** — How to handle duplicate phone numbers
9. **Review & Create** — Summary, then create batch

### 4.2 Batch Creation API

**API:** `POST /api/campaigns/:id/batches`

```typescript
// Request body
{
  name: string;
  description?: string;
  leadSource: "csv" | "meta" | "webhook";
  leadSourceId?: number;
  scheduledStartAt?: string; // ISO 8601
  scheduledEndAt?: string;
  timezone?: string;
  businessHoursStart?: number;
  businessHoursEnd?: number;
  maxDailyCalls?: number;
  callDelaySeconds?: number;
  maxAttempts?: number;
  retryDelayMinutes?: number;
  duplicatePolicy?: "ignore" | "skip" | "reject_with_report";
  batchFieldMapping?: Record<string, string>;
}
```

### 4.3 Batch Lifecycle States

| State | Description | Transitions |
|-------|-------------|-------------|
| `draft` | Created, not yet scheduled | → `scheduled` |
| `scheduled` | Scheduled for future start | → `running` (auto at start time) |
| `running` | Currently making calls | → `completed` (all leads called) → `cancelled` (manual) |
| `completed` | All leads processed | — (terminal) |
| `cancelled` | Manually stopped | — (terminal) |

### 4.4 Batch Scheduler

**File:** `artifacts/api-server/src/services/batchScheduler.ts` (implied, not explicitly read)

**Logic:**
- Polls batches with `status: "scheduled"` and `scheduledStartAt <= now()`
- Transitions them to `running`
- Calls `fireStartBatch()` for each

---

## 5. Lead Import Methods

### 5.1 CSV Upload

**Dashboard:** Campaign Detail → "Import Leads" → Upload CSV

**API:** `POST /api/campaigns/:id/import-leads`

**Request body:**
```json
{
  "leads": [
    { "phone": "+1234567890", "name": "John Doe", "email": "john@example.com", "company": "Acme Inc" },
    { "phone": "+0987654321", "name": "Jane Smith", "email": "jane@example.com", "company": "Tech Corp" }
  ]
}
```

**Server-side processing:**
1. Read campaign's `fieldMappings`
2. For each row:
   - Extract `phone` using mapped field (or default "phone")
   - Extract `name` using mapped field (or default "name")
   - Extract `email` using mapped field (or default "email")
   - Store all other fields in `leadData`
   - Normalize phone to E.164 via `normalizePhone()`
   - DNC check via `isOnDnc()`
   - Duplicate check (if batch has `duplicatePolicy`)
   - Insert into `campaign_leads` with `source: "csv"`
3. Update `campaigns.totalLeads` and `campaignBatches.totalLeads`
4. Return import summary: `{ imported, skipped, errors }`

**Batch insert:** 100 leads per INSERT (chunked for performance).

### 5.2 Webhook Ingestion

**Public endpoint:** `POST /api/campaign/webhook/:token` (no auth required)

**How to use:**
1. Create campaign → get `webhookToken`
2. Configure external system to POST to `https://snapserve.ai/api/campaign/webhook/<webhookToken>`
3. Send any JSON or URL-encoded data

**Server-side processing:**
1. Look up campaign by `webhookToken`
2. Check if campaign is `isActive`
3. Flatten nested JSON to dot-notation keys via `flattenObject()`
4. Apply `fieldMappings` to extract phone, name, email
5. Normalize phone
6. DNC check
7. Deduplicate by `externalLeadId` (if provided)
8. Insert lead with `source: "webhook"`
9. If campaign is active, schedule call immediately via `scheduleCampaignCall()`

**Example payload:**
```json
{
  "phone": "+1234567890",
  "name": "John Doe",
  "email": "john@example.com",
  "company": "Acme Inc",
  "source": "website_form"
}
```

### 5.3 Meta (Instagram/Facebook) Lead Ads

**Endpoint:** Same as webhook (`POST /api/campaign/webhook/:token`)

**Meta format:** Meta sends lead data in a specific format. The webhook handler detects this and extracts fields.

**Setup:**
1. Create a lead source with `sourceType: "instagram_ads"` and `metaFormId`
2. Connect Meta Lead Ads to the webhook URL
3. Meta sends real-time lead events

**Meta webhook verification:**
- `GET /api/campaign/webhook/:token` — Returns `hub.challenge` for Meta verification

### 5.4 Lead Source (Reusable)

**API:** `POST /api/lead-sources`

**Purpose:** Create a reusable lead source that can be shared across campaigns.

```json
{
  "sourceType": "csv",
  "sourceName": "Trade Show List",
  "fieldMapping": { "phone": "mobile", "name": "full_name", "email": "email_address" }
}
```

**Usage in Batch Wizard:**
- Select existing lead source instead of uploading new CSV
- The batch inherits the source's `fieldMapping`

---

## 6. Call Execution Engine

### 6.1 How Calls Are Fired

**File:** `artifacts/api-server/src/orchestration/campaignCaller.ts`

**Entry point:** `scheduleCampaignCall(lead, campaign)`

**Flow:**
1. `fireCampaignCall(lead, campaign)` is called
2. Check if campaign has `agentId` — if not, skip lead
3. Normalize phone (if not already done)
4. **DNC check** — if on DNC list, skip and set `callStatus: "skipped"`, `operationalOutcome: "dnc_blocked"`
5. **Concurrency check** — count leads with `callStatus: "calling"`. If >= `concurrentCallLimit`, queue lead
6. Mark lead as `calling` and increment `callAttempts`
7. Load agent from `agents` table
8. Get telephony provider config from `providers` table
9. **Dial the call:**
   - **Twilio:** `dialTwilio()` — creates call via Twilio API, passes `webhookUrl` for status callbacks
   - **Plivo:** `dialPlivo()` — creates call via Plivo API
   - **Vobiz:** `dialVobiz()` — creates call via Vobiz API
10. Create `call_executions` record with `attemptNumber` and `startedAt`
11. Create `lead_timeline` event: `call_started`

### 6.2 Telephony Dialing

**File:** `artifacts/api-server/src/orchestration/telephony/dial.ts`

**Twilio dialing:**
```typescript
dialTwilio({
  accountSid,
  authToken,
  fromNumber,
  toNumber,
  webhookUrl,      // URL for Twilio status callbacks
  amdCallbackUrl,  // URL for AMD (Answering Machine Detection) results
  machineDetectionMode,  // "Enable" or "DetectMessageEnd"
});
```

**Webhook URL:** `https://<domain>/api/webhooks/twilio?agentId=<agentId>&campaignId=<campaignId>&leadId=<leadId>`

**AMD (Answering Machine Detection):**
- `Enable` — basic human vs machine detection
- `DetectMessageEnd` — detects end of voicemail greeting
- AMD callback hits `amdCallbackUrl` with result

### 6.3 Call Pipeline (After Connection)

Once the call is answered, the standard voice pipeline takes over:

1. **Twilio sends media stream** to `/api/webhooks/twilio`
2. **Pipeline** (`pipeline.ts`) processes the call:
   - STT → LLM → TTS
   - Agent uses the campaign's agent configuration
   - Lead data is injected into the prompt via `interpolateTemplate()`
3. **Call ends** — pipeline triggers `endCall()`
4. **Post-call processing:**
   - Update `campaignLeads.callStatus` to `completed` or `failed`
   - Set `operationalOutcome` based on call result
   - Update `campaignLeads.disposition` from LLM evaluation
   - Increment `campaign.calledLeads`
   - Update `callExecutions` with `endedAt` and `outcome`
   - Update `batch_daily_metrics`
   - Create `lead_timeline` event: `call_completed` or `call_failed`

### 6.4 Prompt Variable Substitution

**Function:** `interpolateTemplate(template, data)`

**How it works:**
- The agent's `prompt` is stored in `agents.prompt`
- Before the call starts, the system replaces `{{variable}}` placeholders with lead data
- Example: `prompt: "Hello {{name}}, this is about {{company}}"` becomes `"Hello John, this is about Acme Inc"`
- Unknown placeholders are left as-is (e.g., `{{missing}}` stays as `{{missing}}`)

**Data source:** `campaignLeads.leadData` (all imported fields from CSV/webhook)

### 6.5 Concurrency Control

**Per-campaign limit:** `campaign.concurrentCallLimit` (default 20)

**How it works:**
1. Before firing a call, count leads with `callStatus: "calling"`
2. If count >= limit, skip and set `callStatus: "pending"`, `notes: "Queued — concurrency limit reached"`
3. The lead will be retried when the scheduler runs again

**Per-user limit:** `users.concurrentLimit` (default 2)
- This is enforced at the user level, not campaign level
- Affects all campaigns for the user

---

## 7. Outcomes & Dispositions

### 7.1 Operational Outcome (System-level)

**Definition:** The canonical result of a call, set by the lifecycle engine. Immutable.

**Values:**
| Outcome | Meaning | When Set |
|---------|---------|----------|
| `pending` | Not yet called | Default |
| `booking_created` | Lead booked an appointment | Agent tool executed booking |
| `transfer_completed` | Call transferred to human | Agent tool executed transfer |
| `callback_requested` | Lead asked for callback | Agent detected callback intent |
| `interest_confirmed` | Positive engagement | LLM evaluation |
| `no_contact` | No answer / busy / voicemail | Call failed to connect |
| `dnc_blocked` | Number on DNC list | DNC check at import time |
| `failed` | Technical failure | Error during call |

**Set by:**
- `operational-outcome.ts` — `appendOutcome()` function
- Called by the pipeline when a call ends
- Called by the import process when DNC is detected

### 7.2 Disposition (User-defined)

**Definition:** A user-defined category for the call. Flexible, can be anything.

**Configuration:** Agent config → `dispositionsV2`

```json
{
  "dispositionsV2": [
    {
      "name": "Interested",
      "question": "Was the lead interested?",
      "category": "positive",
      "model": "gpt-4o",
      "systemPrompt": "Evaluate if the lead showed interest. Return YES or NO.",
      "type": "predefined",
      "options": ["YES", "NO", "MAYBE"]
    }
  ]
}
```

**How it's set:**
1. After the call ends, the LLM evaluates the transcript
2. Each disposition question is sent to the LLM
3. The LLM returns an answer (free text or from options)
4. Results are stored in `campaignLeads.disposition` and `calls.dispositionResult`

**Example:**
- `dispositionResult: { "Interested": "YES", "Budget": "High" }`
- `disposition: "Interested: YES, Budget: High"`

### 7.3 Success Evaluation

**Field:** `calls.successEvaluation`

**How it works:**
1. After the call, the LLM evaluates against `agent.config.successCriteria`
2. Example criteria: "The lead agreed to a meeting or showed clear interest"
3. LLM returns: `PASS` or `FAIL` + reason
4. Stored in `calls.successEvaluation`

**Used for:**
- Agent-level success rate analytics
- Campaign performance tracking

---

## 8. Command Center

### 8.1 Purpose

Real-time monitoring dashboard for active campaigns. Shows:
- Currently calling leads
- Completed calls
- Failed calls
- Callbacks
- Bookings
- Transfers

### 8.2 API

**Endpoint:** `GET /api/command-center`

**Response:**
```json
{
  "activeCampaigns": [
    {
      "id": 1,
      "name": "Summer Sale",
      "status": "active",
      "totalLeads": 1000,
      "calledLeads": 350,
      "callingNow": 5,
      "completed": 300,
      "failed": 50
    }
  ],
  "liveCalls": [
    {
      "leadId": 123,
      "phone": "+1234567890",
      "name": "John Doe",
      "campaignId": 1,
      "campaignName": "Summer Sale",
      "status": "calling",
      "startedAt": "2026-06-05T10:30:00Z"
    }
  ],
  "todayStats": {
    "callsMade": 150,
    "connected": 120,
    "bookings": 10,
    "transfers": 5,
    "callbacks": 8
  }
}
```

### 8.3 Batch Health Snapshots

**Endpoint:** `GET /api/campaigns/:id/batches/:batchId/health`

**Purpose:** Current state of a batch at a glance.

**Data source:** `batch_health_snapshots` table

**Fields:**
- `totalLeads` — Total leads in batch
- `validLeads` — Leads not skipped
- `duplicates` — Duplicate leads
- `queued` — Pending leads
- `calling` — Currently calling
- `connected` — Call connected
- `completed` — Call completed
- `callbacks` — Callbacks requested
- `booked` — Bookings created
- `transferred` — Transfers completed
- `failed` — Failed calls
- `noPickup` — No answer
- `interested` — Positive engagement

---

## 9. Campaign Analytics

### 9.1 Batch Analytics

**Endpoint:** `GET /api/campaigns/:id/batches/:batchId/analytics`

**Response:**
```json
{
  "statusBreakdown": {
    "pending": 50,
    "calling": 5,
    "completed": 300,
    "failed": 50,
    "skipped": 100
  },
  "dispositions": [
    { "label": "Interested", "count": 100 },
    { "label": "Not Interested", "count": 80 },
    { "label": "Callback", "count": 50 }
  ],
  "callbackCount": 50,
  "retryCount": 30,
  "outcomeBreakdown": {
    "booking_created": 10,
    "transfer_completed": 5,
    "callback_requested": 50,
    "interest_confirmed": 100,
    "no_contact": 80,
    "failed": 50
  }
}
```

### 9.2 Daily Metrics

**Table:** `batch_daily_metrics`

**Purpose:** Pre-aggregated daily stats for fast analytics.

**Updated by:** Lifecycle engine after each batch day.

**Query:**
```sql
SELECT * FROM batch_daily_metrics
WHERE batch_id = <batchId>
ORDER BY date;
```

### 9.3 Campaign-level Metrics

**Endpoint:** `GET /api/campaigns/:id/analytics`

**Computed from:**
- `campaigns.totalLeads` vs `campaigns.calledLeads`
- `campaignLeads` grouped by `callStatus` and `operationalOutcome`
- `callExecutions` grouped by `outcome`
- `callCallbacks` count
- `callTransfers` count
- `callBookings` count

---

## 10. Callbacks & Retry System

### 10.1 Callback Detection

**How callbacks are detected:**
1. During the call, the agent listens for phrases like "call me back", "call me later", "call tomorrow"
2. The `detectCallbackRequest()` function scans the transcript
3. If detected, the agent responds with "When would you like me to call you back?"
4. The lead provides a time
5. The agent creates a callback record

**Or:** The agent can explicitly set a callback via a tool.

### 10.2 Callback Management

**Table:** `call_callbacks`

**API:**
- `GET /api/campaigns/:id/callbacks` — List callbacks
- `POST /api/campaigns/:id/callbacks/:callbackId/complete` — Mark completed
- `POST /api/campaigns/:id/callbacks/:callbackId/reschedule` — Reschedule

**SLA Tracking:**
- `responseDueBy` — When the callback should be completed
- `slaStatus()` — Computes `overdue`, `due-soon`, or `ok`

### 10.3 Retry Engine

**File:** `artifacts/api-server/src/services/retryEngine.ts`

**How it works:**
1. A cron job or scheduler calls `processRetries()` every 60 seconds
2. Queries `call_retries` for `status: "pending"` and `scheduledAt <= now()`
3. For each due retry:
   - Load the lead and campaign
   - If campaign is not active, cancel the retry
   - If lead is already completed or calling, cancel the retry
   - Mark retry as `fired`
   - Reset lead to `pending`
   - Call `scheduleCampaignCall()`
   - Add `lead_timeline` event: `manual_retry` or `auto_retry`

**When retries are created:**
- Call fails (no answer, busy, error) — auto-retry scheduled
- User manually clicks "Retry" on a lead — manual retry

**Max attempts:** Controlled by `campaign.maxAttempts` (default 1)

### 10.4 Redial All No-Pickup

**API:** `POST /api/campaigns/:id/redial`

**What it does:**
1. Finds all leads with `callStatus` in `["failed", "skipped"]`
2. Resets each to `pending`
3. Calls `scheduleCampaignCall()` for each
4. Returns count of queued leads

**Use case:** User wants to retry all leads that didn't pick up.

---

## 11. Call Transfers

### 11.1 Warm Transfer

**Definition:** Agent stays on the line, introduces the caller to the human, then drops.

**How it works:**
1. During the call, the lead says "I want to talk to a human"
2. Agent detects transfer intent
3. Agent calls `executeNativeTransfer()` tool
4. System dials the transfer target number
5. Both parties are connected
6. Agent drops from the call

**API:**
- `POST /api/campaigns/:id/leads/:leadId/transfers` — Log transfer

### 11.2 Cold Transfer

**Definition:** Agent hangs up and the caller is forwarded to a human.

**How it works:**
1. Agent detects transfer intent
2. Agent calls `executeNativeTransfer()` tool
3. System issues a `<Dial>` instruction to the telephony provider
4. Caller hears ringing while being transferred
5. Agent is no longer on the call

### 11.3 Transfer Tracking

**Table:** `call_transfers` (linked via `call_executions`)

**API:**
- `GET /api/campaigns/:id/transfers/metrics` — Transfer metrics
- `GET /api/campaigns/:id/transfers` — List transfers

**Metrics:**
- `pending` — Initiated or connected
- `completed` — Successfully transferred
- `failed` — Transfer failed
- `today` — Transfers today

**Join path:**
```
call_transfers → call_executions (call_id) → campaigns
```

**Note:** `call_transfers` has no direct `campaign_id` FK. Always join via `call_executions`.

---

## 12. Incoming Calls

### 12.1 Purpose

Track inbound calls that match campaign leads. When a lead calls back, the system:
1. Matches the caller's phone to a campaign lead
2. Creates an `incoming_calls` record
3. Shows it in the "Incoming Calls" tab

### 12.2 Matching Logic

1. When an inbound call comes in, the system checks `campaign_leads.phone` or `campaign_leads.normalizedPhone`
2. If a match is found, the call is linked to the lead
3. `incoming_calls.leadId` and `incoming_calls.campaignId` are set

### 12.3 API

- `GET /api/campaigns/:id/incoming/metrics` — Incoming call metrics
- `GET /api/campaigns/:id/incoming` — List incoming calls
- `PATCH /api/campaigns/:id/incoming/:incomingId/status` — Update status

**Status values:**
- `unreviewed` — New, not yet reviewed
- `reviewed` — Reviewed but no action taken
- `actioned` — Reviewed and action taken

### 12.4 Metrics

- `unreviewed` — Count of unreviewed calls
- `today` — Calls today
- `thisWeek` — Calls this week
- `completed` — Reviewed or actioned
- `total` — Total incoming calls

---

## 13. Campaign Bookings

### 13.1 Purpose

Track appointments created during campaign calls. This is a campaign-scoped view into the scheduling module.

### 13.2 How Bookings Are Created

1. During the call, the lead says "I'd like to book a meeting"
2. Agent calls `executeNativeBooking()` tool
3. The tool creates a `bookings` record (scheduling module)
4. A `call_bookings` record is also created (campaign-scoped)

### 13.3 API

- `GET /api/campaigns/:id/bookings/metrics` — Booking metrics
- `GET /api/campaigns/:id/bookings` — List bookings

**Metrics:**
- `today` — Bookings created today
- `upcoming` — Future bookings not cancelled
- `completed` — Completed meetings
- `cancelled` — Cancelled meetings
- `total` — Total bookings

### 13.4 Unified View

The campaign bookings view joins:
- `call_bookings` — Campaign-scoped data
- `bookings` — Scheduling module data (if linked)
- `event_types` — Meeting type info
- `campaign_leads` — Lead info

**Unified fields:**
- `meetingTime` — `coalesce(bookings.slotStart, call_bookings.meetingTime)`
- `status` — `coalesce(bookings.status, call_bookings.meetingStatus)`
- `meetLink` — `coalesce(bookings.meetLink, call_bookings.meetingLink)`

---

## 14. Lead CRM (Ops)

### 14.1 Lead Sources

**API:**
- `GET /api/lead-sources` — List sources
- `POST /api/lead-sources` — Create source
- `PATCH /api/lead-sources/:sourceId` — Update source
- `DELETE /api/lead-sources/:sourceId` — Delete source

**Purpose:** Reusable lead sources across campaigns.

### 14.2 Lead Transfers (Ownership)

**API:**
- `GET /api/campaigns/:id/leads/:leadId/transfers` — List transfers
- `POST /api/campaigns/:id/leads/:leadId/transfers` — Create transfer
- `PATCH /api/campaigns/:id/leads/:leadId/transfers/:transferId` — Update

**Fields:**
- `transferredTo` — New owner
- `outcome` — Transfer result
- `durationSeconds` — How long the human talk lasted

### 14.3 Lead Notes

**API:**
- `GET /api/campaigns/:id/leads/:leadId/notes` — List notes
- `POST /api/campaigns/:id/leads/:leadId/notes` — Add note

### 14.4 Lead Tasks

**API:**
- `GET /api/campaigns/:id/leads/:leadId/tasks` — List tasks
- `POST /api/campaigns/:id/leads/:leadId/tasks` — Create task
- `PATCH /api/campaigns/:id/leads/:leadId/tasks/:taskId` — Update task

### 14.5 Lead Tags

**API:**
- `GET /api/campaigns/:id/leads/:leadId/tags` — List tags
- `POST /api/campaigns/:id/leads/:leadId/tags` — Add tag

### 14.6 Lead Timeline

**API:** `GET /api/campaigns/:id/leads/:leadId/timeline`

**Returns:** All events for the lead in chronological order.

**Event types:**
- `call_started` — Call initiated
- `call_completed` — Call ended successfully
- `call_failed` — Call failed
- `dnc_blocked` — Blocked by DNC
- `callback_requested` — Lead requested callback
- `transfer_triggered` — Transfer initiated
- `manual_retry` — User manually retried
- `booking_created` — Booking created
- `outcome_set` — Outcome recorded
- `disposition_set` — Disposition recorded

---

## 15. Frontend Pages

### 15.1 Campaign List

**Page:** `/app/campaigns`

**Components:**
- Campaign cards with status, progress bar, total/called leads
- "Create Campaign" button
- Filter by status

### 15.2 Campaign Detail

**Page:** `/app/campaigns/:id`

**Tabs:**
- **Overview** — Campaign stats, settings, launch/pause button
- **Batches** — List of batches with status, progress
- **Leads** — Lead table with search, filter, pagination
- **Callbacks** — Callback list with SLA status
- **Transfers** — Transfer history
- **Bookings** — Booking list
- **Incoming** — Incoming call list
- **Analytics** — Charts and graphs

### 15.3 Batch Detail

**Page:** `/app/campaigns/:id/batches/:batchId`

**Shows:**
- Batch info (name, status, schedule)
- Lead import summary
- Progress bar
- Health snapshot
- Action buttons: Start, Pause, Cancel

### 15.4 Lead Profile

**Page:** `/app/campaigns/:id/leads/:leadId`

**Shows:**
- Lead info (name, phone, email, leadData)
- Call history (executions with call details)
- Callbacks
- Pending retries
- Timeline
- Notes, tasks, tags

### 15.5 Batch Wizard

**Page:** `/app/campaigns/batch-wizard`

**Steps:**
1. Select campaign
2. Name & description
3. Lead source (CSV upload, Meta, Webhook, existing source)
4. Field mapping
5. Scheduling
6. Call settings
7. Duplicate policy
8. Review & create

### 15.6 Command Center

**Page:** `/app/command-center`

**Real-time display:**
- Active campaigns with live stats
- Currently calling leads (with phone, name, duration)
- Today's summary (calls, connected, bookings, transfers, callbacks)

### 15.7 Live Queue

**Page:** `/app/command-center` (Live Queue tab)

**Shows:**
- Queue of pending leads
- Currently calling leads
- Recently completed calls

### 15.8 Meta Leads

**Page:** `/app/meta-leads`

**Shows:**
- Leads from Meta/Instagram across all campaigns
- Filter by status (no_pickup, all, callbacks)
- Campaign and batch info

---

## 16. API Routes Reference

### 16.1 Campaign Routes

| Method | Path | Description | File |
|--------|------|-------------|------|
| GET | `/api/campaigns` | List user's campaigns | `routes/campaigns.ts` |
| POST | `/api/campaigns` | Create campaign | `routes/campaigns.ts` |
| GET | `/api/campaigns/:id` | Get campaign | `routes/campaigns.ts` |
| PATCH | `/api/campaigns/:id` | Update campaign | `routes/campaigns.ts` |
| DELETE | `/api/campaigns/:id` | Delete campaign | `routes/campaigns.ts` |
| GET | `/api/campaigns/:id/leads` | List leads | `routes/campaigns.ts` |
| POST | `/api/campaigns/:id/import-leads` | Import CSV leads | `routes/campaigns.ts` |
| GET | `/api/campaigns/meta-leads` | List Meta leads | `routes/campaigns.ts` |
| POST | `/api/campaigns/:id/redial` | Redial all no-pickup | `routes/campaigns.ts` |
| POST | `/api/campaigns/:id/leads/:leadId/retry` | Retry single lead | `routes/campaigns.ts` |

### 16.2 Batch Routes

| Method | Path | Description | File |
|--------|------|-------------|------|
| GET | `/api/campaigns/:id/batches` | List batches | `routes/campaign-batches.ts` |
| POST | `/api/campaigns/:id/batches` | Create batch | `routes/campaign-batches.ts` |
| GET | `/api/campaigns/:id/batches/:batchId` | Get batch | `routes/campaign-batches.ts` |
| PATCH | `/api/campaigns/:id/batches/:batchId` | Update batch | `routes/campaign-batches.ts` |
| DELETE | `/api/campaigns/:id/batches/:batchId` | Delete batch | `routes/campaign-batches.ts` |
| POST | `/api/campaigns/:id/batches/:batchId/start` | Start batch | `routes/campaign-batches.ts` |
| POST | `/api/campaigns/:id/batches/:batchId/pause` | Pause batch | `routes/campaign-batches.ts` |
| POST | `/api/campaigns/:id/batches/:batchId/cancel` | Cancel batch | `routes/campaign-batches.ts` |
| POST | `/api/campaigns/:id/batches/:batchId/import` | Import leads to batch | `routes/campaign-batches.ts` |

### 16.3 Lead Routes

| Method | Path | Description | File |
|--------|------|-------------|------|
| GET | `/api/campaigns/:id/leads/:leadId` | Get lead profile | `routes/campaign-leads.ts` |
| GET | `/api/campaigns/:id/leads/:leadId/timeline` | Lead timeline | `routes/campaign-leads.ts` |
| PATCH | `/api/campaigns/:id/leads/:leadId/callbacks/:callbackId` | Update callback | `routes/campaign-leads.ts` |
| POST | `/api/campaigns/:id/leads/:leadId/retry` | Manual retry | `routes/campaign-leads.ts` |

### 16.4 Callback Routes

| Method | Path | Description | File |
|--------|------|-------------|------|
| GET | `/api/campaigns/:id/callbacks/metrics` | Callback metrics | `routes/campaign-callbacks.ts` |
| GET | `/api/campaigns/:id/callbacks` | List callbacks | `routes/campaign-callbacks.ts` |
| POST | `/api/campaigns/:id/callbacks/:callbackId/complete` | Complete callback | `routes/campaign-callbacks.ts` |
| POST | `/api/campaigns/:id/callbacks/:callbackId/reschedule` | Reschedule callback | `routes/campaign-callbacks.ts` |

### 16.5 Transfer Routes

| Method | Path | Description | File |
|--------|------|-------------|------|
| GET | `/api/campaigns/:id/transfers/metrics` | Transfer metrics | `routes/campaign-transfers.ts` |
| GET | `/api/campaigns/:id/transfers` | List transfers | `routes/campaign-transfers.ts` |

### 16.6 Booking Routes

| Method | Path | Description | File |
|--------|------|-------------|------|
| GET | `/api/campaigns/:id/bookings/metrics` | Booking metrics | `routes/campaign-bookings.ts` |
| GET | `/api/campaigns/:id/bookings` | List bookings | `routes/campaign-bookings.ts` |

### 16.7 Incoming Routes

| Method | Path | Description | File |
|--------|------|-------------|------|
| GET | `/api/campaigns/:id/incoming/metrics` | Incoming metrics | `routes/campaign-incoming.ts` |
| GET | `/api/campaigns/:id/incoming` | List incoming calls | `routes/campaign-incoming.ts` |
| PATCH | `/api/campaigns/:id/incoming/:incomingId/status` | Update status | `routes/campaign-incoming.ts` |

### 16.8 Analytics Routes

| Method | Path | Description | File |
|--------|------|-------------|------|
| GET | `/api/campaigns/:id/batches/:batchId/analytics` | Batch analytics | `routes/campaign-analytics.ts` |

### 16.9 Ops Routes (Lead CRM)

| Method | Path | Description | File |
|--------|------|-------------|------|
| GET | `/api/lead-sources` | List sources | `routes/campaign-ops.ts` |
| POST | `/api/lead-sources` | Create source | `routes/campaign-ops.ts` |
| PATCH | `/api/lead-sources/:sourceId` | Update source | `routes/campaign-ops.ts` |
| DELETE | `/api/lead-sources/:sourceId` | Delete source | `routes/campaign-ops.ts` |
| GET | `/api/campaigns/:id/leads/:leadId/transfers` | List transfers | `routes/campaign-ops.ts` |
| POST | `/api/campaigns/:id/leads/:leadId/transfers` | Create transfer | `routes/campaign-ops.ts` |
| GET | `/api/campaigns/:id/leads/:leadId/notes` | List notes | `routes/campaign-ops.ts` |
| POST | `/api/campaigns/:id/leads/:leadId/notes` | Create note | `routes/campaign-ops.ts` |
| GET | `/api/campaigns/:id/leads/:leadId/tasks` | List tasks | `routes/campaign-ops.ts` |
| POST | `/api/campaigns/:id/leads/:leadId/tasks` | Create task | `routes/campaign-ops.ts` |
| GET | `/api/campaigns/:id/leads/:leadId/tags` | List tags | `routes/campaign-ops.ts` |
| POST | `/api/campaigns/:id/leads/:leadId/tags` | Create tag | `routes/campaign-ops.ts` |

### 16.10 Webhook Routes

| Method | Path | Description | File |
|--------|------|-------------|------|
| GET | `/api/campaign/webhook/:token` | Meta verification | `routes/campaign-webhook.ts` |
| POST | `/api/campaign/webhook/:token` | Lead ingestion | `routes/campaign-webhook.ts` |

### 16.11 Other Routes

| Method | Path | Description | File |
|--------|------|-------------|------|
| GET | `/api/command-center` | Real-time monitoring | `routes/command-center.ts` |
| GET | `/api/live-queue` | Live call queue | `routes/live-queue.ts` |
| GET | `/api/batch-workspace` | Batch workspace | `routes/batch-workspace.ts` |
| GET | `/api/lead-workspace` | Lead workspace | `routes/lead-workspace.ts` |
| GET | `/api/wizard/voices` | Voice catalog | `routes/wizard.ts` |
| GET | `/api/wizard/templates` | Prompt templates | `routes/wizard.ts` |
| POST | `/api/wizard/generate` | Generate agent prompt | `routes/wizard.ts` |
| POST | `/api/wizard/batch` | Create batch via wizard | `routes/wizard.ts` |

---

## 17. Debugging Guide

### 17.1 Campaign Not Making Calls

**Checklist:**
1. Is campaign `isActive: true`?
2. Is campaign `status: "active"`?
3. Does campaign have `agentId` set?
4. Is the agent `status: "active"`?
5. Does the agent have a telephony provider configured?
6. Is the telephony provider key valid in `providers` table?
7. Does the campaign have leads? (`campaigns.totalLeads > 0`)
8. Are leads in `pending` status? (`campaignLeads.callStatus: "pending"`)
9. Is batch `status: "running"`?
10. Is current time within `businessHoursStart` and `businessHoursEnd`?
11. Is `maxDailyCalls` not exceeded?
12. Check `concurrentCallLimit` — are too many calls already active?
13. Check production logs for `ERROR` or `FATAL` related to campaigns

### 17.2 Leads Not Importing

**Checklist:**
1. Is `fieldMappings` correct? Does it map the right CSV columns?
2. Are phone numbers valid? (check `normalizePhone()` output)
3. Are leads on the DNC list? (`workspace_dnc` table)
4. Is `duplicatePolicy` set to `skip` and duplicates exist?
5. Check import summary: `totalRows`, `leadsCreated`, `duplicatesFound`, `invalidPhones`, `dncBlocked`
6. Check `batch_import_runs` table for import errors

### 17.3 Calls Failing

**Checklist:**
1. Check `calls.error_message` for the specific error
2. Check `campaignLeads.callStatus` — is it `failed`?
3. Check `callExecutions.outcome` for the execution result
4. Check telephony provider key (Twilio/Plivo/Vobiz)
5. Check `providers.extraConfig` for correct account SID, auth token, from number
6. Is `fromNumber` valid and verified?
7. Check production logs for dialing errors

### 17.4 Callbacks Not Working

**Checklist:**
1. Is `callCallbacks.status: "pending"`?
2. Is `callCallbacks.callbackAt` in the future?
3. Is `callCallbacks.responseDueBy` set?
4. Check SLA status: `overdue`, `due-soon`, or `ok`
5. Is retry engine running? (check `processRetries()` logs)
6. Check `callRetries` table for pending retries

### 17.5 Analytics Not Showing

**Checklist:**
1. Are `batch_daily_metrics` rows populated?
2. Is `batch_health_snapshots` updated?
3. Check if `operationalOutcome` is set on leads
4. Check if `disposition` is set on leads
5. Are `callExecutions` records created?

### 17.6 Transfer Not Working

**Checklist:**
1. Does agent config have transfer tool enabled?
2. Is `callTransfers` table populated?
3. Check `callTransfers.status` — is it `failed`?
4. Check telephony provider support for transfers
5. Is transfer target number valid?

### 17.7 Incoming Calls Not Tracking

**Checklist:**
1. Is `incomingCalls` table populated?
2. Is phone matching working? (check `normalizedPhone`)
3. Is `incomingCallStatus` set correctly?
4. Check `incoming_calls.matchedAt` for match timestamp

### 17.8 Batch Not Starting

**Checklist:**
1. Is `scheduledStartAt` in the past?
2. Is `status: "scheduled"`?
3. Is batch scheduler running? (check cron/logs)
4. Is `fireStartBatch()` being called?
5. Are there pending leads in the batch?

### 17.9 DNC Blocking Legitimate Leads

**Checklist:**
1. Check `workspace_dnc` table for the phone number
2. Is `isOnDnc()` returning true incorrectly?
3. Check phone normalization — is the format consistent?
4. Was the number added to DNC by mistake?

---

## 18. Common Issues & Quick Fixes

### 18.1 "No agent assigned to campaign"

**Cause:** `campaign.agentId` is null.

**Fix:**
1. Go to Campaign Detail → Settings
2. Select an agent from the dropdown
3. Save

### 18.2 "Campaign concurrency limit reached"

**Cause:** Too many calls in progress.

**Fix:**
1. Increase `concurrentCallLimit` in campaign settings
2. Or wait for current calls to complete
3. Check `campaignLeads` where `callStatus: "calling"`

### 18.3 "Lead is on DNC"

**Cause:** Phone number in `workspace_dnc`.

**Fix:**
1. Remove from DNC list if it was added by mistake
2. Or check if the lead opted out legitimately

### 18.4 "Duplicate lead — skipping"

**Cause:** Same phone number already exists in campaign.

**Fix:**
1. Change `duplicatePolicy` to `ignore` (creates anyway)
2. Or review existing leads and remove duplicates

### 18.5 "No active provider configured"

**Cause:** Missing or inactive telephony provider key.

**Fix:**
1. Go to Dashboard → Providers
2. Add/verify telephony provider key
3. Ensure `isActive: true` in `providers` table

### 18.6 "Batch not starting at scheduled time"

**Cause:** Batch scheduler not running or wrong timezone.

**Fix:**
1. Check if `scheduledStartAt` is in UTC
2. Check batch scheduler logs
3. Manually start the batch: `PATCH /api/campaigns/:id/batches/:batchId` (set `status: "running"`)

### 18.7 "Callbacks not being processed"

**Cause:** Retry engine not running.

**Fix:**
1. Check if `processRetries()` is being called
2. Check `callRetries` table for `status: "pending"`
3. Ensure cron job is running

### 18.8 "Analytics showing zero outcomes"

**Cause:** Operational outcomes not being set.

**Fix:**
1. Check if `operational-outcome.ts` is being called
2. Check if pipeline is properly ending calls
3. Check `callExecutions` records exist

### 18.9 "Transfers not showing in campaign"

**Cause:** `call_transfers` has no direct campaign FK.

**Fix:**
1. Check `callExecutions` records exist for the campaign
2. Ensure `callExecutions.callId` is set
3. Check join path: `call_transfers` → `callExecutions` → `campaigns`

### 18.10 "Field mapping not working for import"

**Cause:** Wrong field names in mapping.

**Fix:**
1. Check campaign `fieldMappings` — do they match CSV column names?
2. Check case sensitivity
3. Try using the exact column names from the CSV

---

## Appendix A: File Reference

### Critical Files
| File | Purpose |
|------|---------|
| `artifacts/api-server/src/routes/campaigns.ts` | Campaign CRUD, lead import, redial |
| `artifacts/api-server/src/routes/campaign-batches.ts` | Batch CRUD, start/pause/cancel |
| `artifacts/api-server/src/routes/campaign-leads.ts` | Lead profile, timeline, retry |
| `artifacts/api-server/src/routes/campaign-callbacks.ts` | Callback management, SLA |
| `artifacts/api-server/src/routes/campaign-transfers.ts` | Transfer tracking |
| `artifacts/api-server/src/routes/campaign-bookings.ts` | Booking tracking |
| `artifacts/api-server/src/routes/campaign-incoming.ts` | Incoming call tracking |
| `artifacts/api-server/src/routes/campaign-analytics.ts` | Batch analytics |
| `artifacts/api-server/src/routes/campaign-ops.ts` | Lead CRM (sources, notes, tasks, tags) |
| `artifacts/api-server/src/routes/campaign-webhook.ts` | Public lead ingestion |
| `artifacts/api-server/src/routes/command-center.ts` | Real-time monitoring |
| `artifacts/api-server/src/routes/live-queue.ts` | Live call queue |
| `artifacts/api-server/src/routes/wizard.ts` | Batch/agent wizard |
| `artifacts/api-server/src/orchestration/campaignCaller.ts` | Outbound call trigger |
| `artifacts/api-server/src/orchestration/telephony/dial.ts` | Twilio/Plivo/Vobiz dialing |
| `artifacts/api-server/src/services/duplicate-detection.ts` | Duplicate lead detection |
| `artifacts/api-server/src/services/retryEngine.ts` | Auto-retry failed calls |
| `artifacts/api-server/src/services/operational-outcome.ts` | Outcome tracking |
| `artifacts/api-server/src/lib/phone-normalize.ts` | Phone normalization |
| `artifacts/api-server/src/lib/dnc-check.ts` | DNC list checking |
| `lib/db/src/schema/campaigns.ts` | Campaign tables schema |
| `artifacts/dashboard/src/pages/campaigns/index.tsx` | Campaign list page |
| `artifacts/dashboard/src/pages/campaigns/[id].tsx` | Campaign detail page |
| `artifacts/dashboard/src/pages/campaigns/[id]/batches/[batchId].tsx` | Batch detail |
| `artifacts/dashboard/src/pages/campaigns/[id]/leads/[leadId].tsx` | Lead profile |
| `artifacts/dashboard/src/pages/campaigns/batch-wizard.tsx` | Batch wizard |
| `artifacts/dashboard/src/pages/campaigns/callbacks.tsx` | Callbacks page |
| `artifacts/dashboard/src/pages/campaigns/transfers.tsx` | Transfers page |
| `artifacts/dashboard/src/pages/campaigns/bookings.tsx` | Bookings page |
| `artifacts/dashboard/src/pages/campaigns/incoming.tsx` | Incoming calls page |
| `artifacts/dashboard/src/pages/campaigns/live-queue.tsx` | Live queue page |
| `artifacts/dashboard/src/pages/command-center/index.tsx` | Command center |
| `artifacts/dashboard/src/pages/meta-leads.tsx` | Meta leads page |

---

## Appendix B: Key Functions

| Function | File | Purpose |
|----------|------|---------|
| `scheduleCampaignCall()` | `campaignCaller.ts` | Queue a call for a lead |
| `fireCampaignCall()` | `campaignCaller.ts` | Actually dial the call |
| `interpolateTemplate()` | `campaignCaller.ts` | Replace `{{var}}` in prompts |
| `processRetries()` | `retryEngine.ts` | Poll and fire retries |
| `checkDuplicate()` | `duplicate-detection.ts` | Check for duplicate leads |
| `isOnDnc()` | `dnc-check.ts` | Check DNC list |
| `normalizePhone()` | `phone-normalize.ts` | Normalize to E.164 |
| `appendOutcome()` | `operational-outcome.ts` | Set operational outcome |
| `appendTimeline()` | `operational-outcome.ts` | Add timeline event |
| `flattenObject()` | `campaign-webhook.ts` | Flatten nested JSON |
| `extractLeadFields()` | `campaign-webhook.ts` | Apply field mappings |
| `dialTwilio()` | `telephony/dial.ts` | Dial via Twilio |
| `dialPlivo()` | `telephony/dial.ts` | Dial via Plivo |
| `dialVobiz()` | `telephony/dial.ts` | Dial via Vobiz |
| `takeSnapshot()` | `command-center.ts` | Batch health snapshot |
| `slaStatus()` | `campaign-callbacks.ts` | Compute SLA status |

---

*End of SnapServe Campaign Book v1.0*

**Questions?** Search this doc by section, or check the production logs with `fetchDeploymentLogs()`.