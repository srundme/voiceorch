/**
 * File Index — maps every meaningful source file in the VoiceOrch repo
 * to a one-line description and (optionally) the Book chapter that covers it.
 *
 * Used by the File Explorer page so interns can look up any file and jump
 * straight to the concept that explains it.
 */

export interface FileEntry {
  path: string;           // path relative to repo root
  description: string;   // one-line: "what does this file do?"
  chapterSlug?: string;  // Book chapter that covers this file
  tags: string[];        // concept tags for filtering
}

export const fileIndex: FileEntry[] = [

  // ─────────────────────────────────────────────────────────────────────────
  // WORKSPACE ROOT
  // ─────────────────────────────────────────────────────────────────────────
  { path: "pnpm-workspace.yaml", description: "Workspace package discovery, catalog version pins, and pnpm overrides", chapterSlug: "codebase-tour", tags: ["workspace", "config"] },
  { path: "tsconfig.base.json", description: "Shared strict TypeScript defaults extended by every package", chapterSlug: "typescript-basics", tags: ["typescript", "config"] },
  { path: "tsconfig.json", description: "Root solution file for composite lib packages — drives tsc --build order", chapterSlug: "typescript-basics", tags: ["typescript", "config"] },

  // ─────────────────────────────────────────────────────────────────────────
  // API SERVER — entry point & config
  // ─────────────────────────────────────────────────────────────────────────
  { path: "artifacts/api-server/src/app.ts", description: "Express app factory — mounts middleware, routes, and error handler", chapterSlug: "express-routing", tags: ["api", "express", "middleware"] },
  { path: "artifacts/api-server/src/index.ts", description: "Server entry point — binds the port, connects DB, starts background schedulers", chapterSlug: "express-routing", tags: ["api", "startup"] },

  // ─────────────────────────────────────────────────────────────────────────
  // API SERVER — middlewares
  // ─────────────────────────────────────────────────────────────────────────
  { path: "artifacts/api-server/src/middlewares/session.ts", description: "Validates the Bearer JWT and sets req.clerkUserId + req.sessionPayload", chapterSlug: "google-oauth-sessions", tags: ["auth", "middleware", "jwt"] },
  { path: "artifacts/api-server/src/middlewares/requireAuth.ts", description: "Guard middleware — 401 if no valid session; used on every user-scoped route", chapterSlug: "google-oauth-sessions", tags: ["auth", "middleware"] },
  { path: "artifacts/api-server/src/middlewares/requireAdmin.ts", description: "Guard middleware — 403 if x-admin-token header is missing or wrong", chapterSlug: "admin-auth-impersonation", tags: ["auth", "admin", "middleware"] },
  { path: "artifacts/api-server/src/middlewares/detectImpersonation.ts", description: "Reads ?impersonate=<code> query param; exchanges for a user session JWT", chapterSlug: "admin-auth-impersonation", tags: ["auth", "admin", "impersonation"] },
  { path: "artifacts/api-server/src/middlewares/userProvisioning.ts", description: "Auto-creates a users row + wallet + welcome credit on first Google login", chapterSlug: "google-oauth-sessions", tags: ["auth", "users", "billing"] },

  // ─────────────────────────────────────────────────────────────────────────
  // API SERVER — lib utilities
  // ─────────────────────────────────────────────────────────────────────────
  { path: "artifacts/api-server/src/lib/session.ts", description: "Signs and verifies HS256 JWTs; SESSION_SECRET is the symmetric key", chapterSlug: "google-oauth-sessions", tags: ["auth", "jwt"] },
  { path: "artifacts/api-server/src/lib/app-domain.ts", description: "Derives the public base URL from APP_DOMAIN env var (falls back to REPLIT_DOMAINS)", chapterSlug: "webhooks-deep-dive", tags: ["config", "utility"] },
  { path: "artifacts/api-server/src/lib/crypto.ts", description: "AES-256-GCM encrypt/decrypt for provider API keys at rest", chapterSlug: "calls-and-providers", tags: ["security", "crypto"] },
  { path: "artifacts/api-server/src/lib/logger.ts", description: "Pino singleton logger used in non-request server code", chapterSlug: "express-routing", tags: ["logging", "utility"] },
  { path: "artifacts/api-server/src/lib/redis.ts", description: "Upstash Redis client (REST-based) used for rate limiting and caching", chapterSlug: "reliability-patterns", tags: ["redis", "infrastructure"] },
  { path: "artifacts/api-server/src/lib/auth-compat.ts", description: "getAuth() shim — reads req.clerkUserId so 20 route files compile unchanged after the Clerk→Google migration", chapterSlug: "google-oauth-sessions", tags: ["auth", "compatibility"] },
  { path: "artifacts/api-server/src/lib/webhook-signature.ts", description: "HMAC-SHA256 signing and verification for callback URLs (cbSig, campaignLeadSig)", chapterSlug: "webhooks-deep-dive", tags: ["security", "webhooks"] },
  { path: "artifacts/api-server/src/lib/phone-normalize.ts", description: "Normalises phone numbers to E.164 canonical form for caller memory keying", chapterSlug: "caller-memory", tags: ["telephony", "utility"] },
  { path: "artifacts/api-server/src/lib/rate-limit.ts", description: "Token-bucket rate limiter backed by Upstash Redis", chapterSlug: "reliability-patterns", tags: ["rate-limiting", "security"] },
  { path: "artifacts/api-server/src/lib/book-exam.ts", description: "Server-graded quiz engine — validates answers, computes score, stores pass/fail", chapterSlug: "contract-first-openapi", tags: ["book", "exam"] },
  { path: "artifacts/api-server/src/lib/oauth-redirect.ts", description: "Constructs the Google OAuth redirect URL with required scopes and state param", chapterSlug: "google-oauth-sessions", tags: ["auth", "oauth"] },
  { path: "artifacts/api-server/src/lib/ffmpeg.ts", description: "Resolves the ffmpeg binary path — ffmpeg-static bundle with apt fallback", chapterSlug: "audio-ts", tags: ["audio", "utility"] },

  // ─────────────────────────────────────────────────────────────────────────
  // API SERVER — routes
  // ─────────────────────────────────────────────────────────────────────────
  { path: "artifacts/api-server/src/routes/index.ts", description: "Mounts all route sub-routers onto /api; the single source of URL truth", chapterSlug: "express-routing", tags: ["api", "routing"] },
  { path: "artifacts/api-server/src/routes/auth.ts", description: "Google OAuth endpoints: /auth/google/connect + /auth/google/callback + /auth/me", chapterSlug: "google-oauth-sessions", tags: ["auth", "oauth"] },
  { path: "artifacts/api-server/src/routes/agents.ts", description: "CRUD for voice agents — create, list, toggle, delete, get by ID", chapterSlug: "agent-builder", tags: ["api", "agents"] },
  { path: "artifacts/api-server/src/routes/calls.ts", description: "Call lifecycle: create, list, end, transcript, call detail; call control WebSocket", chapterSlug: "session-and-pipeline", tags: ["api", "calls", "websocket"] },
  { path: "artifacts/api-server/src/routes/providers.ts", description: "Manage user-supplied API keys: create, list (masked), delete; triggers BYOP billing mode", chapterSlug: "calls-and-providers", tags: ["api", "providers", "billing"] },
  { path: "artifacts/api-server/src/routes/webhooks.ts", description: "VoBiz, Twilio, Plivo status callbacks — maps call outcomes, fires retries/redials", chapterSlug: "webhooks-deep-dive", tags: ["webhooks", "telephony"] },
  { path: "artifacts/api-server/src/routes/analytics.ts", description: "Read-only aggregation endpoints for dashboard charts (call volume, success rate)", chapterSlug: "react-vite-app", tags: ["api", "analytics"] },
  { path: "artifacts/api-server/src/routes/wallet.ts", description: "Wallet balance, transaction history, and Razorpay top-up flow", chapterSlug: "wallet-system", tags: ["billing", "payments"] },
  { path: "artifacts/api-server/src/routes/billing.ts", description: "Billing summary and managed-vs-BYOP plan resolution endpoints", chapterSlug: "billing-modes", tags: ["billing"] },
  { path: "artifacts/api-server/src/routes/campaigns.ts", description: "Campaign CRUD, launch/pause/stop, lead upload, and stats", chapterSlug: "campaigns", tags: ["campaigns", "outbound"] },
  { path: "artifacts/api-server/src/routes/campaign-leads.ts", description: "Lead listing, status updates, and per-lead call history within a campaign", chapterSlug: "campaigns", tags: ["campaigns"] },
  { path: "artifacts/api-server/src/routes/campaign-webhook.ts", description: "Public (no-auth) webhook for campaign outbound call status — fires retries", chapterSlug: "webhooks-deep-dive", tags: ["webhooks", "campaigns"] },
  { path: "artifacts/api-server/src/routes/callbacks.ts", description: "Scheduled callback management: list, cancel, reschedule", chapterSlug: "callback-scheduling", tags: ["callbacks", "scheduling"] },
  { path: "artifacts/api-server/src/routes/knowledge-base.ts", description: "Knowledge source and entry CRUD; triggers FTS index rebuild", chapterSlug: "knowledge-base", tags: ["knowledge", "ai"] },
  { path: "artifacts/api-server/src/routes/scheduling/index.ts", description: "Mounts all scheduling sub-routes (calendars, event-types, bookings, public, google-oauth)", chapterSlug: "scheduling-ui", tags: ["scheduling"] },
  { path: "artifacts/api-server/src/routes/scheduling/public.ts", description: "Unauthenticated booking endpoints: event-types/:slug, slots, bookings (advisory-locked)", chapterSlug: "scheduling-ui", tags: ["scheduling", "public"] },
  { path: "artifacts/api-server/src/routes/scheduling/google-oauth.ts", description: "Google Calendar OAuth: connect, callback (stateless), connections list, revoke", chapterSlug: "scheduling-ui", tags: ["scheduling", "oauth", "google"] },
  { path: "artifacts/api-server/src/routes/scheduling/bookings.ts", description: "Auth-required booking management: list, cancel, reschedule", chapterSlug: "scheduling-ui", tags: ["scheduling"] },
  { path: "artifacts/api-server/src/routes/scheduling/calendars.ts", description: "Calendar CRUD and Google Calendar connection linking", chapterSlug: "scheduling-ui", tags: ["scheduling"] },
  { path: "artifacts/api-server/src/routes/scheduling/event-types.ts", description: "Event type CRUD — slug, duration, availability schedule assignment", chapterSlug: "scheduling-ui", tags: ["scheduling"] },
  { path: "artifacts/api-server/src/routes/scheduling/slots.ts", description: "Available slot computation endpoint (delegates to slot-engine)", chapterSlug: "scheduling-ui", tags: ["scheduling"] },
  { path: "artifacts/api-server/src/routes/admin.ts", description: "Admin platform settings: managed keys, feature flags, platform config", chapterSlug: "admin-auth-impersonation", tags: ["admin"] },
  { path: "artifacts/api-server/src/routes/admin-user-mgmt.ts", description: "Admin user management: list users, top-up wallet, suspend, impersonate", chapterSlug: "admin-auth-impersonation", tags: ["admin", "users"] },
  { path: "artifacts/api-server/src/routes/phone-numbers.ts", description: "Phone number provisioning via VoBiz KYC; buy, list, release numbers", chapterSlug: "vobiz-and-plivo", tags: ["telephony", "kyc"] },
  { path: "artifacts/api-server/src/routes/kyc.ts", description: "VoBiz KYC session creation, callback, webhook — gates telephony feature access", chapterSlug: "vobiz-and-plivo", tags: ["telephony", "kyc"] },
  { path: "artifacts/api-server/src/routes/crm.ts", description: "CRM connection and contact management (HubSpot, Google Contacts)", chapterSlug: "memory-crm-page", tags: ["crm", "integrations"] },
  { path: "artifacts/api-server/src/routes/book.ts", description: "SnapServe Book API: device progress, chapter completion, quiz answers, exam", chapterSlug: "contract-first-openapi", tags: ["book"] },
  { path: "artifacts/api-server/src/routes/health.ts", description: "GET /health — returns uptime and DB connectivity; used by Railway health checks", chapterSlug: "railway-deployment", tags: ["ops", "deployment"] },
  { path: "artifacts/api-server/src/routes/docs.ts", description: "Serves the raw openapi.yaml for the in-app API Reference docs explorer", chapterSlug: "contract-first-openapi", tags: ["docs", "openapi"] },
  { path: "artifacts/api-server/src/routes/voices.ts", description: "Lists available TTS voices per provider; platform-listed voices for admin curation", chapterSlug: "tts-adapters", tags: ["tts", "voices"] },
  { path: "artifacts/api-server/src/routes/search.ts", description: "Cross-entity search across agents, calls, leads, contacts", chapterSlug: "knowledge-base", tags: ["search"] },
  { path: "artifacts/api-server/src/routes/webhook-endpoints.ts", description: "User-configured outbound webhook management (for scheduling dispatch)", chapterSlug: "webhooks-deep-dive", tags: ["webhooks"] },
  { path: "artifacts/api-server/src/routes/ambient-sounds.ts", description: "Ambient audio library: list and stream background soundscape files", chapterSlug: "session-and-pipeline", tags: ["audio", "ambient"] },
  { path: "artifacts/api-server/src/routes/connections.ts", description: "Third-party integration connections (CRM, calendar) — list, connect, disconnect", chapterSlug: "memory-crm-page", tags: ["integrations", "crm"] },

  // ─────────────────────────────────────────────────────────────────────────
  // API SERVER — orchestration (the real-time call engine)
  // ─────────────────────────────────────────────────────────────────────────
  { path: "artifacts/api-server/src/orchestration/session.ts", description: "Session registry Map, createSession(), endSession() with billing + memory write-back", chapterSlug: "session-and-pipeline", tags: ["orchestration", "session", "billing"] },
  { path: "artifacts/api-server/src/orchestration/pipeline.ts", description: "Pipeline class — drives the STT→LLM→TTS turn loop for every live call", chapterSlug: "session-and-pipeline", tags: ["orchestration", "pipeline", "core"] },
  { path: "artifacts/api-server/src/orchestration/audio.ts", description: "Audio format utilities: WAV wrapping, PCM conversion, μ-law decode, resampling", chapterSlug: "audio-ts", tags: ["orchestration", "audio"] },
  { path: "artifacts/api-server/src/orchestration/audioPool.ts", description: "Reusable audio buffer pool — eliminates GC pressure from per-frame allocations", chapterSlug: "audio-ts", tags: ["orchestration", "audio", "performance"] },
  { path: "artifacts/api-server/src/orchestration/audioWorker.ts", description: "Node.js Worker thread that offloads PCM processing off the main event loop", chapterSlug: "audio-ts", tags: ["orchestration", "audio", "worker"] },
  { path: "artifacts/api-server/src/orchestration/endpointing.ts", description: "Turn endpointing: force-finalize timer (1800ms), stall backstop, VAD-reinforced silence detection", chapterSlug: "endpointing", tags: ["orchestration", "endpointing", "vad"] },
  { path: "artifacts/api-server/src/orchestration/silero-vad.ts", description: "Silero VAD wrapper — loads the ONNX model and classifies 30ms audio frames as speech/silence", chapterSlug: "silero-vad", tags: ["orchestration", "vad", "ml"] },
  { path: "artifacts/api-server/src/orchestration/recorder.ts", description: "Dual-track call recorder — mixes agent + caller audio into a WAV for storage", chapterSlug: "session-and-pipeline", tags: ["orchestration", "recording"] },
  { path: "artifacts/api-server/src/orchestration/callerMemory.ts", description: "loadCallerContext() and updateCallerProfile() — reads/writes caller facts + archive", chapterSlug: "caller-memory", tags: ["orchestration", "memory"] },
  { path: "artifacts/api-server/src/orchestration/genderDetectorChained.ts", description: "Fallback chain: wav2vec2 → autocorrelation → pitch; locks gender once confidence ≥ threshold", chapterSlug: "gender-detection", tags: ["orchestration", "gender", "ml"] },
  { path: "artifacts/api-server/src/orchestration/genderDetectorML.ts", description: "First-stage gender detector using the Python gender-service REST API (wav2vec2)", chapterSlug: "gender-detection", tags: ["orchestration", "gender", "ml"] },
  { path: "artifacts/api-server/src/orchestration/genderDetectorMLv2.ts", description: "Second-stage detector using autocorrelation and fundamental frequency pitch analysis", chapterSlug: "gender-detection", tags: ["orchestration", "gender"] },
  { path: "artifacts/api-server/src/orchestration/genderService.ts", description: "HTTP client for the Python gender-service sidecar (POST /detect, POST /verify)", chapterSlug: "gender-detection", tags: ["orchestration", "gender"] },
  { path: "artifacts/api-server/src/orchestration/speakerVerifier.ts", description: "In-call speaker verification: enrolls voiceprints, detects mid-call handoffs", chapterSlug: "speaker-recognition", tags: ["orchestration", "speaker", "ml"] },
  { path: "artifacts/api-server/src/orchestration/ambient.ts", description: "Ambient audio player — mixes bed audio with TTS; handles DTX-safe frame continuity", chapterSlug: "session-and-pipeline", tags: ["orchestration", "audio", "ambient"] },
  { path: "artifacts/api-server/src/orchestration/backchannel.ts", description: "DTMF and backchannel tone injector (holds, transfer tones)", chapterSlug: "session-and-pipeline", tags: ["orchestration", "dtmf"] },
  { path: "artifacts/api-server/src/orchestration/dtmf.ts", description: "DTMF tone detector and digit accumulator for IVR-style key-press flows", chapterSlug: "session-and-pipeline", tags: ["orchestration", "dtmf"] },
  { path: "artifacts/api-server/src/orchestration/campaignCaller.ts", description: "Outbound campaign dialler — picks leads, dials, handles no-answer queuing", chapterSlug: "campaigns", tags: ["campaigns", "outbound", "orchestration"] },
  { path: "artifacts/api-server/src/orchestration/extract-sentences.ts", description: "Splits LLM streaming text into TTS-ready sentences respecting minCommaClauseChars", chapterSlug: "tts-adapters", tags: ["orchestration", "tts", "text-processing"] },
  { path: "artifacts/api-server/src/orchestration/prompt-vars.ts", description: "Resolves runtime variables injected into the system prompt (caller name, time, language rule)", chapterSlug: "staged-prompts", tags: ["orchestration", "prompt", "llm"] },
  { path: "artifacts/api-server/src/orchestration/datetimeInject.ts", description: "Injects current date/time in the caller's timezone into the system prompt", chapterSlug: "staged-prompts", tags: ["orchestration", "prompt"] },
  { path: "artifacts/api-server/src/orchestration/conversationDiscipline.ts", description: "Enforces LLM output length/format constraints and strips unsafe content", chapterSlug: "staged-prompts", tags: ["orchestration", "llm", "safety"] },
  { path: "artifacts/api-server/src/orchestration/kb-retrieval.ts", description: "PostgreSQL FTS-based knowledge base retrieval — injects relevant entries into the prompt", chapterSlug: "knowledge-base", tags: ["orchestration", "knowledge", "search"] },
  { path: "artifacts/api-server/src/orchestration/reasoningFilter.ts", description: "Strips <think>…</think> reasoning tags from LLM output before TTS speaks them", chapterSlug: "llm-adapters", tags: ["orchestration", "llm"] },
  { path: "artifacts/api-server/src/orchestration/transcriptQuality.ts", description: "Quality-gates transcript fragments — rejects hallucinations and empty partials", chapterSlug: "reliability-patterns", tags: ["orchestration", "stt", "quality"] },
  { path: "artifacts/api-server/src/orchestration/sessionStore.ts", description: "In-memory session store with TTL cleanup — maps sessionId → Pipeline instance", chapterSlug: "session-and-pipeline", tags: ["orchestration", "session"] },
  { path: "artifacts/api-server/src/orchestration/callbackScheduler.ts", description: "Polling scheduler that fires scheduled callbacks and auto-redials at their due time", chapterSlug: "callback-scheduling", tags: ["orchestration", "callbacks", "scheduling"] },
  { path: "artifacts/api-server/src/orchestration/db-retry.ts", description: "withDbRetry() wrapper — retries transient Postgres errors with exponential backoff", chapterSlug: "reliability-patterns", tags: ["orchestration", "database", "reliability"] },
  { path: "artifacts/api-server/src/orchestration/utils.ts", description: "Shared orchestration utilities: sleep, chunk, safe-parse, timeout wrappers", chapterSlug: "session-and-pipeline", tags: ["orchestration", "utility"] },
  { path: "artifacts/api-server/src/orchestration/types.ts", description: "Shared TypeScript types for the orchestration layer: SessionConfig, TurnResult, etc.", chapterSlug: "session-and-pipeline", tags: ["orchestration", "typescript"] },

  // ─────────────────────────────────────────────────────────────────────────
  // API SERVER — orchestration / telephony adapters
  // ─────────────────────────────────────────────────────────────────────────
  { path: "artifacts/api-server/src/orchestration/telephony/", description: "Directory: telephony provider adapters (one sub-folder per provider)", chapterSlug: "telephony-overview", tags: ["telephony"] },
  { path: "artifacts/api-server/src/orchestration/telephony/twilio.ts", description: "Twilio WebSocket handler: μ-law decode, send audio, TwiML dial response", chapterSlug: "twilio-deep-dive", tags: ["telephony", "twilio"] },
  { path: "artifacts/api-server/src/orchestration/telephony/plivo.ts", description: "Plivo WebSocket handler: same pattern as Twilio but with Plivo event names", chapterSlug: "vobiz-and-plivo", tags: ["telephony", "plivo"] },
  { path: "artifacts/api-server/src/orchestration/telephony/vobiz.ts", description: "VoBiz WebSocket handler: JSON events, LE PCM audio, hangup_method: POST", chapterSlug: "vobiz-and-plivo", tags: ["telephony", "vobiz"] },
  { path: "artifacts/api-server/src/orchestration/telephony/webcall.ts", description: "Browser WebSocket handler: thin adapter over the shared pipeline core for web calls", chapterSlug: "webcall", tags: ["telephony", "webcall", "browser"] },

  // ─────────────────────────────────────────────────────────────────────────
  // API SERVER — orchestration / provider adapters
  // ─────────────────────────────────────────────────────────────────────────
  { path: "artifacts/api-server/src/orchestration/adapters/", description: "Directory: STT, LLM, and TTS adapter implementations (one file per provider)", chapterSlug: "stt-adapters", tags: ["adapters"] },
  { path: "artifacts/api-server/src/orchestration/adapters/stt-deepgram.ts", description: "Deepgram STT adapter: Nova-2 model over WebSocket, raw LINEAR16 PCM input", chapterSlug: "stt-adapters", tags: ["stt", "deepgram"] },
  { path: "artifacts/api-server/src/orchestration/adapters/stt-azure.ts", description: "Azure STT adapter: X-RequestId on every frame, Continuous LID for language switching", chapterSlug: "azure-stt-protocol", tags: ["stt", "azure"] },
  { path: "artifacts/api-server/src/orchestration/adapters/stt-whisper.ts", description: "Whisper STT adapter: batch transcription via OpenAI Whisper API", chapterSlug: "stt-adapters", tags: ["stt", "whisper", "openai"] },
  { path: "artifacts/api-server/src/orchestration/adapters/stt-sarvam.ts", description: "Sarvam STT adapter: saarika:v2.5 / saaras:v3, WAV-wrapped AudioContent JSON format", chapterSlug: "sarvam-deep-dive", tags: ["stt", "sarvam", "india"] },
  { path: "artifacts/api-server/src/orchestration/adapters/llm-openai.ts", description: "OpenAI LLM adapter: GPT-4o, streaming SSE, tool_calls handling", chapterSlug: "llm-adapters", tags: ["llm", "openai"] },
  { path: "artifacts/api-server/src/orchestration/adapters/llm-anthropic.ts", description: "Anthropic LLM adapter: Claude models, streaming, tool_use blocks", chapterSlug: "llm-adapters", tags: ["llm", "anthropic"] },
  { path: "artifacts/api-server/src/orchestration/adapters/llm-deepseek.ts", description: "DeepSeek LLM adapter: OpenAI-compatible API, reasoning model stripping", chapterSlug: "llm-adapters", tags: ["llm", "deepseek"] },
  { path: "artifacts/api-server/src/orchestration/adapters/llm-mistral.ts", description: "Mistral LLM adapter: OpenAI-compatible streaming API", chapterSlug: "llm-adapters", tags: ["llm", "mistral"] },
  { path: "artifacts/api-server/src/orchestration/adapters/llm-cohere.ts", description: "Cohere LLM adapter: Command-R model with tool calling", chapterSlug: "llm-adapters", tags: ["llm", "cohere"] },
  { path: "artifacts/api-server/src/orchestration/adapters/llm-sarvam.ts", description: "Sarvam LLM adapter: sarvam-m1, reasoning OFF by default, stream:false for tool turns", chapterSlug: "sarvam-deep-dive", tags: ["llm", "sarvam", "india"] },
  { path: "artifacts/api-server/src/orchestration/adapters/llm-groq.ts", description: "Groq LLM adapter: llama-3 models, used as the managed-plan fallback provider", chapterSlug: "fallback-chains", tags: ["llm", "groq", "fallback"] },
  { path: "artifacts/api-server/src/orchestration/adapters/tts-elevenlabs.ts", description: "ElevenLabs TTS adapter: streaming WebSocket, voice cloning support", chapterSlug: "tts-adapters", tags: ["tts", "elevenlabs"] },
  { path: "artifacts/api-server/src/orchestration/adapters/tts-openai.ts", description: "OpenAI TTS adapter: tts-1 / tts-1-hd, streaming PCM chunks", chapterSlug: "tts-adapters", tags: ["tts", "openai"] },
  { path: "artifacts/api-server/src/orchestration/adapters/tts-azure.ts", description: "Azure TTS adapter: Neural voices, SSML prosody control, streaming audio", chapterSlug: "tts-adapters", tags: ["tts", "azure"] },
  { path: "artifacts/api-server/src/orchestration/adapters/tts-cartesia.ts", description: "Cartesia TTS adapter: ~80ms first-chunk latency, streaming WebSocket", chapterSlug: "tts-adapters", tags: ["tts", "cartesia"] },
  { path: "artifacts/api-server/src/orchestration/adapters/tts-deepgram.ts", description: "Deepgram Aura TTS adapter: streaming audio, Aura voice models", chapterSlug: "tts-adapters", tags: ["tts", "deepgram"] },
  { path: "artifacts/api-server/src/orchestration/adapters/tts-polly.ts", description: "AWS Polly TTS adapter: Neural voices, streaming synthesis", chapterSlug: "tts-adapters", tags: ["tts", "aws", "polly"] },
  { path: "artifacts/api-server/src/orchestration/adapters/tts-sarvam.ts", description: "Sarvam TTS adapter: bulbul:v2/v3 models, batch endpoint (streaming 404s)", chapterSlug: "sarvam-deep-dive", tags: ["tts", "sarvam", "india"] },

  // ─────────────────────────────────────────────────────────────────────────
  // API SERVER — orchestration / HTTP pool
  // ─────────────────────────────────────────────────────────────────────────
  { path: "artifacts/api-server/src/orchestration/http/pool.ts", description: "Shared undici Agent set as global dispatcher — keeps provider TCP sockets warm between turns", chapterSlug: "http-keepalive-pool", tags: ["performance", "http", "networking"] },

  // ─────────────────────────────────────────────────────────────────────────
  // API SERVER — services
  // ─────────────────────────────────────────────────────────────────────────
  { path: "artifacts/api-server/src/services/minute-rates.ts", description: "resolveAgentBillingMode() — checks provider keys to decide managed vs BYOP rate", chapterSlug: "billing-modes", tags: ["billing", "services"] },
  { path: "artifacts/api-server/src/services/retryEngine.ts", description: "Persists failed call attempts to retry_jobs table; re-fires after configurable delay", chapterSlug: "retry-engine", tags: ["reliability", "outbound", "retry"] },
  { path: "artifacts/api-server/src/services/batchScheduler.ts", description: "60-second sweep that force-closes stuck in_progress calls older than 30 min", chapterSlug: "reliability-patterns", tags: ["reliability", "scheduler"] },
  { path: "artifacts/api-server/src/services/autoRedial.ts", description: "scheduleNoAnswerRedial() — creates a scheduled_callbacks row for missed outbound calls", chapterSlug: "callback-scheduling", tags: ["callbacks", "outbound"] },
  { path: "artifacts/api-server/src/services/tool-executor.ts", description: "Dispatches LLM tool_calls to handler functions (schedule_booking, lookup_crm, etc.)", chapterSlug: "tool-execution", tags: ["tools", "ai", "agentic"] },
  { path: "artifacts/api-server/src/services/execution-log.ts", description: "Writes structured call events to call_execution_logs (stt_final, llm_start, tool_call, etc.)", chapterSlug: "reading-call-logs", tags: ["observability", "logging"] },
  { path: "artifacts/api-server/src/services/brevo.ts", description: "Brevo (Sendinblue) email client — sends booking confirmations and OTP emails", chapterSlug: "scheduling-ui", tags: ["email", "scheduling"] },
  { path: "artifacts/api-server/src/services/rate-limit-cleanup.ts", description: "registerTransientKey() — registers short-lived platform_settings keys for the hourly sweep", chapterSlug: "reliability-patterns", tags: ["reliability", "cleanup"] },
  { path: "artifacts/api-server/src/services/disposition.ts", description: "Classifies call outcome (resolved, escalated, callback) using an LLM post-call", chapterSlug: "caller-memory", tags: ["ai", "disposition"] },
  { path: "artifacts/api-server/src/services/disposition-llm.ts", description: "LLM prompt and parser for call disposition classification", chapterSlug: "caller-memory", tags: ["ai", "llm", "disposition"] },
  { path: "artifacts/api-server/src/services/wallet-auto-debit.ts", description: "Debits the wallet at call-end time based on duration × resolved billing rate", chapterSlug: "wallet-system", tags: ["billing", "wallet"] },
  { path: "artifacts/api-server/src/services/duplicate-detection.ts", description: "Detects and suppresses duplicate inbound calls for the same agent+caller within a window", chapterSlug: "reliability-patterns", tags: ["reliability", "telephony"] },
  { path: "artifacts/api-server/src/services/prompt-template.ts", description: "Resolves named prompt templates; merges template variables with agent config", chapterSlug: "staged-prompts", tags: ["prompt", "llm"] },
  { path: "artifacts/api-server/src/services/alert-notifications.ts", description: "Sends usage spike and system alert emails to the operator via Brevo", chapterSlug: "reliability-patterns", tags: ["ops", "alerts"] },
  { path: "artifacts/api-server/src/services/spike-alerts.ts", description: "Detects unusual call volume spikes and triggers alert notifications", chapterSlug: "reliability-patterns", tags: ["ops", "monitoring"] },
  { path: "artifacts/api-server/src/services/callbackDetector.ts", description: "Parses LLM output for callback intent (caller said 'call me back at 3pm')", chapterSlug: "callback-scheduling", tags: ["callbacks", "ai"] },
  { path: "artifacts/api-server/src/services/phone-normalization.ts", description: "Normalises inbound phone numbers using country-code defaults for caller memory keying", chapterSlug: "caller-memory", tags: ["telephony", "utility"] },
  { path: "artifacts/api-server/src/services/usage/", description: "Directory: per-user and platform-wide usage event recording and aggregation", chapterSlug: "billing-modes", tags: ["billing", "analytics"] },
  { path: "artifacts/api-server/src/services/scheduling/", description: "Directory: slot engine, advisory lock, Google Calendar sync, email notifications", chapterSlug: "scheduling-ui", tags: ["scheduling"] },
  { path: "artifacts/api-server/src/services/scheduling/slot-engine.ts", description: "Computes available slots: date-fns-tz aware, respects weekly schedule + overrides + bookings", chapterSlug: "scheduling-ui", tags: ["scheduling", "algorithm"] },
  { path: "artifacts/api-server/src/services/dpdp/", description: "Directory: DPDP compliance — disclosure injection, post-call PII scan, retention, erasure", chapterSlug: "compliance-injection", tags: ["compliance", "privacy"] },
  { path: "artifacts/api-server/src/services/dpdpRetention.ts", description: "Enforces data retention schedules: anonymises calls older than the policy window", chapterSlug: "compliance-injection", tags: ["compliance", "retention"] },
  { path: "artifacts/api-server/src/services/crm/", description: "Directory: HubSpot and Google Contacts CRM adapters for contact sync", chapterSlug: "memory-crm-page", tags: ["crm", "integrations"] },

  // ─────────────────────────────────────────────────────────────────────────
  // DATABASE — schema
  // ─────────────────────────────────────────────────────────────────────────
  { path: "lib/db/src/schema/index.ts", description: "Barrel export for all Drizzle schema tables — the single import point for the API server", chapterSlug: "drizzle-intro", tags: ["database", "schema"] },
  { path: "lib/db/src/schema/users.ts", description: "users table: clerk_id (= Google sub), email, name; one row per authenticated user", chapterSlug: "drizzle-intro", tags: ["database", "auth"] },
  { path: "lib/db/src/schema/agents.ts", description: "agents table: persona, ASR/LLM/TTS provider config, telephony settings, status", chapterSlug: "calls-and-providers", tags: ["database", "agents"] },
  { path: "lib/db/src/schema/calls.ts", description: "calls table: status, transcript, duration, recording URL, billing mode", chapterSlug: "calls-and-providers", tags: ["database", "calls"] },
  { path: "lib/db/src/schema/providers.ts", description: "providers table: encrypted API keys keyed on (userId, providerType)", chapterSlug: "calls-and-providers", tags: ["database", "providers", "security"] },
  { path: "lib/db/src/schema/callerProfiles.ts", description: "caller_profiles table: per-(agentId, canonicalPhone) summary and call count", chapterSlug: "caller-memory-tables", tags: ["database", "memory"] },
  { path: "lib/db/src/schema/callerFacts.ts", description: "caller_facts table: structured LLM-extracted key-value facts per caller", chapterSlug: "caller-memory-tables", tags: ["database", "memory"] },
  { path: "lib/db/src/schema/callerCallArchive.ts", description: "caller_call_archive table: per-call episode summaries for returning callers", chapterSlug: "caller-memory-tables", tags: ["database", "memory"] },
  { path: "lib/db/src/schema/scheduledCallbacks.ts", description: "scheduled_callbacks table: pending outbound callback and redial jobs with due_at timestamp", chapterSlug: "callback-scheduling", tags: ["database", "callbacks"] },
  { path: "lib/db/src/schema/campaigns.ts", description: "campaigns, campaign_batches, campaign_leads tables: outbound dialling campaign structure", chapterSlug: "campaigns", tags: ["database", "campaigns"] },
  { path: "lib/db/src/schema/scheduling.ts", description: "6 scheduling tables: calendars, event_types, availability_schedules, overrides, bookings, google_calendar_connections", chapterSlug: "scheduling-ui", tags: ["database", "scheduling"] },
  { path: "lib/db/src/schema/platform-settings.ts", description: "platform_settings table: key-value store for operator config (managed keys, rate-limit counters)", tags: ["database", "config"] },
  { path: "lib/db/src/schema/knowledge-base.ts", description: "knowledge_sources and knowledge_entries tables with GIN index for PostgreSQL FTS", chapterSlug: "knowledge-base", tags: ["database", "knowledge", "fts"] },
  { path: "lib/db/src/schema/book-progress.ts", description: "book_progress table: per-device chapter completion and quiz answer storage", chapterSlug: "contract-first-openapi", tags: ["database", "book"] },
  { path: "lib/db/src/schema/book-exam.ts", description: "book_exam_attempts table: stores attempt score, pass/fail, and timestamp", chapterSlug: "contract-first-openapi", tags: ["database", "book"] },
  { path: "lib/db/src/schema/usage-events.ts", description: "usage_events table: append-only per-call billing events with minute count and rate", chapterSlug: "billing-modes", tags: ["database", "billing"] },
  { path: "lib/db/src/schema/wallet.ts", description: "wallets table (balance) + wallet_transactions table (append-only audit ledger)", chapterSlug: "wallet-system", tags: ["database", "billing"] },

  // ─────────────────────────────────────────────────────────────────────────
  // DATABASE — migrations & utilities
  // ─────────────────────────────────────────────────────────────────────────
  { path: "lib/db/src/index.ts", description: "DB client factory — creates and exports the drizzle() connection using DATABASE_URL", chapterSlug: "drizzle-intro", tags: ["database"] },
  { path: "lib/db/src/migrate.ts", description: "Runs drizzle-kit migrations at server startup via bootstrapMigrationJournal + migrate()", chapterSlug: "schema-changes", tags: ["database", "migrations"] },
  { path: "lib/db/src/caller-identity.ts", description: "canonicalizeCallerKey() — normalises phone numbers to the canonical form for memory keying", chapterSlug: "caller-memory", tags: ["database", "telephony", "utility"] },
  { path: "lib/db/src/identity-merge.ts", description: "linkLegacyIdentitiesAtLogin() — merges duplicate user rows on Google sign-in (Clerk→Google migration)", chapterSlug: "google-oauth-sessions", tags: ["database", "auth", "migration"] },

  // ─────────────────────────────────────────────────────────────────────────
  // API SPEC & CODEGEN
  // ─────────────────────────────────────────────────────────────────────────
  { path: "lib/api-spec/openapi.yaml", description: "The OpenAPI 3.1 spec — source of truth for ALL API contracts (routes, schemas, responses)", chapterSlug: "contract-first-openapi", tags: ["openapi", "codegen", "contracts"] },
  { path: "lib/api-spec/orval.config.mjs", description: "Orval codegen config — generates React Query hooks and Zod schemas from the OpenAPI spec", chapterSlug: "contract-first-openapi", tags: ["openapi", "codegen"] },
  { path: "lib/api-client-react/src/generated/", description: "Auto-generated React Query hooks (do NOT edit — run codegen to regenerate)", chapterSlug: "contract-first-openapi", tags: ["openapi", "codegen", "frontend"] },
  { path: "lib/api-zod/src/generated/", description: "Auto-generated Zod validation schemas for server-side input validation (do NOT edit)", chapterSlug: "contract-first-openapi", tags: ["openapi", "codegen", "validation"] },

  // ─────────────────────────────────────────────────────────────────────────
  // DASHBOARD — pages
  // ─────────────────────────────────────────────────────────────────────────
  { path: "artifacts/dashboard/src/", description: "React + Vite frontend — the SnapServe user-facing dashboard", chapterSlug: "react-vite-app", tags: ["frontend"] },
  { path: "artifacts/dashboard/src/pages/dashboard.tsx", description: "Overview page: agent count, calls today, success rate, avg duration, charts", chapterSlug: "react-vite-app", tags: ["frontend", "dashboard"] },
  { path: "artifacts/dashboard/src/pages/agents/", description: "Directory: agent list, create flow, edit page, detail view", chapterSlug: "agent-builder", tags: ["frontend", "agents"] },
  { path: "artifacts/dashboard/src/pages/calls/", description: "Directory: call log list, call detail drawer with transcript and execution timeline", chapterSlug: "reading-call-logs", tags: ["frontend", "calls"] },
  { path: "artifacts/dashboard/src/pages/providers/", description: "Directory: provider API key management UI — add/list/delete keys per provider type", chapterSlug: "calls-and-providers", tags: ["frontend", "providers"] },
  { path: "artifacts/dashboard/src/pages/scheduling/", description: "Directory: calendar, event types, availability, bookings scheduling UI", chapterSlug: "scheduling-ui", tags: ["frontend", "scheduling"] },
  { path: "artifacts/dashboard/src/pages/memory/", description: "Directory: caller memory CRM — per-caller profile, facts, and call history", chapterSlug: "memory-crm-page", tags: ["frontend", "memory", "crm"] },
  { path: "artifacts/dashboard/src/pages/campaigns/", description: "Directory: campaign list, create, lead management, and live status monitor", chapterSlug: "campaigns", tags: ["frontend", "campaigns"] },
  { path: "artifacts/dashboard/src/pages/wallet.tsx", description: "Wallet balance display, transaction history, and Razorpay top-up flow", chapterSlug: "wallet-system", tags: ["frontend", "billing"] },
  { path: "artifacts/dashboard/src/pages/analytics.tsx", description: "Call analytics: volume chart, status breakdown, success rate trends", chapterSlug: "react-vite-app", tags: ["frontend", "analytics"] },
  { path: "artifacts/dashboard/src/pages/landing.tsx", description: "Public landing page shown to unauthenticated users — Google sign-in CTA", chapterSlug: "google-oauth-sessions", tags: ["frontend", "auth"] },
  { path: "artifacts/dashboard/src/pages/book/", description: "Directory: in-app SnapServe Book reader embedded in the dashboard", chapterSlug: "react-vite-app", tags: ["frontend", "book"] },

  // ─────────────────────────────────────────────────────────────────────────
  // DASHBOARD — components & hooks
  // ─────────────────────────────────────────────────────────────────────────
  { path: "artifacts/dashboard/src/components/layout.tsx", description: "Shell layout: sidebar navigation, header, responsive mobile drawer", chapterSlug: "react-vite-app", tags: ["frontend", "layout"] },
  { path: "artifacts/dashboard/src/components/GlobalSearch.tsx", description: "Cmd+K global search component — searches agents, calls, leads, contacts", chapterSlug: "react-vite-app", tags: ["frontend", "search"] },
  { path: "artifacts/dashboard/src/components/webcall-panel.tsx", description: "Browser web-call UI panel — connects to the WebSocket, sends mic audio, plays TTS", chapterSlug: "webcall", tags: ["frontend", "webcall"] },
  { path: "artifacts/dashboard/src/lib/auth.tsx", description: "Auth context — stores JWT in localStorage, provides useAuth() hook, handles logout", chapterSlug: "google-oauth-sessions", tags: ["frontend", "auth"] },
  { path: "artifacts/dashboard/src/lib/api.ts", description: "Sets the Bearer token getter so all generated React Query hooks attach the session JWT", chapterSlug: "data-hooks", tags: ["frontend", "api"] },

  // ─────────────────────────────────────────────────────────────────────────
  // GENDER SERVICE (Python)
  // ─────────────────────────────────────────────────────────────────────────
  { path: "artifacts/gender-service/main.py", description: "FastAPI entry point — lazy-imports librosa; POST /detect, POST /verify, POST /enroll", chapterSlug: "gender-detection", tags: ["python", "ml", "gender"] },
  { path: "artifacts/gender-service/detector.py", description: "wav2vec2-based gender classifier: MFCC features + MLP classifier", chapterSlug: "gender-detection", tags: ["python", "ml", "gender"] },
  { path: "artifacts/gender-service/speaker.py", description: "ECAPA-TDNN speaker verifier: enroll voiceprint, verify identity", chapterSlug: "speaker-recognition", tags: ["python", "ml", "speaker"] },

  // ─────────────────────────────────────────────────────────────────────────
  // SCRIPTS
  // ─────────────────────────────────────────────────────────────────────────
  { path: "scripts/src/backfill-caller-identity.ts", description: "Canonicalises phone keys in caller_profiles/facts/archive; dry-run by default (--apply to commit)", chapterSlug: "caller-memory", tags: ["scripts", "database", "migration"] },
  { path: "scripts/src/backfill-user-identity.ts", description: "Backfills email/name from Clerk for users with NULL identity rows", chapterSlug: "google-oauth-sessions", tags: ["scripts", "database"] },
  { path: "scripts/src/wipe-beta-data.ts", description: "Deletes all agents/calls/campaigns from a database while keeping users and wallets", chapterSlug: "production-ops", tags: ["scripts", "ops"] },
  { path: "scripts/src/merge-user-identities.ts", description: "Consolidates duplicate users rows from Clerk→Google migration; dry-run by default", chapterSlug: "google-oauth-sessions", tags: ["scripts", "database", "migration"] },

  // ─────────────────────────────────────────────────────────────────────────
  // SNAPSERVE BOOK
  // ─────────────────────────────────────────────────────────────────────────
  { path: "artifacts/snapserve-book/src/content/index.ts", description: "All chapter and module definitions; exports allChapters, modules, course, getChapter()", tags: ["book"] },
  { path: "artifacts/snapserve-book/src/content/types.ts", description: "Chapter, Module, Course, and Block TypeScript type definitions for the book content", tags: ["book", "typescript"] },
  { path: "artifacts/snapserve-book/src/content/chapters/", description: "Directory: one .ts file per chapter — all chapter content lives here", tags: ["book"] },
  { path: "artifacts/snapserve-book/src/pages/ChapterReader.tsx", description: "Chapter reading page: block renderer, progress tracking, bookmarks, notes, prev/next nav", tags: ["book", "frontend"] },
  { path: "artifacts/snapserve-book/src/hooks/use-progress.ts", description: "Zustand store for chapter completion — write-through to book_progress API", tags: ["book", "state"] },
  { path: "artifacts/snapserve-book/src/hooks/use-bookmarks.ts", description: "Zustand store for bookmarked chapters — localStorage only", tags: ["book", "state"] },
];

// ── Derived lookups ──────────────────────────────────────────────────────────

export const allTags = Array.from(
  new Set(fileIndex.flatMap(f => f.tags))
).sort();

/** All top-level directory segments that appear in the index */
export const topLevelDirs = Array.from(
  new Set(fileIndex.map(f => f.path.split("/")[0] ?? ""))
).sort();

/** Count of files with a chapter link vs total */
export const fileIndexStats = {
  total: fileIndex.length,
  withChapter: fileIndex.filter(f => f.chapterSlug).length,
};
