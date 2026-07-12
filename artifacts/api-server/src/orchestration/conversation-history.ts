import type { ConversationTurn } from "./types.js";

/**
 * Structured conversation history with:
 *  - Turn-ID + response-UID indexed assistant trimming after interruption
 *  - Tool call/response pair sanitization (orphan repair)
 *  - Duplicate user detection
 *  - Pop-and-merge for consecutive user turns
 *  - Pop-unheard-responses for barge-in
 *
 * Modelled after Bolna's ConversationHistory class; replaces the raw
 * ConversationTurn[] array in pipeline.ts.
 */
export class ConversationHistory {
  private _messages: ConversationTurn[] = [];

  /** Monotonically-increasing counter; incremented on each appendUser call. */
  private _turnCounter = 0;

  // ── Append (write) ───────────────────────────────────────────────────────

  /** Append a user turn. Returns the new turn-ID. */
  appendUser(content: string): number {
    const turnId = ++this._turnCounter;
    const entry: ConversationTurn & { _turnId?: number } = { role: "user", content };
    entry._turnId = turnId;
    this._messages.push(entry);
    return turnId;
  }

  /** Append an assistant turn. Optionally tag with responseUid for precise interruption trimming. */
  appendAssistant(
    content: string,
    meta?: {
      responseUid?: string;
      toolCalls?: ConversationTurn["toolCalls"];
    },
  ): void {
    const entry: ConversationTurn & { _turnId?: number; _responseUid?: string } = {
      role: "assistant",
      content,
    };
    if (meta?.toolCalls?.length) entry.toolCalls = meta.toolCalls;
    entry._turnId = this._turnCounter;
    if (meta?.responseUid) entry._responseUid = meta.responseUid;
    this._messages.push(entry);
  }

  /** Append a tool-result turn. */
  appendToolResult(content: string, toolCallId?: string, toolName?: string): void {
    this._messages.push({ role: "tool", content, toolCallId, toolName });
  }

  // ── Interruption / barge-in ──────────────────────────────────────────────

  /**
   * Remove the most recent `count` assistant turns (and any tool turns that
   * immediately follow them) — used when barge-in means the caller didn't
   * finish hearing those turns.
   *
   * If `responseUid` is supplied, finds and removes that exact response plus
   * everything that follows it instead of counting backwards.
   */
  popUnheardResponses(count = 1, responseUid?: string): void {
    if (responseUid) {
      for (let i = this._messages.length - 1; i >= 0; i--) {
        const m = this._messages[i] as ConversationTurn & { _responseUid?: string };
        if (m.role === "assistant" && m._responseUid === responseUid) {
          this._messages.splice(i);
          return;
        }
      }
      return;
    }

    let removed = 0;
    for (let i = this._messages.length - 1; i >= 0 && removed < count; i--) {
      if (this._messages[i]!.role === "assistant") {
        // Remove any trailing tool turns that belong to this assistant turn.
        while (
          this._messages.length > i + 1 &&
          this._messages[i + 1]!.role === "tool"
        ) {
          this._messages.splice(i + 1, 1);
        }
        this._messages.splice(i, 1);
        removed++;
        i = this._messages.length; // re-anchor (splice shifts indices)
      }
    }
  }

  /**
   * Collapse consecutive user turns at the tail into one merged turn.
   * Used when two STT finals arrive back-to-back before the LLM responds.
   */
  popAndMergeUser(): void {
    if (this._messages.length < 2) return;
    const last = this._messages[this._messages.length - 1]!;
    const prev = this._messages[this._messages.length - 2]!;
    if (last.role === "user" && prev.role === "user") {
      prev.content = `${prev.content} ${last.content}`.trim();
      this._messages.pop();
    }
  }

  // ── Sanitization ─────────────────────────────────────────────────────────

  /**
   * Ensure every tool-result turn has a matching assistant tool_calls entry
   * and every assistant toolCalls entry has a corresponding result.
   * Orphaned entries are removed. Call before each LLM invocation.
   */
  sanitizeToolMessages(): ConversationTurn[] {
    // Work on a shallow copy so the stored history is unchanged;
    // the sanitized slice is what gets sent to the LLM each turn.
    const msgs = [...this._messages];

    // Pass 1: collect all tool-result call IDs.
    const resultIds = new Set<string>();
    for (const m of msgs) {
      if (m.role === "tool" && m.toolCallId) resultIds.add(m.toolCallId);
    }

    // Pass 2: remove assistant turns whose tool calls have no result yet.
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]!;
      if (m.role === "assistant" && m.toolCalls?.length) {
        const allResolved = m.toolCalls.every((tc) => resultIds.has(tc.id));
        if (!allResolved) {
          const idsToRemove = new Set(m.toolCalls.map((tc) => tc.id));
          msgs.splice(i, 1);
          // Remove orphaned tool results immediately after.
          while (
            i < msgs.length &&
            msgs[i]!.role === "tool" &&
            msgs[i]!.toolCallId &&
            idsToRemove.has(msgs[i]!.toolCallId!)
          ) {
            msgs.splice(i, 1);
          }
        }
      }
    }

    // Pass 3: remove tool results with no preceding assistant tool_call.
    const calledIds = new Set<string>();
    for (const m of msgs) {
      if (m.role === "assistant" && m.toolCalls?.length) {
        for (const tc of m.toolCalls) calledIds.add(tc.id);
      }
    }
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]!;
      if (m.role === "tool" && m.toolCallId && !calledIds.has(m.toolCallId)) {
        msgs.splice(i, 1);
      }
    }

    return msgs;
  }

  // ── Duplicate detection ──────────────────────────────────────────────────

  /**
   * Returns true if the most recent user turn in history has identical
   * normalised content.  Prevents double-push when STT fires a duplicate final.
   */
  isDuplicateUser(content: string): boolean {
    for (let i = this._messages.length - 1; i >= 0; i--) {
      const m = this._messages[i]!;
      if (m.role === "user") return normalise(m.content) === normalise(content);
      if (m.role === "assistant") break; // crossed a turn boundary — not a duplicate
    }
    return false;
  }

  // ── Mutation helpers ─────────────────────────────────────────────────────

  /** Replace the content of the most recent user turn (language-switch correction). */
  replaceLastUser(content: string): void {
    for (let i = this._messages.length - 1; i >= 0; i--) {
      if (this._messages[i]!.role === "user") {
        this._messages[i]!.content = content;
        return;
      }
    }
  }

  /**
   * Replace the first `deleteCount` entries with a single summary turn.
   * Used by the context-summarisation path.
   */
  replaceRangeWithSummary(deleteCount: number, summary: ConversationTurn): void {
    this._messages.splice(0, deleteCount, summary);
  }

  // ── Array-like read helpers ──────────────────────────────────────────────

  /** Raw message array — do not mutate; use appendUser/appendAssistant/appendToolResult/replaceRangeWithSummary. */
  get messages(): ConversationTurn[] {
    return this._messages;
  }

  /** Shallow copy for immutable use in LLM calls. */
  snapshot(): ConversationTurn[] {
    return [...this._messages];
  }

  get length(): number {
    return this._messages.length;
  }

  some(predicate: (t: ConversationTurn) => boolean): boolean {
    return this._messages.some(predicate);
  }

  filter(predicate: (t: ConversationTurn) => boolean): ConversationTurn[] {
    return this._messages.filter(predicate);
  }

  findLast(predicate: (t: ConversationTurn) => boolean): ConversationTurn | undefined {
    for (let i = this._messages.length - 1; i >= 0; i--) {
      if (predicate(this._messages[i]!)) return this._messages[i];
    }
    return undefined;
  }
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}
