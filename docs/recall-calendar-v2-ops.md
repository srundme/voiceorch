# Recall Calendar V2 — ops checklist

Self-serve Google calendar connect for AI meeting bots. Code lives under `/api/meet-calendar/*`.

## Google Cloud (required before production)

1. Enable **Google Calendar API** on the GCP project that owns `GOOGLE_CLIENT_ID`.
2. OAuth consent screen → **Publish to Production** (testing mode expires refresh tokens in 7 days).
3. OAuth client → Authorized redirect URIs → add exactly:
   - `https://<api-host>/api/meet-calendar/google/callback`
4. Set env:
   - `GOOGLE_MEET_CALENDAR_REDIRECT_URI` = that same URI
   - Existing `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are reused
5. Scopes used by this flow (readonly): `calendar.events.readonly`, `userinfo.email`  
   Scheduling booking flow keeps full `calendar` scope separately.

## Recall dashboard

1. API key in `RECALL_API_KEY` (same as meet bots); region in `RECALL_REGION`.
2. Create a **Calendar V2** Svix webhook endpoint pointing to:
   - `https://<api-host>/api/meet-calendar/recall-webhooks`
3. Subscribe to `calendar.update` and `calendar.sync_events`.
4. Put the Svix signing secret in `RECALL_CALENDAR_WEBHOOK_SECRET`.

## Smoke test

1. Meetings → Connect Google Calendar for AI meetings → complete OAuth.
2. List upcoming events; toggle Join on an event with a Meet/Zoom/Teams link.
3. Confirm bot appears in Recall / joins at event start.
4. Reschedule the Google event → webhook should refresh scheduled bot.
5. Disconnect → Recall calendar deleted; toggles cleared.
