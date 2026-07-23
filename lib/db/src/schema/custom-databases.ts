import { pgTable, serial, text, timestamp, integer, jsonb, boolean } from "drizzle-orm/pg-core";

export type CustomColumnType = "text" | "number" | "image" | "badge" | "date";

export type CustomColumnDef = {
  key: string;
  label: string;
  type: CustomColumnType;
  primaryKey?: boolean;
  required?: boolean;
};

export const customDatabasesTable = pgTable("custom_databases", {
  id: serial("id").primaryKey(),
  userId: text("user_id"),
  agentId: integer("agent_id"),
  name: text("name").notNull(),
  description: text("description"),
  columns: jsonb("columns").$type<CustomColumnDef[]>().notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const customDatabaseRowsTable = pgTable("custom_database_rows", {
  id: serial("id").primaryKey(),
  databaseId: integer("database_id").notNull().references(() => customDatabasesTable.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<Record<string, any>>().notNull(),
  referenceImageUrls: jsonb("reference_image_urls").$type<string[]>().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
