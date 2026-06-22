ALTER TABLE google_calendar_connections ADD COLUMN IF NOT EXISTS granted_scopes text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS calendar_sync_status text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS calendar_sync_error text;
