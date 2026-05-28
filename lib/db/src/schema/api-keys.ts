import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const userApiKeysTable = pgTable(
  "user_api_keys",
  {
    id:         serial("id").primaryKey(),
    userId:     text("user_id").notNull().references(() => usersTable.clerkId, { onDelete: "cascade" }),
    name:       text("name").notNull().default("Default"),
    keyHash:    text("key_hash").notNull().unique(),
    keyPrefix:  text("key_prefix").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt:  timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("user_api_keys_user_id_idx").on(t.userId)],
);

export type UserApiKey = typeof userApiKeysTable.$inferSelect;
