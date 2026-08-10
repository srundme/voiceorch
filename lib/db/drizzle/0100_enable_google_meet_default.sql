-- Bookings should include a Google Meet link by default (Connections wizard promises this).
ALTER TABLE "event_types" ALTER COLUMN "enable_google_meet" SET DEFAULT true;
