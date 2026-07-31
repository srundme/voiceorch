import type { Chapter } from "../types";

export const azureSttComplete: Chapter = {
  slug: "d1-azure-stt-complete",
  moduleId: "d1",
  number: "17.3",
  title: "The Azure STT Adapter, Top to Bottom",
  summary:
    "Azure's framed WebSocket protocol: X-RequestId on every frame, locale normalisation, tunable endpointing silence, confidence flooring, and quick-close auth detection.",
  estMinutes: 24,
  fileRef: "artifacts/api-server/src/orchestration/adapters/stt/azure.ts",
  prerequisites: ["d1-stt-pipeline-path", "stt-adapters"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "Azure Cognitive Services Speech is Microsoft's STT. It is the most **protocol-heavy** adapter in the stack: every message — text or binary — must carry a special header called `X-RequestId`, and audio chunks are wrapped in a hand-built binary frame. Get the framing wrong and Azure hangs up immediately.",
        "In return Azure gives us fine control: we can set the exact **endpointing silence** (how long it waits after the last word before finalising), pass a **phrase list** of key terms, and read a per-phrase confidence score. This chapter walks the file top to bottom.",
        "We skip only the import lines. Everything else — the frame builders, locale normalisation, the constructor, both handlers, and teardown — is quoted from the real file.",
      ],
    },
    {
      kind: "concept",
      title: "Azure speaks in 'frames' with headers",
      body: [
        "Most vendors let you send plain audio. Azure does not. Every message is a **frame** with an HTTP-like header block. Text frames (config, context) are strings with `Path:`, `X-RequestId:`, `X-Timestamp:` and `Content-Type:` lines. Audio frames are binary: a 2-byte length, then the header string, then the raw PCM.",
        "The critical rule, in the very first comment of the file: **every message must include `X-RequestId`**, and all frames in one connection share the same UUID. Omit it and Azure closes with code 1002. On reconnect a fresh UUID is minted.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/azure.ts",
      language: "typescript",
      intro:
        "The protocol note at the top of the file. Read it before the code — it explains the framing.",
      code: `// Every message TO Azure (text or binary) MUST include X-RequestId.
// Use a single UUID per streaming session — all frames within one connection
// share the same requestId.  Omitting X-RequestId causes a 1002 close.
//
// Text messages (speech.config, speech.context):
//   "Path: <path>\\r\\nX-RequestId: <uuid>\\r\\nX-Timestamp: <iso>\\r\\nContent-Type: application/json; charset=utf-8\\r\\n\\r\\n<json>"
//
// Binary messages (audio chunks):
//   [2-byte big-endian header length][header string bytes][raw PCM bytes]
//   Header string: "Path: audio\\r\\nX-RequestId: <uuid>\\r\\n..."`,
      lines: [
        {
          lines: "1-3",
          label: "X-RequestId is mandatory",
          explanation:
            "The single most important Azure rule. One UUID per connection, on every frame. Forget it on even one frame and Azure closes with 1002 — a silent, confusing failure.",
        },
        {
          lines: "5-6",
          label: "text frame shape",
          explanation:
            "Config and context are text frames: header lines separated by CRLF, a blank line, then the JSON body. Just like an HTTP message.",
        },
        {
          lines: "8-10",
          label: "binary frame shape",
          explanation:
            "Audio frames are binary: a 2-byte big-endian length prefix telling Azure how long the header is, the header bytes, then the raw PCM samples appended.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/azure.ts",
      language: "typescript",
      intro:
        "The two frame builders. textFrame for config/context, audioFrame for PCM.",
      code: `function textFrame(path: string, body: string, requestId: string): string {
  return (
    \`Path: \${path}\\r\\n\` +
    \`X-RequestId: \${requestId}\\r\\n\` +
    \`X-Timestamp: \${new Date().toISOString()}\\r\\n\` +
    \`Content-Type: application/json; charset=utf-8\\r\\n\` +
    \`\\r\\n\${body}\`
  );
}

function audioFrame(pcm: Buffer, requestId: string): Buffer {
  const hdr = Buffer.from(
    \`Path: audio\\r\\n\` +
    \`X-RequestId: \${requestId}\\r\\n\` +
    \`X-Timestamp: \${new Date().toISOString()}\\r\\n\` +
    \`Content-Type: audio/x-raw;format=PCM;bit=16;channels=1;samplerate=16000\\r\\n\`,
    "utf8",
  );
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16BE(hdr.length, 0);
  return Buffer.concat([lenBuf, hdr, pcm]);
}`,
      lines: [
        {
          lines: "1-9",
          label: "textFrame",
          explanation:
            "Assembles a text frame with the four required headers and the JSON body after the blank line. Notice `X-RequestId` is always present — that's the rule enforced in code.",
        },
        {
          lines: "16",
          label: "audio format header",
          explanation:
            "The audio frame declares 16-bit PCM, mono, 16 kHz. This must match exactly what the pipeline sends (the 16 kHz path, not Sarvam's 8 kHz).",
        },
        {
          lines: "19-21",
          label: "the 2-byte length prefix",
          explanation:
            "`writeUInt16BE` writes the header length as a big-endian 16-bit integer, then everything is concatenated: length + header + PCM. This is the binary framing Azure decodes.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/azure.ts",
      language: "typescript",
      intro:
        "parseFrame reads the Path header off incoming text frames so we know which event type arrived.",
      code: `function parseFrame(raw: string): { path: string; body: string } | null {
  const sep = raw.indexOf("\\r\\n\\r\\n");
  if (sep === -1) return null;
  const headers = raw.slice(0, sep);
  const body = raw.slice(sep + 4);
  const m = headers.match(/Path:\\s*(\\S+)/i);
  return m ? { path: m[1]!.toLowerCase(), body } : null;
}`,
      lines: [
        {
          lines: "2-5",
          label: "split headers from body",
          explanation:
            "Find the blank line (`\\r\\n\\r\\n`), everything before is headers, everything after is the JSON body.",
        },
        {
          lines: "6-7",
          label: "extract the Path",
          explanation:
            "The `Path:` header names the event — `speech.hypothesis`, `speech.phrase`, `turn.end`, etc. Lower-cased so the handler can switch on it cleanly.",
        },
      ],
    },
    {
      kind: "concept",
      title: "Azure needs full locale tags",
      body: [
        "Azure's STT endpoint wants full IETF locale tags like `hi-IN`, not bare codes like `hi`. Worse, users sometimes paste model-style suffixes (`en-IN-standard`, `ta-IN-neural`) into the language field. Those extra segments make Azure reject the locale, producing empty transcripts and a stuck 'Listening…' state.",
        "So the adapter canonicalises to exactly two segments (`ll-RR`) and, for bare codes, looks them up in a locale map.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/azure.ts",
      language: "typescript",
      intro:
        "normalizeLocale defends against bare codes and stray suffixes.",
      code: `function normalizeLocale(lang: string): string {
  if (!lang) return "en-IN";
  const parts = lang.split("-");
  const canonical = parts.length >= 2 ? \`\${parts[0]!}-\${parts[1]!}\` : lang;
  if (canonical.includes("-")) return canonical;
  return LOCALE_MAP[canonical.toLowerCase()] ?? \`\${canonical}-\${canonical.toUpperCase()}\`;
}`,
      lines: [
        {
          lines: "3-4",
          label: "keep only two segments",
          explanation:
            "`en-IN-standard` becomes `en-IN`. Extra segments are Azure model labels, not locale identifiers, and Azure rejects them — the fix that unsticks the 'Listening…' hang.",
        },
        {
          lines: "5-6",
          label: "expand a bare code",
          explanation:
            "If only `hi` was given, look it up in `LOCALE_MAP` (→ `hi-IN`). As a last resort, uppercase the code as its own region (`xx-XX`).",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/azure.ts",
      language: "typescript",
      intro:
        "The constructor. Note how the endpointing silence and the custom-model GUID are resolved.",
      code: `    this.region = extra.region ?? "eastus";
    const rawLang = cfg.language ?? extra.language ?? "en-IN";
    this.language = normalizeLocale(rawLang);

    const guidModel = model && GUID_RE.test(model.trim()) ? model.trim() : null;
    this.endpointId = extra.endpointId ?? guidModel ?? null;

    // Clamp to Azure's accepted range [100, 5000].
    // STTConfig.endpointingSilenceMs (from agent UI) takes priority over extraConfig.
    const raw = cfg.endpointingSilenceMs ?? extra.endpointingSilenceMs ?? 100;
    this.endpointingSilenceMs = Math.max(50, Math.min(5000, raw));`,
      lines: [
        {
          lines: "1",
          label: "region defaults to eastus",
          explanation:
            "The region is part of the WebSocket host. A wrong region is one of the most common Azure auth-style failures.",
        },
        {
          lines: "5-6",
          label: "only a real GUID selects a custom model",
          explanation:
            "On this endpoint the `model` param is a custom-deployment GUID, not a base-model label. `GUID_RE` gates it — base-model labels from the picker are ignored, and Azure auto-selects the base model from the language.",
        },
        {
          lines: "8-11",
          label: "endpointing silence, clamped",
          explanation:
            "How long Azure waits after the last word before finalising. The agent-UI value wins over extraConfig, clamped to [50, 5000] ms. Lower = snappier but risks splitting sentences; higher = safer for speakers who pause. This is THE endpointing lever for Azure.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/azure.ts",
      language: "typescript",
      intro:
        "On open, the adapter sends speech.config, then speech.context (which carries the endpointing silence and phrase list), then flushes queued audio.",
      code: `      ws.on("open", () => {
        wsReady = true;
        reconnectAttempts = 0;
        socketOpenedAt = Date.now();

        ws.send(textFrame("speech.config", JSON.stringify({ /* system/os/device info */ }), requestId));

        {
          const ctx: Record<string, unknown> = {
            phraseDetection: {
              onInterim: { resultType: "Always" },
              onSuccess: { resultType: "Always" },
              mode: "Conversation",
              segmentation: {
                mode: "Custom",
                segmentationSilenceTimeoutMs: this.endpointingSilenceMs,
              },
            },
          };
          if (this.cfg.keyterms.length > 0) {
            ctx["phraseList"] = {
              onRecognition: { enabled: true, phrases: this.cfg.keyterms },
            };
          }
          ws.send(textFrame("speech.context", JSON.stringify(ctx), requestId));
        }

        for (const chunk of audioQueue.splice(0)) {
          ws.send(audioFrame(chunk, requestId));
        }
      });`,
      lines: [
        {
          lines: "6",
          label: "① speech.config",
          explanation:
            "Declares client system info to Azure. Sent first, always with the connection's `requestId`.",
        },
        {
          lines: "8-18",
          label: "② speech.context — endpointing",
          explanation:
            "`segmentationSilenceTimeoutMs` is where the constructor's `endpointingSilenceMs` actually reaches Azure. `Custom` mode lets us override Azure's ~500 ms default. This is the exact knob for 'endpointing too fast/slow' on Azure.",
        },
        {
          lines: "19-23",
          label: "phrase list = keyterms",
          explanation:
            "If the agent has key terms configured, they are sent as a phrase list to bias recognition toward brand names, product names, etc. — Azure's answer to Deepgram keywords.",
        },
        {
          lines: "27-29",
          label: "③ flush queued audio",
          explanation:
            "Audio that arrived before the socket opened was buffered; now it is replayed as audio frames so no first words are lost to connection lag.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/azure.ts",
      language: "typescript",
      intro:
        "The message handler dispatches on the parsed Path. First, interim hypotheses.",
      code: `      ws.on("message", (raw: Buffer | string, isBinary: boolean) => {
        if (isBinary) return;
        const parsed = parseFrame(raw.toString());
        if (!parsed) return;
        const { path, body } = parsed;

        if (path === "speech.hypothesis") {
          try {
            const msg = JSON.parse(body) as AzureHypothesisBody;
            const text = msg.Text?.trim();
            if (text) {
              lastPartialAt = Date.now();
              onTranscript(text, false);
            }
          } catch {
            // malformed JSON — ignore
          }
          return;
        }`,
      lines: [
        {
          lines: "2",
          label: "skip binary replies",
          explanation:
            "Azure only sends transcript events as text frames, so binary frames are ignored outright.",
        },
        {
          lines: "7-13",
          label: "speech.hypothesis = interim",
          explanation:
            "A hypothesis is a live, still-changing guess. It is emitted with `isFinal = false`, and `lastPartialAt` is stamped for latency measurement. The pipeline uses interims for barge-in, not for the LLM.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/azure.ts",
      language: "typescript",
      intro:
        "The final phrase branch, including the confidence floor for Indic languages.",
      code: `        if (path === "speech.phrase") {
          try {
            const msg = JSON.parse(body) as AzurePhraseBody;
            if (msg.RecognitionStatus !== "Success") {
              return;
            }
            const best = msg.NBest?.[0];
            const text = (best?.Display ?? msg.DisplayText ?? "").trim();
            if (!text) return;

            const confidence = best?.Confidence ?? 1;
            const effectiveThreshold = Math.min(this.cfg.confidenceThreshold, 0.15);
            if (confidence < effectiveThreshold) {
              logger.info({ confidence, effectiveThreshold }, "Azure stream: transcript filtered by confidence");
              return;
            }
            const now = Date.now();
            const meta: SttFinalMetadata = {
              endDetectToFinalMs: speechEndDetectedAt > 0 ? now - speechEndDetectedAt : undefined,
              lastPartialToFinalMs: lastPartialAt > 0 ? now - lastPartialAt : undefined,
            };
            onTranscript(text, true, undefined, meta);
          } catch {
          }
          return;
        }`,
      lines: [
        {
          lines: "4-6",
          label: "only Success emits",
          explanation:
            "`InitialSilenceTimeout`, `NoMatch`, etc. are dropped. Only a `Success` status carries a real transcript.",
        },
        {
          lines: "11-15",
          label: "the confidence FLOOR (not a gate)",
          explanation:
            "A subtle, important line: `Math.min(configured, 0.15)` means the effective threshold is capped at 0.15. Azure's streaming confidence for Indic languages runs naturally low, so a high configured threshold would wrongly discard good Tamil/Hindi speech. The floor keeps that from happening.",
        },
        {
          lines: "17-22",
          label: "latency metadata + final emit",
          explanation:
            "It records how long from `speech.enddetected` to final and from last partial to final, then emits with `isFinal = true`. Those numbers land in the call log.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/azure.ts",
      language: "typescript",
      intro:
        "The remaining events are lifecycle-only. speech.enddetected is stamped for latency.",
      code: `        if (path === "turn.end") {
          logger.debug({ region: this.region }, "Azure STT: turn.end");
          return;
        }
        if (path === "turn.start") {
          logger.debug({ region: this.region }, "Azure STT: turn.start");
          return;
        }
        if (path === "speech.enddetected") {
          speechEndDetectedAt = Date.now();
          logger.debug({ region: this.region }, "Azure STT: speech.enddetected");
          return;
        }`,
      lines: [
        {
          lines: "1-4",
          label: "turn.end — no reconnect needed",
          explanation:
            "After a turn ends the socket stays open; the next audio chunk starts a new turn automatically. Unlike some vendors, Azure does not require a fresh connection per turn.",
        },
        {
          lines: "9-11",
          label: "speech.enddetected — the endpointing moment",
          explanation:
            "This is Azure announcing it detected end-of-speech. Stamping `speechEndDetectedAt` lets the final-phrase branch measure end-detect-to-final latency.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/azure.ts",
      language: "typescript",
      intro:
        "The close handler distinguishes a genuine network drop from an auth/region misconfiguration using the socket's lifespan.",
      code: `      ws.on("close", (code: number, reason: Buffer) => {
        wsReady = false;
        const livedMs = socketOpenedAt > 0 ? Date.now() - socketOpenedAt : -1;
        if (intentionallyClosed) {
          onClose?.();
          return;
        }
        const isQuickClose = socketOpenedAt === 0 || livedMs < QUICK_CLOSE_MS;
        if (isQuickClose && reconnectAttempts >= 1) {
          logger.error({ code, livedMs, region: this.region },
            "Azure STT: repeated quick-close — likely auth/region error; not retrying");
          onClose?.();
          return;
        }
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 8_000);
          reconnectAttempts++;
          setTimeout(openSocket, delay);
        } else {
          onClose?.();
        }
      });`,
      lines: [
        {
          lines: "3",
          label: "measure how long the socket lived",
          explanation:
            "`livedMs` is the key signal. A socket that dies almost immediately after opening is diagnostic.",
        },
        {
          lines: "8-13",
          label: "quick-close = auth/region error",
          explanation:
            "If the socket lived under `QUICK_CLOSE_MS` (2 s) or never opened, it is almost certainly a wrong key or region — retrying wastes time and delays the pipeline's fallback. After one quick-close, give up. This is why `MAX_RECONNECT_ATTEMPTS` is only 3 for Azure.",
        },
        {
          lines: "14-17",
          label: "genuine drop → backoff reconnect",
          explanation:
            "A socket that lived a while before closing is a real network drop; reconnect with exponential backoff up to ~8 s. Azure also closes after ~10 min idle, which this recovers silently.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/orchestration/adapters/stt/azure.ts",
      language: "typescript",
      intro:
        "The returned StreamSTT handle: sendAudio wraps each chunk in an audioFrame, close tears down cleanly.",
      code: `    return {
      sendAudio(chunk: Buffer): void {
        if (wsReady && ws.readyState === WebSocket.OPEN) {
          ws.send(audioFrame(chunk, currentRequestId));
        } else {
          audioQueue.push(chunk);
        }
      },

      close(): void {
        intentionallyClosed = true;
        if (ws.readyState < WebSocket.CLOSING) ws.close();
      },
    };`,
      lines: [
        {
          lines: "2-7",
          label: "sendAudio → audioFrame",
          explanation:
            "Every chunk is wrapped with the current connection's `currentRequestId` and sent as a binary frame. If the socket isn't ready (connecting or reconnecting), the chunk is queued and replayed on open.",
        },
        {
          lines: "10-12",
          label: "close",
          explanation:
            "Set `intentionallyClosed` so the close handler does NOT reconnect, then close the socket if it isn't already closing. Clean teardown at call end.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "Azure vs Sarvam: continuous LID",
      body: [
        "Azure runs continuous language identification within a session — it can report the recognised `Language` per phrase in the NBest result. Combined with the phrase-list biasing, this makes Azure a strong choice for mixed-language enterprise calls where brand names must be spelled right.",
        "But Azure has no built-in coalescing like Sarvam's. Turn-taking is governed purely by `segmentationSilenceTimeoutMs`. If Azure feels too eager or too slow, that one number is the lever.",
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "What happens if an Azure frame is sent without X-RequestId?",
          choices: [
            "Azure ignores that frame silently.",
            "Azure closes the connection with code 1002.",
            "Azure switches to batch mode.",
            "The transcript arrives with lower confidence.",
          ],
          correctIndex: 1,
          explanation:
            "The file's opening comment is explicit: omitting X-RequestId causes a 1002 close. One UUID per connection must ride on every text and binary frame.",
        },
        {
          prompt: "Why does the streaming confidence filter use Math.min(configured, 0.15)?",
          choices: [
            "To make the filter stricter for English.",
            "Azure's streaming confidence for Indic languages is naturally low, so capping the effective threshold at 0.15 prevents good Tamil/Hindi speech from being discarded.",
            "0.15 is Azure's maximum possible confidence.",
            "It disables the confidence filter entirely.",
          ],
          correctIndex: 1,
          explanation:
            "It's a floor, not a gate: even a high configured threshold is capped at 0.15 in streaming mode because Indic-language confidence runs lower than Latin-script.",
        },
        {
          prompt: "An Azure socket dies within 500 ms of opening, twice. What does the adapter conclude?",
          choices: [
            "The network is congested; keep retrying up to 10 times.",
            "It's a quick-close — almost certainly a wrong key or region — so it stops retrying and surfaces onClose instead of delaying the fallback.",
            "The caller hung up.",
            "The endpointing silence is too short.",
          ],
          correctIndex: 1,
          explanation:
            "livedMs < QUICK_CLOSE_MS (2 s) with reconnectAttempts >= 1 is treated as auth/region misconfiguration; retrying wouldn't help and would delay the pipeline fallback.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Azure uses a framed protocol: text frames (config/context) and binary audio frames, each with a mandatory `X-RequestId` (one UUID per connection).",
        "`normalizeLocale` forces full `ll-RR` tags and strips model-style suffixes that would otherwise stick the recognizer in 'Listening…'.",
        "`segmentationSilenceTimeoutMs` (from `endpointingSilenceMs`, clamped 50-5000) is the single endpointing lever — lower is snappier, higher is safer for pausers.",
        "Key terms are passed as an Azure phrase list to bias recognition toward brand/product names.",
        "Streaming confidence is floored at 0.15 so naturally-low Indic-language confidence doesn't discard valid speech.",
        "The close handler uses socket lifespan: a quick-close (<2 s) signals an auth/region error and stops retrying; genuine drops reconnect with backoff (max 3 attempts).",
      ],
    },
  ],
};
