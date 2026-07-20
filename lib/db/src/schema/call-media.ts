import { pgTable, serial, integer, text, timestamp, customType, index } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";

/** Raw binary column (PostgreSQL `bytea`) stored/returned as a Node Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/**
 * Still images (and image documents) attached to a call or staged for the next dial.
 * Used by the analyze_image tool and WhatsApp / webcall vision intake.
 * call_id FK is enforced in SQL migration; kept as plain integer here to avoid
 * circular schema imports with calls.ts.
 */
export const callMediaTable = pgTable("call_media", {
  id: serial("id").primaryKey(),
  callId: integer("call_id"),
  agentId: integer("agent_id").references(() => agentsTable.id, { onDelete: "cascade" }),
  userId: text("user_id"),
  /** Caller phone (E.164 or digits) — used to attach WA images to active / next call. */
  phone: text("phone"),
  source: text("source").notNull(), // whatsapp | upload | webcall | url
  mimeType: text("mime_type").notNull(),
  fileName: text("file_name"),
  byteSize: integer("byte_size").notNull(),
  imageData: bytea("image_data").notNull(),
  /** Optional analysis cache from last analyze_image run. */
  analysisText: text("analysis_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("call_media_call_id_idx").on(t.callId),
  index("call_media_agent_phone_idx").on(t.agentId, t.phone),
]);

export type CallMedia = typeof callMediaTable.$inferSelect;
export type InsertCallMedia = typeof callMediaTable.$inferInsert;
