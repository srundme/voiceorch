-- Existing bookable meetings created via Connections wizard often had Meet off
-- while UI promised a Meet link on invites. Turn Meet on for active event types.
UPDATE "event_types" SET "enable_google_meet" = true WHERE "is_active" = true AND "enable_google_meet" = false;
