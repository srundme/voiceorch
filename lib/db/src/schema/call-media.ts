import { pgTable, serial, text, integer, customType, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";
import { callsTable } from "./calls";

// drizzle-orm's pg-core doesn't export `bytea` directly — use customType instead
const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() { return "bytea"; },
});

/**
 * Stores images captured during calls — webcall uploads, WhatsApp inbound images,
 * pre-staged API uploads, and live camera snapshots.
 * Used by vision tool primitives (vision_describe, vision_extract, vision_verify, vision_compare).
 */
export const callMediaTable = pgTable("call_media", {
  id:             serial("id").primaryKey(),
  callId:         integer("call_id").references(() => callsTable.id, { onDelete: "cascade" }),
  agentId:        integer("agent_id").references(() => agentsTable.id, { onDelete: "cascade" }),
  userId:         text("user_id"),
  phone:          text("phone"),
  /** Where the image came from */
  source:         text("source").notNull(), // 'webcall_upload' | 'webcall_snapshot' | 'whatsapp' | 'api_staged' | 'url_ref'
  mimeType:       text("mime_type").notNull(),
  fileName:       text("file_name"),
  byteSize:       integer("byte_size").notNull().default(0),
  imageData:      bytea("image_data"),         // null when source = 'url_ref'
  urlRef:         text("url_ref"),             // null when stored inline
  /** Cached vision analysis results — keyed by SHA256(provider+prompt) to avoid re-billing */
  analysisCache:  jsonb("analysis_cache").default({}),
  /** Days to retain this media. Null = use agent default (30d). */
  retentionDays:  integer("retention_days"),
  createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("call_media_call_id_idx").on(t.callId),
  index("call_media_agent_phone_idx").on(t.agentId, t.phone),
  index("call_media_agent_staged_idx").on(t.agentId, t.source),
]);

export type CallMedia       = typeof callMediaTable.$inferSelect;
export type InsertCallMedia = typeof callMediaTable.$inferInsert;
