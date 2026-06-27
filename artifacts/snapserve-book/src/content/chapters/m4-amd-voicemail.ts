import type { Chapter } from "../types";

export const amdVoicemail: Chapter = {
  slug: "amd-voicemail",
  moduleId: "m4",
  number: "5.8",
  title: "AMD & Voicemail Detection",
  summary:
    "How outbound calls detect answering machines before the agent speaks, and how voicemail messages get delivered.",
  estMinutes: 14,
  fileRef: "artifacts/api-server/src/orchestration/telephony/dial.ts",
  prerequisites: ["session-and-pipeline", "twilio-deep-dive"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "The Problem with Outbound Calls",
      paragraphs: [
        "When an agent makes an outbound call, the first thing it hears might not be a human. It could be a voicemail greeting, an IVR system, or dead silence from a fax machine. If the agent launches into its conversational greeting while a voicemail message is playing, the call is wasted — the agent talks over the beep and records garbled audio.",
        "**Answering Machine Detection (AMD)** is how telephony providers solve this. The provider listens to the first few seconds of the answered call and classifies the audio as either `human` or `machine`. Depending on that classification, the agent takes different actions.",
      ],
    },
    {
      kind: "concept",
      title: "How AMD works inside the provider",
      body: [
        "AMD runs entirely on the telephony provider's infrastructure — Twilio, Plivo, or VoBiz. SnapServe doesn't do the audio analysis itself. The provider listens to the answered call for up to 5 seconds and scores features like the length of the first silence, the cadence of audio energy, and the presence of the classic voicemail 'beep'. It then fires a status callback to your server with the result.",
        "Twilio calls this feature **MachineDetection**. Plivo calls it **machine_detection**. VoBiz fires a separate `voicemail_detected` event on its status webhook. The names and APIs differ, but the concept is identical: listen first, classify second, act third.",
        "AMD adds latency — typically 3-5 seconds before a human answer is confirmed. For call centres where speed-to-answer is critical, this is a tradeoff. SnapServe makes it opt-in per agent.",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/telephony/dial.ts",
      language: "typescript",
      intro:
        "`resolveAmdConfig` normalises the two different config shapes the UI can produce (the legacy assistant UI used booleans; the agent builder uses an enum) into one canonical object.",
      code: `export function resolveAmdConfig(
  agentConfig: Record<string, unknown> | null | undefined
): { enabled: boolean; twilioMode: "Enable" | "DetectMessageEnd" } {
  const cfg = agentConfig ?? {};

  // New builder shape: machineDetectionMode string enum
  const modeRaw = String(cfg["machineDetectionMode"] ?? "").toLowerCase();
  if (modeRaw === "enable") {
    return { enabled: true, twilioMode: "Enable" };
  }
  if (modeRaw === "detect_message_end") {
    return { enabled: true, twilioMode: "DetectMessageEnd" };
  }

  // No AMD configured
  return { enabled: false, twilioMode: "Enable" };
}`,
      lines: [
        {
          lines: "7-12",
          label: "\"enable\" vs \"detect_message_end\"",
          explanation:
            "`Enable` tells Twilio to fire the AMD result as soon as it can detect machine vs. human — typically within 3 seconds of answer. `DetectMessageEnd` waits until the voicemail greeting finishes (the beep), then fires. Use `DetectMessageEnd` when you want to leave a voicemail message; use `Enable` when you just want to skip machine-answered calls.",
        },
      ],
    },
    {
      kind: "code",
      filename: "routes/calls.ts",
      language: "typescript",
      intro:
        "When dialling outbound, the AMD config is threaded into the provider's dial API call. Each provider has its own parameter name.",
      code: `const amd = resolveAmdConfig(
  (agent.agentConfig ?? {}) as Record<string, unknown>
);

// Twilio dial
await dialTwilio({
  to, from, statusCallbackUrl,
  ...(amd.enabled && {
    machineDetection: amd.twilioMode,
    asyncAmdStatusCallback: statusCallbackUrl,
  }),
});

// Plivo dial
await dialPlivo({
  to, from, answerUrl,
  ...(amd.enabled && { machineDetectionEnabled: true }),
});`,
      lines: [
        {
          lines: "7-10",
          label: "Twilio: machineDetection + asyncAmdStatusCallback",
          explanation:
            "Twilio needs both the `machineDetection` mode and a separate `asyncAmdStatusCallback` URL — the AMD result arrives on a different webhook than the call status. SnapServe routes both to its main webhook handler.",
        },
        {
          lines: "13-16",
          label: "Plivo: machineDetectionEnabled",
          explanation:
            "Plivo uses a simpler boolean. The AMD result comes inline on the answer webhook, not as a separate callback.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "What happens when a machine is detected",
      paragraphs: [
        "When the AMD webhook fires with `AnsweredBy: machine_start` (Twilio) or `machine_detection: voicemail` (Plivo), the webhook handler checks the agent's `voicemailAction` config. There are three choices:",
        "**`hangup`** (default): The pipeline is never started. SnapServe immediately hangs up. The call record is updated to `status: 'voicemail_hangup'`. This is the right choice when your use-case requires a live human.",
        "**`leave_message`**: The pipeline IS started, but in a special `voicemailDelivery` mode. Instead of a normal conversation, the agent waits for the beep and then plays a pre-recorded message. The message is synthesised from the agent's `voicemailMessage` text using the configured TTS provider. After the message plays, the call ends.",
        "**`continue`**: The pipeline starts normally, as if a human answered. The agent speaks its greeting to the voicemail system. Useful for leaving dynamic, personalised messages where you want the LLM to compose something context-aware.",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "The `playVoicemailMessage` method handles the `leave_message` action. It waits for the configured lead-in silence (the beep gap), then plays the TTS-synthesised message.",
      code: `private async playVoicemailMessage(): Promise<void> {
  const vd = this.voicemailDelivery!;

  // Wait for the post-beep silence margin
  const leadIn = vd.postSilenceMarginMs ?? VOICEMAIL_DEFAULT_LEAD_IN_MS;
  await sleep(leadIn);

  if (this.closed) return;

  const message = await this.tts.synthesize(vd.message);
  this.pushAudio(message);

  // Wait for the message to finish playing, then hang up
  const maxWait = vd.maxWaitMs ?? VOICEMAIL_DEFAULT_MAX_WAIT_MS;
  await sleep(Math.max(maxWait, message.length / 8)); // 8 kHz = 8 bytes/ms
  this.config.onCallEnd();
}`,
      lines: [
        {
          lines: "5-6",
          label: "postSilenceMarginMs",
          explanation:
            "After `DetectMessageEnd` fires, there's still a short gap before recording starts on the voicemail system. The lead-in wait (default ~800 ms) ensures the agent doesn't start speaking before the beep finishes echoing.",
        },
        {
          lines: "10-11",
          label: "synthesize then push",
          explanation:
            "The voicemail message is synthesised fresh each time using the TTS adapter, so it can include dynamic content like the caller's name or a callback number. The result is pushed as audio frames to the telephony provider.",
        },
        {
          lines: "14-15",
          label: "duration estimate",
          explanation:
            "8 kHz audio = 8 bytes per millisecond (8-bit μ-law). Dividing the buffer length by 8 gives a rough duration estimate. The pipeline waits at least that long before hanging up so the message doesn't get cut off.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "Detecting AMD status in the webhook",
      body: [
        "SnapServe's webhook handler (`routes/webhooks.ts`) checks for the AMD result in multiple places on the incoming webhook payload — Twilio puts it in `AnsweredBy`, Plivo in `machine_detection`, and VoBiz fires a `voicemail_detected` event. The handler normalises all three into a single code path that looks up the pending call record and decides what to do.",
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "What does `DetectMessageEnd` mode do differently from `Enable` mode?",
          choices: [
            "It detects machines faster by using more audio analysis",
            "It waits until the voicemail greeting finishes before firing the result",
            "It records the voicemail greeting for later playback",
            "It's only available on VoBiz, not Twilio",
          ],
          correctIndex: 1,
          explanation:
            "`DetectMessageEnd` waits for the voicemail message to finish (and the beep to sound) before firing the AMD webhook. This is what you need for `leave_message` mode — you can't leave a message until the greeting is done.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "AMD runs on the telephony provider (Twilio/Plivo/VoBiz), not in SnapServe's code",
        "`resolveAmdConfig` normalises two different UI config shapes into one canonical object",
        "Three voicemail actions: `hangup` (skip), `leave_message` (play TTS), `continue` (treat as human)",
        "`DetectMessageEnd` waits for the beep before firing — required for leaving a message",
        "AMD adds 3-5 seconds of latency on human-answered calls; it's opt-in",
      ],
    },
  ],
};
