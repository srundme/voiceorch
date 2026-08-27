import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The ten turn invariants are tribal knowledge until the build fails when
 * someone reintroduces STT gating (772→1320) or idle-from-the-wrong-clock
 * (14315). These are source-scan guards on pipeline.ts — they do not run a
 * live call, they fail CI when the wiring that *caused* those incidents
 * comes back.
 */
const pipelineSrc = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "pipeline.ts"),
  "utf8",
);

function methodBody(name: string): string {
  const start = pipelineSrc.search(new RegExp(`private (?:async )?${name}\\s*\\(`));
  expect(start, `${name} must exist on OrchestrationPipeline`).toBeGreaterThan(-1);
  const brace = pipelineSrc.indexOf("{", start);
  let depth = 0;
  for (let i = brace; i < pipelineSrc.length; i++) {
    const ch = pipelineSrc[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return pipelineSrc.slice(brace, i + 1);
    }
  }
  throw new Error(`unclosed method ${name}`);
}

describe("live pipeline invariants (calls 772→1320, 14315)", () => {
  it("feeds streaming STT unconditionally — never gated on TTS (772→1320)", () => {
    const marker = "INVARIANT — DO NOT GATE OR FLUSH THIS FEED";
    const start = pipelineSrc.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const send = pipelineSrc.indexOf("this.streamSTT.sendAudio(sttFrame)", start);
    expect(send).toBeGreaterThan(start);
    const between = pipelineSrc.slice(start, send);
    expect(between).not.toMatch(/if\s*\(\s*!?\s*this\.isPlaying/);
    expect(between).not.toMatch(/if\s*\(\s*!?\s*this\.isSendingTtsAudio/);
    expect(between).not.toMatch(/AlwaysUserMute|muteUser|gateStt|sttGated/);
    expect([...pipelineSrc.matchAll(/streamSTT\.sendAudio/g)]).toHaveLength(1);
  });

  it("starts idle when the bot stops speaking, not from leftover user-turn time (14315)", () => {
    const body = methodBody("onBotStoppedSpeaking");
    expect(body).toContain("this.resetHangupTimer()");
    expect(body).toContain("this.safetyNet.beginListening()");
    expect(pipelineSrc).toContain("Pipecat UserIdleController");
    expect(pipelineSrc).toContain("call 14315");
  });

  it("pages once when Smart Turn is missing (fail-open is degraded mode, not silent)", () => {
    expect(pipelineSrc).toContain('["smart_turn_fail_open"]');
    expect(pipelineSrc).toContain("_smartTurnFailOpenAlerted");
    expect(pipelineSrc).toMatch(/Smart Turn fail-open/);
    const evalBody = methodBody("evaluateSemanticTurn");
    expect(evalBody).toContain("!sessionReady");
    expect(evalBody).toContain("logWarningEvent");
    expect(evalBody).toContain("smart_turn_fail_open");
  });

  it("does not drop listening finals on RMS — STT is the turn authority (call 14351)", () => {
    expect(pipelineSrc).not.toMatch(/logDiscardedTranscript\(\s*transcript,\s*"background_talker"\s*\)/);
    expect(pipelineSrc).not.toContain("isBackgroundTalkerUtterance(");
    expect(pipelineSrc).not.toContain("utterancePeakRawRms");
  });

  it("does not WAIT-pause the TTS send pump while the agent is speaking (call 14351 voice break)", () => {
    const body = methodBody("audioSendStatus");
    expect(body).toContain("isPlaying");
    expect(body).toContain("isSendingTtsAudio");
    expect(body).toMatch(/status === "WAIT"/);
  });
});
