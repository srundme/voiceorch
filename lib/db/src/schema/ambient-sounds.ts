import { pgTable, uuid, text, integer, real, timestamp } from "drizzle-orm/pg-core";

export const ambientSoundsTable = pgTable("ambient_sounds", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  storageKey: text("storage_key").notNull(),
  pcmStorageKey: text("pcm_storage_key").notNull(),
  mimeType: text("mime_type").notNull(),
  fileSize: integer("file_size").notNull(),
  durationSeconds: real("duration_seconds"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AmbientSound = typeof ambientSoundsTable.$inferSelect;
export type InsertAmbientSound = typeof ambientSoundsTable.$inferInsert;
