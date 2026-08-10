import { pgTable, text, uuid, jsonb, boolean, timestamp, integer } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents.js";
import { callsTable } from "./calls.js";

export type TaxonomyMap = Record<string, string[]>;

export interface DomainFieldCfg {
  key: string;
  type: "string" | "number" | "boolean";
  /** Human label for Builder / call detail (optional for older rows). */
  label?: string;
  enum?: string[];
}

export interface TenantRule {
  when: string;
  value?: unknown;
  primary: string;
  sub: string;
  confidence: number;
}

/**
 * Maps this agent's taxonomy labels → SnapServe funnel meanings.
 * Keys are disposition tokens (primary, sub, or "primary:sub").
 */
export type DispositionMeaningMap = {
  interested: string[];
  callback: string[];
  dnc: string[];
};

export const EMPTY_MEANING_MAP: DispositionMeaningMap = {
  interested: [],
  callback: [],
  dnc: [],
};

export const agentDispositionsTable = pgTable("agent_dispositions", {
  agentId: integer("agent_id").primaryKey().references(() => agentsTable.id, { onDelete: "cascade" }),
  taxonomy: jsonb("taxonomy").notNull().$type<TaxonomyMap>(),
  domainFields: jsonb("domain_fields").default([]).$type<DomainFieldCfg[]>(),
  rules: jsonb("rules").default([]).$type<TenantRule[]>(),
  meaningMap: jsonb("meaning_map").$type<DispositionMeaningMap | null>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const callDispositionsTable = pgTable("call_dispositions", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: integer("agent_id").references(() => agentsTable.id, { onDelete: "set null" }),
  callId: integer("call_id").references(() => callsTable.id, { onDelete: "set null" }),
  transcript: text("transcript"),
  callEvents: jsonb("call_events").$type<Record<string, unknown>[]>(),
  result: jsonb("result").$type<Record<string, unknown>>(),
  needsReview: boolean("needs_review").default(false),
  humanCorrection: jsonb("human_correction").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AgentDisposition = typeof agentDispositionsTable.$inferSelect;
export type CallDisposition = typeof callDispositionsTable.$inferSelect;
