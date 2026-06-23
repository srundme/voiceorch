-- Make bookings.event_type_id and bookings.calendar_id nullable and change
-- their FK actions from RESTRICT to SET NULL so that deleting an event type
-- or calendar preserves historical booking records (FK columns become NULL).

-- event_type_id
ALTER TABLE "bookings" ALTER COLUMN "event_type_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_event_type_id_event_types_id_fk";--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_event_type_id_event_types_id_fk"
  FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;--> statement-breakpoint

-- calendar_id
ALTER TABLE "bookings" ALTER COLUMN "calendar_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_calendar_id_scheduling_calendars_id_fk";--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_calendar_id_scheduling_calendars_id_fk"
  FOREIGN KEY ("calendar_id") REFERENCES "public"."scheduling_calendars"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
