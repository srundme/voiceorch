import { useState, useMemo } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { BookMarked, Search, ChevronRight } from "lucide-react";

interface Term {
  term: string;
  definition: string;
  relatedChapter?: string;
  relatedChapterTitle?: string;
}

const GLOSSARY: Term[] = [
  { term: "ASR", definition: "Automatic Speech Recognition — the technology that converts spoken audio into text. Also called STT (Speech-to-Text). In SnapServe, the supported ASR providers are Deepgram, Azure, Whisper, and Sarvam (saarika).", relatedChapter: "stt-adapters", relatedChapterTitle: "STT Adapters" },
  { term: "Advisory Lock", definition: "A PostgreSQL-native distributed lock: `pg_try_advisory_xact_lock(integer)`. Acquired inside a transaction, released automatically at commit/rollback. SnapServe uses it to prevent two server instances from processing the same job (callback, retry, slot booking) simultaneously.", relatedChapter: "reliability-patterns", relatedChapterTitle: "Reliability Patterns" },
  { term: "Agent", definition: "The core SnapServe entity: a configured voice pipeline. An agent has a name, a persona (system prompt), a telephony provider (the phone number it listens on), and ASR/LLM/TTS provider settings. Stored in the `agents` table.", relatedChapter: "agent-builder", relatedChapterTitle: "Agent Builder" },
  { term: "AMD", definition: "Answering Machine Detection — a feature that detects whether an outbound call was answered by a human or a voicemail machine. SnapServe supports AMD on both Twilio and Plivo. When a voicemail is detected, the agent can play a pre-recorded message and hang up.", relatedChapter: "amd-voicemail", relatedChapterTitle: "AMD & Voicemail" },
  { term: "Ambient Audio", definition: "Background music or soundscape played continuously during a call to fill silence between turns. Stored as a PCM buffer and mixed with the TTS audio before sending to the telephony provider. Must have no zero-frame gaps to survive carrier DTX (Discontinuous Transmission).", relatedChapter: "session-and-pipeline", relatedChapterTitle: "Session & Pipeline" },
  { term: "Barge-in", definition: "The ability for a caller to interrupt the agent mid-speech. SnapServe detects barge-in via VAD (Silero) while audio is playing. An echo-grace window prevents the agent's own TTS audio from being misdetected as a barge-in.", relatedChapter: "barge-in-and-echo", relatedChapterTitle: "Barge-in & Echo" },
  { term: "BYOP", definition: "Bring Your Own Providers — the billing mode where a user has configured their own ASR/LLM/TTS/telephony API keys. Billed at $0.035/min (orchestration fee only). Activated automatically when matching keys are found in the `providers` table for the agent's providers.", relatedChapter: "billing-modes", relatedChapterTitle: "Billing Modes" },
  { term: "Callout Block", definition: "A content block type in the SnapServe Book's chapter format. Variants: `why`, `tip`, `warning`, `gotcha`, `insight`. Renders as a highlighted aside with a coloured icon." },
  { term: "Campaign", definition: "An outbound calling campaign: a batch of leads dialled sequentially by SnapServe. Each campaign has a CSV of phone numbers, an agent, a schedule, and retry settings. Stored in `campaigns`, `campaign_batches`, and `campaign_leads` tables.", relatedChapter: "campaigns", relatedChapterTitle: "Campaigns" },
  { term: "Canonical Phone Number", definition: "The normalised form of a phone number used as the key for caller memory: `canonicalizeCallerKey(phone, defaultCC, nationalLen)`. For India, CC=91, nationalLen=10. A +91-prefix number, a 0-prefix trunk number, and a bare 10-digit number all canonicalise to the same string.", relatedChapter: "caller-memory", relatedChapterTitle: "Caller Memory" },
  { term: "Cartesia", definition: "A TTS provider known for ultra-low latency (first chunk in ~80ms) and high-quality voices. Supported as a TTS adapter in SnapServe. Ideal for agents where response speed is critical.", relatedChapter: "tts-adapters", relatedChapterTitle: "TTS Adapters" },
  { term: "Clerk ID", definition: "A legacy column name in the `users` table: `users.clerk_id`. Despite the name, it now stores the Google OAuth `sub` (not a Clerk user ID). The rename was skipped to avoid updating ~20 files that reference `req.clerkUserId`.", relatedChapter: "google-oauth-sessions", relatedChapterTitle: "Google OAuth & Sessions" },
  { term: "Connections Block", definition: "A content block type in the SnapServe Book that renders a clickable 'How it connects' diagram. Each node can link to a related chapter. Used to show data flow between files/components." },
  { term: "Continuous LID", definition: "Azure's Continuous Language Identification — a mode where the STT engine re-evaluates the language on every utterance. Enables mid-call language switching (e.g. Tamil → English → Tamil). Requires explicit `mode: 'Continuous'` in the `speech.context` message.", relatedChapter: "language-detection", relatedChapterTitle: "Language Detection" },
  { term: "Deepgram", definition: "A real-time STT provider. SnapServe's Deepgram adapter uses the Nova-2 model over WebSocket. Deepgram's streaming protocol accepts raw LINEAR16 PCM bytes — no WAV header needed.", relatedChapter: "stt-adapters", relatedChapterTitle: "STT Adapters" },
  { term: "Drizzle ORM", definition: "The TypeScript ORM used by SnapServe for all database access. Drizzle is type-safe, uses a SQL-like builder API, and generates migration files via `drizzle-kit`. Schema definitions live in `lib/db/src/schema/`.", relatedChapter: "drizzle-intro", relatedChapterTitle: "Drizzle Intro" },
  { term: "DTX", definition: "Discontinuous Transmission — a carrier-level optimisation where silence frames are suppressed to save bandwidth. DTX breaks ambient audio in telephony because zero-frame gaps cause the audio decoder to mute. Fixed by ensuring continuous non-zero audio.", relatedChapter: "session-and-pipeline", relatedChapterTitle: "Session & Pipeline" },
  { term: "ECAPA-TDNN", definition: "A speaker recognition deep learning model (End-to-End Convolutional Attentive Neural Network). SnapServe runs it in the Python gender-service sidecar to generate voice embeddings for speaker verification.", relatedChapter: "speaker-recognition", relatedChapterTitle: "Speaker Recognition" },
  { term: "Endpointing", definition: "The process of detecting when a caller has finished speaking. SnapServe uses a combination of STT provider signals (final transcript), VAD (Silero), and a force-finalize timer to decide when to trigger the LLM turn.", relatedChapter: "endpointing", relatedChapterTitle: "Endpointing" },
  { term: "Exchange Code", definition: "A single-use, short-lived (5-minute) hex string that enables admin impersonation. An admin generates it via `POST /api/admin/impersonate/:clerkId`; the support engineer visits the dashboard with `?impersonate=<code>` to receive a full user session JWT.", relatedChapter: "admin-auth-impersonation", relatedChapterTitle: "Admin Auth & Impersonation" },
  { term: "Execution Log", definition: "A structured event written to the `call_execution_logs` Postgres table during a live call. Events include: `call_started`, `stt_partial`, `stt_final`, `llm_start`, `llm_first_token`, `tts_done`, `tool_call`, `call_ended`. Visible in the dashboard Call Detail page.", relatedChapter: "reading-call-logs", relatedChapterTitle: "Reading Call Logs" },
  { term: "Fallback Chain", definition: "A sequence of LLM or TTS providers tried in order. If the primary provider fails on the first token of the first turn (`llmFirstTokenAt === null`), the fallback LLM is used for the rest of the call. Prevents a single provider outage from dropping a live call.", relatedChapter: "fallback-chains", relatedChapterTitle: "Fallback Chains" },
  { term: "Force-Finalize", definition: "A safety-net timer (`FORCE_FINALIZE_MS`, default 1800ms) that fires when the STT provider sends partials but never a final transcript. After the timeout, the best partial is promoted to a final and the LLM turn starts. Guards the 'Listening…' hang on Sarvam and some Azure configs.", relatedChapter: "turn-safety-net", relatedChapterTitle: "Turn Safety Net" },
  { term: "Gender Detection", definition: "Real-time audio analysis to determine whether a caller is male or female. SnapServe uses a fallback chain: wav2vec2 → autocorrelation → pitch analysis. The result is used to personalise salutations (Sir/Ma'am) in the LLM prompt.", relatedChapter: "gender-detection", relatedChapterTitle: "Gender Detection" },
  { term: "Google Sub", definition: "Google's stable, unique user identifier — the `sub` field in a Google OAuth ID token. A 21-digit numeric string like `106123456789012345678`. Stored in `users.clerk_id` (legacy column name). The primary key for user identity in SnapServe's auth system.", relatedChapter: "google-oauth-sessions", relatedChapterTitle: "Google OAuth & Sessions" },
  { term: "Hangup URL", definition: "A webhook URL embedded in an outbound dial request. The telephony provider POSTs to this URL when the call ends, with the final call status (completed, busy, no-answer, failed). Must specify `hangup_method: 'POST'` on VoBiz — omitting it defaults to GET, causing 404s.", relatedChapter: "webhooks-deep-dive", relatedChapterTitle: "Webhooks In Depth" },
  { term: "HMAC", definition: "Hash-Based Message Authentication Code. SnapServe embeds HMAC-SHA256 signatures in webhook callback URLs (`cbSig`, `campaignLeadSig`) to prevent attackers from forging status webhooks that could trigger arbitrary outbound calls.", relatedChapter: "webhooks-deep-dive", relatedChapterTitle: "Webhooks In Depth" },
  { term: "HTTP Keep-Alive Pool", definition: "A pool of persistent TCP connections to provider APIs, managed by a single `undici.Agent` set as the global dispatcher via `setGlobalDispatcher`. Eliminates TCP+TLS handshake overhead on every LLM/TTS/STT REST call. Default keepalive timeout: 30 seconds.", relatedChapter: "http-keepalive-pool", relatedChapterTitle: "HTTP Keep-Alive Pool" },
  { term: "JWT", definition: "JSON Web Token. SnapServe uses HS256 JWTs signed with `SESSION_SECRET` as session tokens. Payload: `{ sub: googleSub, email, name, exp }`. Delivered via URL fragment (#session=...) after OAuth login. Stored in `localStorage['voiceorch:session']`.", relatedChapter: "google-oauth-sessions", relatedChapterTitle: "Google OAuth & Sessions" },
  { term: "LLM", definition: "Large Language Model — the AI model that generates the agent's spoken responses and decides when to invoke tools. SnapServe supports OpenAI, DeepSeek, Anthropic, Mistral, Cohere, Groq, and Sarvam via the OpenAI-compatible API.", relatedChapter: "llm-adapters", relatedChapterTitle: "LLM Adapters" },
  { term: "Managed Plan", definition: "The default billing mode: SnapServe supplies all provider keys (LLM/ASR/TTS). Billed at $0.05/min. Active when the user has NOT configured any BYOP keys for the agent's providers.", relatedChapter: "billing-modes", relatedChapterTitle: "Billing Modes" },
  { term: "Orval", definition: "The code generator that reads the OpenAPI spec (`lib/api-spec/openapi.yaml`) and produces React Query hooks (`lib/api-client-react/src/generated/`) and Zod validation schemas (`lib/api-zod/src/generated/`). Run with `pnpm --filter @workspace/api-spec run codegen`.", relatedChapter: "contract-first-openapi", relatedChapterTitle: "Contract-First OpenAPI" },
  { term: "Pipeline", definition: "The `Pipeline` class in `orchestration/pipeline.ts` — the real-time conversation manager for a single call. It drives the turn loop: audio in → VAD → STT → LLM → TTS → audio out. Created once per call, discarded when the call ends.", relatedChapter: "session-and-pipeline", relatedChapterTitle: "Session & Pipeline" },
  { term: "Platform Settings", definition: "A key-value store in the `platform_settings` Postgres table for operator-managed configuration: managed provider API keys, rate-limit counters, feature flags. Admin-editable via the admin panel. Transient keys must be registered with `registerTransientKey` for auto-cleanup." },
  { term: "Plivo", definition: "A telephony provider supported by SnapServe for inbound and outbound calls. Similar WebSocket protocol to Twilio but different XML verbs and webhook shapes. Uses `hangup_method: 'POST'` explicitly like VoBiz.", relatedChapter: "vobiz-and-plivo", relatedChapterTitle: "VoBiz & Plivo" },
  { term: "Retry Engine", definition: "The `retryEngine.ts` service that persists failed outbound call attempts in a `retry_jobs` Postgres table and re-fires them after a configurable delay. Used by both campaign calls and scheduled callbacks for busy/no-answer outcomes.", relatedChapter: "retry-engine", relatedChapterTitle: "Retry Engine" },
  { term: "Sarvam", definition: "An Indian AI company providing STT (saarika), TTS (bulbul), and LLM (sarvam-m1) APIs optimised for Indian languages. Key quirks: bulbul:v1 is retired; STT requires WAV-wrapped base64 audio; LLM streaming drops tool_calls.", relatedChapter: "sarvam-deep-dive", relatedChapterTitle: "Sarvam Deep Dive" },
  { term: "Scheduled Callback", definition: "A row in the `scheduled_callbacks` table that causes the callback poller to fire an outbound call at a specific future time. Created either by the `schedule_callback` LLM tool (caller-requested) or by `scheduleNoAnswerRedial` (auto-redial for missed calls).", relatedChapter: "callback-scheduling", relatedChapterTitle: "Callback Scheduling" },
  { term: "Session", definition: "A live call session tracked in the `sessions` in-memory Map in `session.ts`. Each session has a unique `sessionId`, holds the `Pipeline` instance, and is removed from the Map when `endSession()` completes. Not persisted to the database.", relatedChapter: "session-and-pipeline", relatedChapterTitle: "Session & Pipeline" },
  { term: "SESSION_SECRET", definition: "The symmetric key used to sign all user session JWTs (HS256). Must be a minimum 32-byte random string. Stored as a Railway environment variable. Rotating it immediately invalidates all existing user sessions.", relatedChapter: "google-oauth-sessions", relatedChapterTitle: "Google OAuth & Sessions" },
  { term: "Silero VAD", definition: "A lightweight ONNX neural network (Voice Activity Detector) that classifies 30ms audio frames as speech or silence. Used by SnapServe for real-time barge-in detection and endpointing. Runs in Node.js via the `onnxruntime-node` package.", relatedChapter: "silero-vad", relatedChapterTitle: "Silero VAD" },
  { term: "STT", definition: "Speech-to-Text — the technology that converts spoken audio into text. Also called ASR. SnapServe supports Deepgram, Azure, Whisper, and Sarvam (saarika) STT providers.", relatedChapter: "stt-adapters", relatedChapterTitle: "STT Adapters" },
  { term: "Stuck-Call Sweep", definition: "A background sweep in `batchScheduler.ts` that runs every 60 seconds. Finds calls that have been `in_progress` for more than 30 minutes (e.g. due to a recording finalize hang) and force-closes them with `status = 'completed'`.", relatedChapter: "reliability-patterns", relatedChapterTitle: "Reliability Patterns" },
  { term: "TTS", definition: "Text-to-Speech — converts the LLM's text response into spoken audio. SnapServe supports ElevenLabs, OpenAI, AWS Polly, Azure, Cartesia, Deepgram, and Sarvam (bulbul) TTS providers.", relatedChapter: "tts-adapters", relatedChapterTitle: "TTS Adapters" },
  { term: "Telephony", definition: "The infrastructure layer that connects phone calls to SnapServe's WebSocket server. Supported providers: Twilio, Plivo, VoBiz, Vonage. Each provider has a different WebSocket protocol, XML response format, and webhook signature scheme.", relatedChapter: "telephony-overview", relatedChapterTitle: "Telephony Overview" },
  { term: "Transcript", definition: "The accumulated text of everything spoken in a call, stored per-session in `session.pipeline.getTranscript()` and written to `calls.transcript` at call end. Each turn is prefixed with 'Agent:' or 'Caller:'." },
  { term: "Turn", definition: "One exchange in a conversation: the caller speaks (STT), the LLM generates a response (LLM), the agent speaks the response (TTS). The pipeline orchestrates each turn as an atomic unit." },
  { term: "VAD", definition: "Voice Activity Detection — classifying audio frames as speech or silence in real time. SnapServe uses Silero VAD (ONNX model, 30ms frames) for barge-in detection and endpointing reinforcement.", relatedChapter: "silero-vad", relatedChapterTitle: "Silero VAD" },
  { term: "VoBiz", definition: "The primary telephony provider for SnapServe's managed-plan calls in India. Uses a WebSocket protocol similar to Plivo but with JSON events. Key gotcha: must specify `hangup_method: 'POST'` on outbound dials or the hangup URL receives GET requests (which 404, breaking retries).", relatedChapter: "vobiz-and-plivo", relatedChapterTitle: "VoBiz & Plivo" },
  { term: "Wallet", definition: "The prepaid balance system for SnapServe billing. Each user has one wallet row in the `wallets` table. Usage is debited at call-end time. An append-only `wallet_transactions` table provides an immutable audit trail of all debits and credits.", relatedChapter: "wallet-system", relatedChapterTitle: "Wallet System" },
  { term: "WAV", definition: "Waveform Audio File Format. A container for uncompressed PCM audio with a 44-byte RIFF header. Some providers (Sarvam STT) require WAV-wrapped audio; others (Deepgram) accept raw PCM bytes. SnapServe's `wrapInWav()` utility adds the header.", relatedChapter: "audio-ts", relatedChapterTitle: "Audio" },
  { term: "WebSocket", definition: "The bidirectional protocol used for real-time audio streaming between telephony providers and SnapServe, and between SnapServe and streaming STT/TTS providers. Each call opens one WebSocket per active STT/TTS connection." },
  { term: "Zod", definition: "A TypeScript-first schema validation library. SnapServe uses Zod (v4) for validating request bodies in API routes. Zod schemas are auto-generated from the OpenAPI spec by Orval and live in `lib/api-zod/src/generated/`.", relatedChapter: "contract-first-openapi", relatedChapterTitle: "Contract-First OpenAPI" },
];

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export default function Glossary() {
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return GLOSSARY.filter(t => {
      const matchesSearch = !q || t.term.toLowerCase().includes(q) || t.definition.toLowerCase().includes(q);
      const matchesLetter = !activeFilter || t.term.toUpperCase().startsWith(activeFilter);
      return matchesSearch && matchesLetter;
    }).sort((a, b) => a.term.localeCompare(b.term));
  }, [search, activeFilter]);

  const availableLetters = useMemo(
    () => new Set(GLOSSARY.map(t => t.term[0]?.toUpperCase() ?? "")),
    []
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 pt-16 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
        >
          <div className="flex items-center gap-3 mb-2">
            <BookMarked size={28} className="text-primary" />
            <h1 className="text-4xl font-bold font-serif text-foreground">Glossary</h1>
          </div>
          <p className="text-muted-foreground text-lg mb-8">
            {GLOSSARY.length} terms defined — every acronym and concept used in the book.
          </p>

          {/* Search */}
          <div className="relative mb-5">
            <Search
              size={18}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <input
              type="text"
              placeholder="Filter terms…"
              value={search}
              onChange={e => { setSearch(e.target.value); setActiveFilter(null); }}
              className="w-full pl-11 pr-5 py-3 rounded-xl border-2 border-border bg-card text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary transition-colors"
            />
          </div>

          {/* Alphabet strip */}
          <div className="flex flex-wrap gap-1 mb-8">
            {ALPHABET.map(letter => (
              <button
                key={letter}
                onClick={() => setActiveFilter(activeFilter === letter ? null : letter)}
                disabled={!availableLetters.has(letter)}
                className={`w-7 h-7 rounded-lg text-xs font-bold transition-all ${
                  activeFilter === letter
                    ? "bg-primary text-primary-foreground"
                    : availableLetters.has(letter)
                    ? "bg-muted hover:bg-primary/10 text-muted-foreground hover:text-primary"
                    : "opacity-20 text-muted-foreground cursor-not-allowed"
                }`}
              >
                {letter}
              </button>
            ))}
          </div>

          {/* Terms */}
          {filtered.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <BookMarked size={48} className="mx-auto mb-4 opacity-20" />
              <p className="text-lg">No terms matched your filter</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((term, i) => (
                <motion.div
                  key={term.term}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.02, 0.3) }}
                  className="p-5 rounded-2xl border-2 border-border bg-card"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-grow">
                      <h3 className="font-bold text-foreground text-lg mb-1">{term.term}</h3>
                      <p className="text-muted-foreground leading-relaxed">{term.definition}</p>
                    </div>
                    {term.relatedChapter && (
                      <Link
                        href={`/chapter/${term.relatedChapter}`}
                        className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-orange-50 text-primary text-xs font-bold border border-orange-200 hover:bg-orange-100 transition-colors whitespace-nowrap"
                      >
                        {term.relatedChapterTitle}
                        <ChevronRight size={12} />
                      </Link>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
