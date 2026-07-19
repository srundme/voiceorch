/**
 * Pre-pipeline ambient keepalive for telephony.
 *
 * createSession can take several seconds (DB setup) before OrchestrationPipeline
 * exists. During that window the carrier previously heard only PCM zeros / no
 * audio — including when the agent has background noise configured (ambient
 * lives inside the pipeline).
 *
 * This module starts audible comfort noise the moment the media WS opens, then
 * upgrades to the agent's configured ambient track as soon as a single light
 * agent_config read (and optional PCM cache/load) completes. Call stop() when
 * createSession hands audio to the pipeline (first onAudioOut / session ready).
 */

import { eq } from "drizzle-orm";
import { db, agentsTable } from "@workspace/db";
import { logger } from "../../lib/logger.js";
import {
  AmbientNoiseStream,
  FileAmbientNoiseStream,
  TRACK_PARAMS,
  loadPcmLoop,
  peekCachedPcmLoop,
} from "../ambient.js";

const INTERVAL_MS = 20;
const PCM_SILENCE = Buffer.alloc((8000 * INTERVAL_MS) / 1000 * 2, 0); // 160 samples × 2 bytes
const MULAW_SILENCE = Buffer.alloc((8000 * INTERVAL_MS) / 1000, 0xff); // μ-law silence

type AmbientChunker = {
  nextPcmChunk: () => Buffer;
  nextMulawChunk: () => Buffer;
};

export type EarlyAmbientFormat = "pcm16" | "mulaw";

export interface EarlyAmbientKeepalive {
  stop: () => void;
}

export function startEarlyAmbientKeepalive(opts: {
  agentId: number;
  format: EarlyAmbientFormat;
  send: (chunk: Buffer) => void;
}): EarlyAmbientKeepalive {
  let stopped = false;
  // Instant comfort noise — no DB. Replaced when agent ambient resolves.
  let stream: AmbientChunker | null = new AmbientNoiseStream("office-ambience");
  let useSilence = false;

  const tick = (): void => {
    if (stopped) return;
    let chunk: Buffer;
    if (useSilence || !stream) {
      chunk = opts.format === "pcm16" ? PCM_SILENCE : MULAW_SILENCE;
    } else {
      chunk = opts.format === "pcm16" ? stream.nextPcmChunk() : stream.nextMulawChunk();
    }
    try {
      opts.send(chunk);
    } catch {
      /* WS may already be closing */
    }
  };

  const timer = setInterval(tick, INTERVAL_MS);
  tick(); // first frame immediately — don't wait 20ms

  void resolveAndUpgrade(opts.agentId)
    .then((resolved) => {
      if (stopped) return;
      if (!resolved) return; // keep comfort noise
      if (!resolved.enabled || !resolved.track) {
        useSilence = true;
        stream = null;
        logger.info({ agentId: opts.agentId }, "early-ambient: agent has ambient off — silence until pipeline");
        return;
      }
      stream = resolved.stream;
      useSilence = false;
      logger.info(
        { agentId: opts.agentId, track: resolved.track, source: resolved.source },
        "early-ambient: upgraded to agent track",
      );
    })
    .catch((err) => {
      logger.warn({ agentId: opts.agentId, err }, "early-ambient: agent track resolve failed — keeping comfort noise");
    });

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
    },
  };
}

async function resolveAndUpgrade(agentId: number): Promise<{
  enabled: boolean;
  track: string | null;
  stream: AmbientChunker;
  source: "builtin" | "uploaded-cache" | "uploaded-db";
} | null> {
  const [row] = await db
    .select({ agentConfig: agentsTable.agentConfig })
    .from(agentsTable)
    .where(eq(agentsTable.id, agentId))
    .limit(1);
  if (!row) return null;

  const cfg = (row.agentConfig ?? {}) as {
    ambientNoiseEnabled?: boolean;
    ambientNoiseTrack?: string;
    ambientNoiseVolume?: number;
  };
  const enabled = cfg.ambientNoiseEnabled === true;
  const track = typeof cfg.ambientNoiseTrack === "string" ? cfg.ambientNoiseTrack : null;
  const volume =
    typeof cfg.ambientNoiseVolume === "number" && Number.isFinite(cfg.ambientNoiseVolume)
      ? Math.max(0, Math.min(1, cfg.ambientNoiseVolume))
      : 1.0;

  if (!enabled || !track) {
    return { enabled: false, track: null, stream: new AmbientNoiseStream("office-ambience"), source: "builtin" };
  }

  if (Object.prototype.hasOwnProperty.call(TRACK_PARAMS, track)) {
    return {
      enabled: true,
      track,
      stream: new AmbientNoiseStream(track, volume),
      source: "builtin",
    };
  }

  const cached = peekCachedPcmLoop(track);
  if (cached) {
    return {
      enabled: true,
      track,
      stream: new FileAmbientNoiseStream(cached, volume),
      source: "uploaded-cache",
    };
  }

  const pcm = await loadPcmLoop(track);
  return {
    enabled: true,
    track,
    stream: new FileAmbientNoiseStream(pcm, volume),
    source: "uploaded-db",
  };
}
