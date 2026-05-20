import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";

export const callerProfilesTable = pgTable("caller_profiles", {
  id:           serial("id").primaryKey(),
  agentId:      integer("agent_id").references(() => agentsTable.id, { onDelete: "cascade" }).notNull(),
  phoneNumber:  text("phone_number").notNull(),
  name:         text("name"),
  summary:      text("summary"),
  callCount:    integer("call_count").default(0).notNull(),
  lastCalledAt: timestamp("last_called_at"),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("caller_profiles_agent_phone_uidx").on(t.agentId, t.phoneNumber),
]);
