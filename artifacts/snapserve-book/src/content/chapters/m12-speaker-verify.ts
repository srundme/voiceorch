import type { Chapter } from "../types";

export const inCallSpeakerVerify: Chapter = {
  slug: "in-call-speaker-verify",
  moduleId: "m12",
  number: "13.3",
  title: "In-Call Speaker Verification",
  summary:
    "Mid-call speaker change detection — how the pipeline watches for a different voice on the line and challenges the caller verbally.",
  estMinutes: 14,
  fileRef: "artifacts/api-server/src/orchestration/pipeline.ts",
  prerequisites: ["speaker-recognition", "session-and-pipeline"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "The compliance concern: phone handoff",
      paragraphs: [
        "Imagine a call where a customer calls in, passes KYC, and then hands the phone to someone else — a friend, a family member — who continues the conversation as if they were the original caller. This 'phone handoff' is a real fraud vector in call centres handling sensitive operations: insurance claims, bank transfers, account changes.",
        "SnapServe's in-call speaker verifier detects this mid-call. It computes a speaker embedding from the caller's first few seconds of audio (the enrollment reference), then periodically checks subsequent audio against this reference. If the voice on the line changes significantly, it triggers a challenge.",
        "This is opt-in (`agentConfig.speakerVerification.enabled`) and is designed to be **non-disruptive**. It never hangs up. It never blocks the conversation. When a voice change is detected, the agent verbally asks 'Am I still speaking with [name]?' in the caller's language, and logs a compliance alert — continuing the conversation regardless of the answer.",
      ],
    },
    {
      kind: "concept",
      title: "The three-phase lifecycle",
      body: [
        "**Phase 1 — Reference collection**: The first 3-5 seconds of the caller's speech are buffered. Once enough audio is accumulated, a reference embedding is computed via the speaker recognition service. This is the 'who we enrolled this call as'.",
        "**Phase 2 — Ongoing monitoring**: Every 30 seconds (configurable), a fresh embedding is computed from the most recent caller audio and compared to the reference. If cosine similarity drops below the alert threshold (`0.72`, more lenient than the 0.82 enrollment threshold), a potential handoff is flagged.",
        "**Phase 3 — Verbal challenge**: When flagged, a `pendingSpeakerChallenge` is injected into the pipeline. On the next LLM turn, the system prompt includes a one-shot instruction: 'Ask the caller to confirm their identity.' The agent speaks the challenge naturally, in-language. After the challenge, the response audio is compared to the reference. If the score is still low, a COMPLIANCE warning is logged.",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "The speaker verification check inside the pipeline. It uses `setImmediate` to defer off the STT callback — never block the transcription path.",
      code: `private checkSpeakerVerification(callerPcm: Buffer): void {
  if (!this.svSession || this.isPlaying) return;
  // Echo-gate: skip frames during TTS playback
  // (agent voice leaks back through the caller's speaker)

  this.svSession.addCallerAudio(callerPcm);

  if (!this.svSession.hasEnoughAudio()) return;

  // Defer off the STT callback — never block transcription
  setImmediate(async () => {
    const score = await this.svSession!.runDetection();
    if (score === null) return; // not enough audio yet

    if (score < this.svThreshold) {
      logger.warn(
        { callId: this.config.callId, score, threshold: this.svThreshold },
        "Compliance: possible speaker change detected"
      );
      // Inject verbal challenge on next LLM turn
      this.pendingSpeakerChallenge = true;
    }
  });
}`,
      lines: [
        {
          lines: "2-3",
          label: "echo-gate: !isPlaying",
          explanation:
            "When the agent is playing TTS audio, the caller's phone picks up the agent's voice and sends it back as 'caller audio'. Computing a speaker embedding on this leakback would produce a fingerprint of the AGENT's voice, not the caller's. The echo gate is mandatory.",
        },
        {
          lines: "9-10",
          label: "setImmediate defer",
          explanation:
            "`setImmediate` defers the detection to after the current event loop tick. The STT callback (where this is called) is latency-critical — any blocking work would delay the transcript from reaching the LLM. Deferring with `setImmediate` puts the detection work on the next tick, where it can't affect turn latency.",
        },
        {
          lines: "14-20",
          label: "log + inject challenge",
          explanation:
            "Two things happen on detection: a structured log line with `Compliance: possible speaker change detected` and the score, and `pendingSpeakerChallenge = true`. The next LLM call includes this flag and adds a one-shot challenge instruction to the system prompt.",
        },
      ],
    },
    {
      kind: "code",
      filename: "orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "The system prompt injection for the speaker challenge. A concise, urgent one-shot instruction that overrides the agent's normal behaviour for one turn.",
      code: `if (this.pendingSpeakerChallenge) {
  this.pendingSpeakerChallenge = false; // clear before the LLM call

  const challengeText = this.agent.language?.startsWith("hi")
    ? "अभी तुरंत पूछो: 'क्या मैं अभी भी आपसे बात कर रहा हूँ?' नाम मत लो।"
    : "Right now, ask: 'Am I still speaking with the same person?' Keep it brief.";

  systemPrompt += \`\\n\\n[SPEAKER VERIFICATION ALERT — ONE TIME ONLY]\\n\${challengeText}\`;
}`,
      lines: [
        {
          lines: "2",
          label: "clear before calling LLM",
          explanation:
            "The flag is cleared before the LLM call, not after. If the flag were cleared after, and the LLM call failed and was retried, the challenge would fire twice. Clearing first means only one challenge per detection event, even on retry.",
        },
        {
          lines: "3-6",
          label: "localised challenge",
          explanation:
            "The challenge instruction is in the agent's language. The one-shot nature ('RIGHT NOW', 'ONE TIME ONLY') is explicit — the LLM must issue the challenge immediately, not defer it to later in the conversation.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Why not end the call or play a recorded message?",
      body: [
        "Hanging up on a suspected handoff would be aggressive and frequently wrong (the model has false positives — siblings often have similar voices; background noise can lower the score). Playing a recorded authentication prompt breaks the conversational flow and is jarring.",
        "The verbal challenge approach — the agent naturally asks 'Am I still speaking with you?' — is minimally disruptive. If the score was a false positive, the caller says 'yes' and the call continues. If it was a real handoff, the call centre has a log entry flagging the incident for review. The agent keeps talking either way.",
      ],
    },
    {
      kind: "callout",
      variant: "warning",
      title: "This is not biometric authentication",
      body: [
        "In-call speaker verification is a **soft signal** — it's a tool for call centre compliance monitoring, not a hard authentication gate. ECAPA-TDNN has false positive and false negative rates; twins, family members, and callers with colds all confuse it. Never use this alone to authorise a sensitive transaction. Pair it with PIN verification, OTP, or other hard auth factors.",
      ],
    },
    {
      kind: "connections",
      title: "In-call verification lifecycle",
      nodes: [
        { id: "audio",   label: "Caller audio",           sublabel: "PCM frames" },
        { id: "gate",    label: "Echo gate",              sublabel: "!isPlaying" },
        { id: "svs",     label: "SpeakerVerifySession",   sublabel: "accumulates audio" },
        { id: "svc",     label: "Speaker service",        sublabel: "/verify",       chapterSlug: "speaker-recognition" },
        { id: "score",   label: "Cosine score",           sublabel: "< threshold?" },
        { id: "log",     label: "Compliance log",         sublabel: "WARN level" },
        { id: "prompt",  label: "pendingSpeakerChallenge", sublabel: "→ LLM challenge", current: true },
      ],
      edges: [
        { from: "audio",  to: "gate",   label: "each frame" },
        { from: "gate",   to: "svs",    label: "caller frames only" },
        { from: "svs",    to: "svc",    label: "30s batch" },
        { from: "svc",    to: "score",  label: "cosine similarity" },
        { from: "score",  to: "log",    label: "if < 0.72" },
        { from: "score",  to: "prompt", label: "if < 0.72" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why is the `pendingSpeakerChallenge` flag cleared BEFORE the LLM call, not after?",
          choices: [
            "The flag must be clear before the system prompt is assembled",
            "Clearing after would allow the challenge to fire twice if the LLM call is retried",
            "The LLM modifies the flag as part of its response",
            "To avoid a race condition with the audio accumulator",
          ],
          correctIndex: 1,
          explanation:
            "If cleared after, and the LLM call fails and retries, `pendingSpeakerChallenge` would still be `true` on the retry, causing the challenge to appear twice in the same call. Clearing first ensures exactly one challenge per detection event.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Three phases: reference collection (first 3-5s) → periodic monitoring (every 30s) → verbal challenge if score drops",
        "Echo gate is mandatory: detection runs only when `!isPlaying` to avoid agent TTS leakback",
        "`setImmediate` defers detection off the latency-critical STT callback path",
        "Detection result: WARN log + `pendingSpeakerChallenge` injected into the next LLM turn's system prompt",
        "Soft signal only — never use as a sole auth gate; pair with OTP or PIN for sensitive operations",
      ],
    },
  ],
};
