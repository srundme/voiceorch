/**
 * Saved Sruthi opener. Played the moment the phone socket opens, while
 * createSession is still connecting, so the caller does not sit in silence.
 *
 * The clip is one take of INTAKE_GREETING with the name Sruthi. Any other
 * greeting keeps the live voice path.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { agentsTable, db } from "@workspace/db";
import { logger } from "../../lib/logger.js";
import { SAVED_OPENING_TEXT, savedOpeningTextFor } from "./saved-opening-text.js";

export { SAVED_OPENING_TEXT, savedOpeningTextFor };

const FRAME_BYTES = 320; // 20 ms at 8 kHz, 16-bit mono
const FRAME_MS = 20;

function loadOpeningPcm(): Buffer {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "sruthi-opening.pcm"),
    join(here, "orchestration", "telephony", "sruthi-opening.pcm"),
    join(here, "telephony", "sruthi-opening.pcm"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return readFileSync(path);
  }
  logger.warn({ tried: candidates }, "Saved opening clip is not in this build");
  return Buffer.alloc(0);
}

const OPENING_PCM = loadOpeningPcm();

export interface PreplayedOpening {
  text: string;
  startedAt: number;
  durationMs: number;
  done: Promise<void>;
}

export interface SavedOpeningHandle {
  /** Null when this call should speak its greeting the usual way. */
  ready: Promise<PreplayedOpening | null>;
  /** Let a finished clip go, and drop the silence that was holding the line. */
  release: () => void;
  /** Cut the clip now. Barge-in, the next real reply, or hangup. */
  stop: () => void;
}

export function startSavedOpening(opts: {
  agentId: number;
  enabled: boolean;
  send: (chunk: Buffer) => void;
  onBegin: () => void;
}): SavedOpeningHandle {
  let stopped = false;
  let released = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let resolveReady: (value: PreplayedOpening | null) => void = () => {};
  let resolveDone: () => void = () => {};
  const ready = new Promise<PreplayedOpening | null>((resolve) => { resolveReady = resolve; });
  const done = new Promise<void>((resolve) => { resolveDone = resolve; });
  let finishDone = false;
  const finish = (): void => {
    if (finishDone) return;
    finishDone = true;
    if (timer) clearInterval(timer);
    timer = null;
    resolveDone();
  };

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    finish();
  };
  const release = (): void => {
    released = true;
    if (stopped) return;
    // Still speaking the clip. The tail of silence is only for the gap
    // before the session exists.
    if (timer && offset >= OPENING_PCM.length) stop();
  };

  let offset = 0;
  const tick = (): void => {
    if (stopped) return;
    if (offset >= OPENING_PCM.length) {
      if (released) {
        stop();
        return;
      }
      try { opts.send(Buffer.alloc(FRAME_BYTES)); } catch { /* socket closing */ }
      return;
    }
    const next = Math.min(offset + FRAME_BYTES, OPENING_PCM.length);
    const frame = Buffer.alloc(FRAME_BYTES);
    OPENING_PCM.copy(frame, 0, offset, next);
    offset = next;
    try { opts.send(frame); } catch { /* socket closing */ }
  };

  if (!opts.enabled) {
    resolveReady(null);
    finish();
  } else {
    void db
      .select({ name: agentsTable.name, greetingMessage: agentsTable.greetingMessage })
      .from(agentsTable)
      .where(eq(agentsTable.id, opts.agentId))
      .limit(1)
      .then((rows) => {
        if (stopped) {
          resolveReady(null);
          return;
        }
        const row = rows[0];
        const text = row ? savedOpeningTextFor(row.name, row.greetingMessage) : null;
        if (!text || OPENING_PCM.length === 0) {
          resolveReady(null);
          finish();
          return;
        }
        const startedAt = Date.now();
        opts.onBegin();
        timer = setInterval(tick, FRAME_MS);
        tick();
        logger.info({ agentId: opts.agentId, ms: OPENING_PCM.length / 16 }, "Saved opening started");
        resolveReady({
          text,
          startedAt,
          durationMs: Math.round(OPENING_PCM.length / 2 / 8),
          done,
        });
      })
      .catch((err) => {
        logger.warn({ agentId: opts.agentId, err }, "Saved opening lookup failed");
        resolveReady(null);
        finish();
      });
  }

  return { ready, release, stop };
}
