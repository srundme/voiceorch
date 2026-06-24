import { pgTable, uuid, text, integer, real, timestamp, customType } from "drizzle-orm/pg-core";

/** Raw binary column (PostgreSQL `bytea`) stored/returned as a Node Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const ambientSoundsTable = pgTable("ambient_sounds", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  // Original audio bytes + pre-transcoded 8 kHz PCM loop, stored directly in
  // Postgres (works in dev and on Railway, unlike Replit Object Storage).
  audioData: bytea("audio_data"),        // null only for legacy GCS-backed rows
  pcmData: bytea("pcm_data"),            // null while background transcoding is pending
  // Legacy GCS keys — kept nullable for backward compatibility with rows created
  // before the Postgres migration. New rows never set these.
  storageKey: text("storage_key"),
  pcmStorageKey: text("pcm_storage_key"),
  mimeType: text("mime_type").notNull(),
  fileSize: integer("file_size").notNull(),
  durationSeconds: real("duration_seconds"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AmbientSound = typeof ambientSoundsTable.$inferSelect;
export type InsertAmbientSound = typeof ambientSoundsTable.$inferInsert;
