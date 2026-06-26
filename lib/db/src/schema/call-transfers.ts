import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { callsTable } from "./calls";

export const callTransfersTable = pgTable(
  "call_transfers",
  {
    id:                 serial("id").primaryKey(),
    callId:             integer("call_id").notNull().references(() => callsTable.id, { onDelete: "cascade" }),
    userId:             text("user_id").notNull().references(() => usersTable.clerkId, { onDelete: "cascade" }),
    transferTo:         text("transfer_to").notNull(),
    transferName:       text("transfer_name"),
    summary:            text("summary"),
    status:             text("status").notNull().default("initiated"),
    providerTransferId: text("provider_transfer_id"),
    /**
     * Unguessable capability token embedded in warm-briefing whisper URLs.
     * The provider must present this token to fetch the briefing XML; without
     * it the endpoint returns 403. Generated at insert time with 32 random bytes.
     * Prevents sequential-ID enumeration of cross-tenant call summaries.
     */
    briefingToken:      text("briefing_token"),
    initiatedAt:        timestamp("initiated_at", { withTimezone: true }).notNull().defaultNow(),
    connectedAt:        timestamp("connected_at", { withTimezone: true }),
    completedAt:        timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("call_transfers_call_idx").on(t.callId),
    index("call_transfers_user_idx").on(t.userId, t.initiatedAt),
  ],
);

export type CallTransfer = typeof callTransfersTable.$inferSelect;
