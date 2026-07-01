---
name: VoBiz inbound "Error Reaching Answer URL"
description: Why inbound VoBiz calls hang up with HangupCauseName "Error Reaching Answer URL" while outbound works
---

# VoBiz inbound "Error Reaching Answer URL"

**Symptom:** Inbound VoBiz call reaches our webhook (log shows "VoBiz voice webhook received")
but the caller is dropped before any media stream. Status callback body shows
`HangupCauseName: Error Reaching Answer URL`, and the status handler logs
"no matching call in DB — ignoring".

**Root cause is almost always a missing DATA mapping, not code or XML:**
- The VoBiz inbound answer URL (`/api/webhooks/vobiz/voice`) is set as the account's
  `default_app` and carries **no `?agentId=`**. It resolves the agent **purely** by
  looking up the dialed **To** number in the `phone_numbers` table.
- If the dialed number has no `phone_numbers` row (or the row's `agent_id` is NULL),
  `agentId` stays 0 and the webhook returns **HTTP 400 "Agent not configured for this number"**.
- VoBiz/Plivo treat any non-200 answer-URL response as **"Error Reaching Answer URL"**
  (this is DISTINCT from "Invalid Answer XML" / HangupCauseCode 8011, which is a 200
  with unparseable XML — so this cause rules OUT an XML-format problem).
- No AI session ever starts, so no call record is created → the terminal status
  callback finds nothing to match.

**Why outbound works but inbound doesn't:** outbound dial sites append `?agentId=` (and
`dir=out`) to the answer URL, so agent resolution never touches `phone_numbers`. Inbound
has only the To-number lookup.

**Fix (user/config action, not a code change):** the dialed number must exist in
`phone_numbers` AND be assigned to an agent (`agent_id` NOT NULL). Flow: purchase/register
the number (POST `/phone-numbers`, inserts the row) → PATCH `/phone-numbers/:id/assign`
with an agentId. A number owned directly on VoBiz but never provisioned through our
dashboard will NOT be in `phone_numbers`, so inbound to it always 400s.

**How to confirm fast:** `SELECT count(*), ... FROM phone_numbers` against prod (read
replica). Empty table or `agent_id IS NULL` for the dialed number = confirmed. There is
currently no "import an externally-owned VoBiz number" path — only the purchase flow
inserts rows.
