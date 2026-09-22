# Campaign lead-state V2 — Railway promote (canary → on)

**Goal:** Writers park answered hangups as `pending`/`completed` (never `failed` when `answered_ever`). Dashboard Failed chip = `technical_failed` (never-answered only).

## 0. Preconditions

- Deploy includes `campaign-lead-state-v2` writers + lead-reporting KPIs.
- Migration `0125_campaign_lead_state_v2` applied (`answered_ever` backfilled where `call_id` exists).
- Dashboard overview/batch use `/lead-reporting` (not raw `call_status=failed` for Failed).

## 1. Canary (first deploy)

Railway **api-server** (or orchestration worker that runs hangups / webhooks / scheduler):

| Variable | Value |
|---|---|
| `CAMPAIGN_LEAD_STATE_V2` | `canary` |
| `CAMPAIGN_LEAD_STATE_V2_CANARY_CAMPAIGN_IDS` | `449` (comma-separated if more) |

Redeploy. Confirm env on the process that handles:

- `endSession` hangup park
- carrier webhooks (`handleCampaignLeadTerminalStatus`)
- `campaignCaller` dial errors / max attempts
- `batchScheduler` stuck sweep

## 2. 24h canary proof

On campaign **449** (and controls not in canary):

1. **Failed chip ∩ answered-ever = 0** for newly written leads (`GET …/lead-reporting` → `workTechnical.technicalFailed` vs `funnel.answered`; check `compare.historicalAnsweredFailed` if present — should not grow for new rows).
2. Mid-call hangups reappear in **Retry** (`workTechnical.retryPending`) and get redialled.
3. Concurrency / talking slots stay stable (no stuck `calling`/`connected` pile-up).
4. Batch row with duration + Interested does **not** show Failed as the primary story (Disposition first).

Optional SQL:

```sql
-- New answered+failed should be ~0 after canary start
SELECT count(*) FROM campaign_leads
WHERE campaign_id = 449 AND answered_ever AND call_status = 'failed'
  AND updated_at > now() - interval '24 hours';
```

## 3. Global on

| Variable | Value |
|---|---|
| `CAMPAIGN_LEAD_STATE_V2` | `on` |

Can leave `CAMPAIGN_LEAD_STATE_V2_CANARY_CAMPAIGN_IDS` set; it is ignored when mode is `on`.

Redeploy. Spot-check a non-canary campaign the same way.

## 4. Optional legacy remap

Historical rows may still be `answered_ever=true` AND `call_status=failed`. Reporting already excludes them from `technical_failed`, but lifecycle badges look wrong until remapped.

Dry-run:

```bash
pnpm --filter @workspace/api-server exec tsx src/scripts/remap-answered-failed-leads.ts
pnpm --filter @workspace/api-server exec tsx src/scripts/remap-answered-failed-leads.ts --campaign=449
```

Apply (batched 5k; re-run until dry-run is 0):

```bash
pnpm --filter @workspace/api-server exec tsx src/scripts/remap-answered-failed-leads.ts --apply
```

Do **not** remap in the same deploy as first enabling writers if you need a clean before/after KPI compare.

## 5. Rollback

Set `CAMPAIGN_LEAD_STATE_V2=off` (or `shadow` for logs only). Hangup park classifier remains; webhook defer for answered+connected stays on regardless of flag. Failed KPI continues to use reporting `technical_failed`.

## Glossary (UI)

| Label | Means |
|---|---|
| Answered | Sticky `answered_ever` (ever connected a session) |
| Talking / Ringing | Live floor (`connected` / `calling`) |
| Retry | Pending `call_retries` |
| Failed | Never-answered technical fail (`technical_failed`) |
| Interested / Booked | Business disposition / operational outcome |

Connected ≠ Talking. Failed ≠ Exhausted. Interested ≠ Booked.

## 6. If you cannot handle more concurrent calls

Audio (AEC / Quail / VAD) runs on an in-process **worker thread pool**. Campaign dials are limited by that pool plus campaign `concurrentCallLimit`.

| Symptom | Action |
|---|---|
| Logs: `Audio worker pool skew` / `Audio worker unavailable or overloaded` | Raise **`AUDIO_POOL_SIZE`** on `snapserve-api` (e.g. `12`–`24`). Default auto-cap is **16**. Soft max override **64**. Restart after change. |
| Pool raised but CPU/RAM pegged | Scale **Railway replicas** for `snapserve-api` (horizontal). Sticky media stays per instance; more replicas = more concurrent sessions. |
| Dial queue backs up but audio is fine | Raise campaign **`concurrentCallLimit`** (UI / PATCH) up to platform ceiling `CAMPAIGN_MAX_CONCURRENT_CALLS` (default 10). |

Do not jump `AUDIO_POOL_SIZE` on a tiny Railway container — OOM at boot will take `/api/healthz` down. Prefer a larger instance, then raise the pool.
