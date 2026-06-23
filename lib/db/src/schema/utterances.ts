import { pgTable, serial, integer, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { callsTable } from "./calls";

/**
 * Per-utterance analytics — one row per user speech turn.
 *
 * Populated at call time by the webcall (and telephony pipeline) path.
 * Enables fine-grained conversation analytics:
 *   - Average pause length per call / per language
 *   - Interruption rate (agent interrupted count / turn count)
 *   - Tamil-English code-mix ratio (coalesced Tamil turns vs English turns)
 *   - Agent talk percentage (utterance count & latency breakdown)
 *   - Dead air detection (gaps > N ms between turns)
 */
export const utterancesTable = pgTable(
  "utterances",
  {
    id:              serial("id").primaryKey(),
    callId:          integer("call_id").notNull().references(() => callsTable.id, { onDelete: "cascade" }),
    /** Transcribed text of the user's turn. */
    text:            text("text").notNull(),
    /** Detected language code, e.g. "ta-IN", "en-US". Null when provider didn't return one. */
    language:        text("language"),
    /** Wall-clock when this utterance was received (= when STT transcript arrived). */
    turnAt:          timestamp("turn_at", { withTimezone: true }).notNull().defaultNow(),
    /** True when two or more Sarvam segments were merged (mid-sentence pause coalesced). */
    coalesced:       boolean("coalesced").notNull().default(false),
    /** How many raw STT segments were folded into this utterance (1 = no merging). */
    mergedSegments:  integer("merged_segments").notNull().default(1),
    /** Number of within-utterance pauses that were bridged (mergedSegments − 1). */
    pauseCount:      integer("pause_count").notNull().default(0),
    /** STT provider that produced this transcript. */
    provider:        text("provider"),
    /** ms from speech-end detection → final transcript (STT processing latency). */
    latencyMs:       integer("latency_ms"),
  },
  (t) => [
    index("utterances_call_id_idx").on(t.callId),
    index("utterances_turn_at_idx").on(t.turnAt),
  ],
);

export type Utterance     = typeof utterancesTable.$inferSelect;
export type InsertUtterance = typeof utterancesTable.$inferInsert;
