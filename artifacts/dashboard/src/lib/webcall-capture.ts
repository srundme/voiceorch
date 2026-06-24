// Shared web-call microphone capture utilities.
//
// Both web-call entry points (the embedded `WebCallPanel` component and the
// agent test panel on the Assistants page) capture mic audio, resample it to
// 16 kHz LINEAR16, and stream it to the server over a WebSocket. The same mic
// frames feed BOTH the STT/barge-in path AND the server-side stereo recorder,
// so any defect in the client capture chain is baked into the recording.
//
// Aliasing bug this fixes: the browser does not always honor the requested
// 16 kHz `AudioContext` sample rate (it commonly runs at 44.1/48 kHz). The old
// path reduced the rate by naive decimation with NO anti-aliasing filter, so
// loud high-frequency caller speech folded back into decorrelated broadband
// noise ("helicopter/static/buzz") on the caller (left) recording channel.
//
// Fix: when the context is not natively at 16 kHz, band-limit the signal with a
// low-pass biquad cascade BEFORE decimation so no energy above the 16 kHz
// Nyquist (8 kHz) reaches the decimator. On contexts already at 16 kHz the
// filter is skipped (no rate reduction happens, so there is nothing to alias).

/** Target wire sample rate for STT + recording. */
export const TARGET_SAMPLE_RATE = 16000;

/**
 * Anti-aliasing low-pass cutoff (Hz). ~7 kHz sits comfortably below the 16 kHz
 * Nyquist (8 kHz) while preserving speech intelligibility — telephony is band-
 * limited to 3.4 kHz and the STT/gender paths already work within an 8 kHz band.
 */
export const ANTIALIAS_CUTOFF_HZ = 7000;

/** Number of cascaded biquad stages — steepens the roll-off near the cutoff. */
export const ANTIALIAS_STAGES = 3;

/** Clamp + scale Float32 [-1,1] PCM to Int16 LINEAR16. */
export function float32ToInt16(f32: Float32Array): Int16Array {
  const int16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    int16[i] = Math.max(-32768, Math.min(32767, f32[i]! * 32768));
  }
  return int16;
}

/**
 * Linear-interpolating resampler. Safe for arbitrary (including non-integer)
 * rate ratios such as 44.1 kHz → 16 kHz. NOTE: this does NOT band-limit; it
 * must only be fed a signal already low-pass filtered below the target Nyquist
 * (see {@link startMicCapture}), otherwise it aliases.
 */
export function downsampleFloat32(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = input[idx] ?? 0;
    const b = input[idx + 1] ?? a;
    output[i] = a + frac * (b - a);
  }
  return output;
}

/** Handle returned by {@link startMicCapture} for teardown + diagnostics. */
export interface MicCaptureHandle {
  /** The ScriptProcessor pumping frames; caller stores it for teardown. */
  processor: ScriptProcessorNode;
  /** Source + filter nodes created for the graph; disconnect on teardown. */
  nodes: AudioNode[];
  /** The actual context sample rate observed (may differ from 16 kHz). */
  sampleRate: number;
  /** Which path ran: native 16 kHz (no resample) vs filtered+resampled. */
  path: "native-16k" | "resampled";
  /** Disconnect every node created by this capture graph. */
  disconnect: () => void;
}

/**
 * Build the mic-capture audio graph and start streaming 16 kHz Int16 frames.
 *
 * Graph: MediaStreamSource → [low-pass cascade]? → ScriptProcessor → destination
 *
 * The low-pass cascade is inserted ONLY when the context is not natively at
 * 16 kHz (i.e. when decimation would otherwise alias). Each processed frame is
 * handed to `onFrame` as an `ArrayBuffer` of LINEAR16 little-endian samples; the
 * caller is responsible for the WebSocket readyState check and sending.
 *
 * Logs the observed `ctx.sampleRate` and chosen path once at start so call-audio
 * validation can confirm whether the aliasing condition (ctx ≠ 16000) was
 * actually exercised in a given run.
 */
export function startMicCapture(
  ctx: AudioContext,
  stream: MediaStream,
  onFrame: (pcm: ArrayBufferLike) => void,
): MicCaptureHandle {
  const sampleRate = ctx.sampleRate;
  const native = sampleRate === TARGET_SAMPLE_RATE;
  const path: MicCaptureHandle["path"] = native ? "native-16k" : "resampled";

  const src = ctx.createMediaStreamSource(stream);
  const nodes: AudioNode[] = [src];

  let tail: AudioNode = src;
  if (!native) {
    for (let i = 0; i < ANTIALIAS_STAGES; i++) {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = ANTIALIAS_CUTOFF_HZ;
      lp.Q.value = Math.SQRT1_2; // 0.707 — maximally flat (Butterworth) per stage
      tail.connect(lp);
      tail = lp;
      nodes.push(lp);
    }
  }

  const processor = ctx.createScriptProcessor(2048, 1, 1);
  tail.connect(processor);
  processor.connect(ctx.destination);
  nodes.push(processor);

  let firstFrameLogged = false;
  processor.onaudioprocess = (e) => {
    const raw = e.inputBuffer.getChannelData(0);
    const samples = native ? raw : downsampleFloat32(raw, sampleRate, TARGET_SAMPLE_RATE);
    if (!firstFrameLogged) {
      firstFrameLogged = true;
      console.info(
        "[WEBCALL_AUDIO_DEBUG]",
        JSON.stringify({
          stage: "first-frame",
          downsampleDidRun: !native,
          inputSampleRate: sampleRate,
          outputSampleRate: TARGET_SAMPLE_RATE,
        }),
      );
    }
    onFrame(float32ToInt16(samples).buffer);
  };

  console.info(
    "[WEBCALL_AUDIO_DEBUG]",
    JSON.stringify({
      stage: "capture-setup",
      path,
      audioContextSampleRate: sampleRate,
      requestedSampleRate: TARGET_SAMPLE_RATE,
      micTrackSampleRate: stream.getAudioTracks()[0]?.getSettings().sampleRate,
      outputSampleRate: TARGET_SAMPLE_RATE,
      downsampleWillRun: !native,
      antialiasStages: native ? 0 : ANTIALIAS_STAGES,
      antialiasCutoffHz: native ? null : ANTIALIAS_CUTOFF_HZ,
      browser: navigator.userAgent,
    }),
  );

  return {
    processor,
    nodes,
    sampleRate,
    path,
    disconnect: () => {
      for (const n of nodes) {
        try { n.disconnect(); } catch { /* already disconnected */ }
      }
    },
  };
}
