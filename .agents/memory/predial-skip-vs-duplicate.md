---
name: Pre-dial skip vs duplicate detection
description: Why duplicate-detection must exclude never-dialed pre-dial skips, or a transient block becomes permanent
---

Campaign duplicate-detection scopes must distinguish "already an active/contacted lead" from "previously skipped for a transient, pre-dial reason and never actually dialed" (no agent assigned, DNC, TRAI). Pre-dial skips are recorded with call_status='skipped' and call_attempts staying at 0 (the attempt counter only increments once a real dial happens).

**Why:** If a phone number's only campaign_leads row is a pre-dial skip, and "Skip duplicates" import policy matches on ANY existing row with that phone regardless of status, the number is silently discarded on every future re-import forever — even after the underlying condition (agent assigned, DNC/TRAI cleared) is resolved. This is a permanent trap disguised as a duplicate.

**How to apply:** When building or auditing duplicate-detection logic for any campaign/import system, exclude rows where the skip happened before a real dial attempt (status=skipped AND attempts=0) from the duplicate-match query. Rows that are pending, actively calling, or have a genuine call outcome (connected/completed/failed/skipped-with-attempts) should still count as duplicates. Independent gates (DNC/TRAI) should still be re-checked at import/dial time regardless, so relaxing duplicate-detection here doesn't bypass them.
