import type { Chapter, Module, Course } from "./types";

// ── Module 0 — Voice AI, From Zero (true beginner) ───────────────────────────
import { whatIsAVoiceAgent } from "./chapters/mb-what-is-a-voice-agent";
import { whatIsAnLlm } from "./chapters/mb-what-is-an-llm";
import { whatIsStt } from "./chapters/mb-what-is-stt";
import { whatIsTts } from "./chapters/mb-what-is-tts";
import { whatIsTelephony } from "./chapters/mb-what-is-telephony";
import { whyNodejs } from "./chapters/mb-why-nodejs";

// ── Module 1 — Orientation ────────────────────────────────────────────────────
import { callJourney } from "./chapters/m0-call-journey";
import { repoMap } from "./chapters/m0-repo-map";
import { howToUseThisBook } from "./chapters/m0-how-to-use-this-book";

// ── Module 2 — Node.js & TypeScript Foundations ──────────────────────────────
import { modulesAndImports } from "./chapters/m1-modules-and-imports";
import { asyncAwaitPromises } from "./chapters/m1-async-await-promises";
import { buffersAndBinary } from "./chapters/m1-buffers";
import { typescriptTypes } from "./chapters/m1-typescript-types";
import { classesAndState } from "./chapters/m1-classes-and-state";

// ── Module 3 — The Database Layer ────────────────────────────────────────────
import { drizzleIntro } from "./chapters/m2-drizzle-intro";
import { usersAndAgents } from "./chapters/m2-users-and-agents";
import { callsAndProviders } from "./chapters/m2-calls-and-providers";
import { callerMemoryTables } from "./chapters/m2-caller-memory-tables";
import { migrations } from "./chapters/m2-migrations";

// ── Module 4 — The API Server ────────────────────────────────────────────────
import { expressApp } from "./chapters/m3-express-app";
import { serverBootstrap } from "./chapters/m3-server-bootstrap";
import { contractFirstOpenapi } from "./chapters/m3-contract-first-openapi";
import { middlewareAndAuth } from "./chapters/m3-middleware-and-auth";
import { routesAnatomy } from "./chapters/m3-routes-anatomy";

// ── Module 5 — The Orchestration Engine ──────────────────────────────────────
import { audioTs } from "./chapters/m4-audio";
import { sessionAndPipeline } from "./chapters/m4-session-and-pipeline";
import { endpointing } from "./chapters/m4-endpointing";
import { sileroVad } from "./chapters/m4-silero-vad";
import { bargeInAndEcho } from "./chapters/m4-barge-in-and-echo";
import { turnSafetyNet } from "./chapters/m4-turn-safety-net";
import { toolExecution } from "./chapters/m4-tool-execution";
import { amdVoicemail } from "./chapters/m4-amd-voicemail";
import { callRecording } from "./chapters/m4-recording";
import { postCallAi } from "./chapters/m4-post-call-ai";

// ── Module 6 — The Adapters ──────────────────────────────────────────────────
import { adapterPattern } from "./chapters/m5-adapter-pattern";
import { sttAdapters } from "./chapters/m5-stt-adapters";
import { llmAdapters } from "./chapters/m5-llm-adapters";
import { ttsAdapters } from "./chapters/m5-tts-adapters";
import { fallbackChains } from "./chapters/m5-fallback-chains";
import { httpKeepalivePool } from "./chapters/m5-http-keepalive-pool";

// ── Module 7 — Telephony & Web Calls ─────────────────────────────────────────
import { telephonyOverview } from "./chapters/m6-telephony-overview";
import { twilioDeepDive } from "./chapters/m6-twilio-deep-dive";
import { vobizAndPlivo } from "./chapters/m6-vobiz-and-plivo";
import { webcall } from "./chapters/m6-webcall";
import { outboundCalls } from "./chapters/m6-outbound-calls";
import { autoRedial } from "./chapters/m6-auto-redial";
import { retryEngine } from "./chapters/m6-retry-engine";
import { callbackScheduling } from "./chapters/m6-callback-scheduling";
import { webhooksDeepDive } from "./chapters/m6-webhooks";

// ── Module 8 — The Frontend Dashboard ────────────────────────────────────────
import { reactViteApp } from "./chapters/m7-react-vite-app";
import { dataHooks } from "./chapters/m7-data-hooks";
import { agentBuilder } from "./chapters/m7-agent-builder";
import { memoryCrmPage } from "./chapters/m7-memory-crm";
import { schedulingUi } from "./chapters/m7-scheduling-ui";

// ── Module 9 — Supporting Systems ────────────────────────────────────────────
import { minuteRates } from "./chapters/m8-minute-rates";
import { scheduling } from "./chapters/m8-scheduling";
import { campaigns } from "./chapters/m8-campaigns";
import { callerMemory } from "./chapters/m8-caller-memory";
import { complianceInjection } from "./chapters/m8-compliance-injection";
import { memoryGuards } from "./chapters/m8-memory-guards";

// ── Module 10 — AI Tools & Agentic Behaviour ─────────────────────────────────
import { toolsDispatch } from "./chapters/m9-tools-dispatch";
import { knowledgeBase } from "./chapters/m9-knowledge-base";
import { stagedPrompts } from "./chapters/m9-staged-prompts";

// ── Module 11 — Billing & Wallets ────────────────────────────────────────────
import { walletSystem } from "./chapters/m10-wallet";
import { billingModes } from "./chapters/m10-billing-modes";

// ── Module 12 — Deployment & Operations ──────────────────────────────────────
import { railwayDeployment } from "./chapters/m11-railway";
import { secretsAndEnv } from "./chapters/m11-secrets";
import { productionOps } from "./chapters/m11-ops";

// ── Module 13 — Speaker Intelligence ─────────────────────────────────────────
import { genderDetection } from "./chapters/m12-gender-detection";
import { speakerRecognition } from "./chapters/m12-speaker-recognition";
import { inCallSpeakerVerify } from "./chapters/m12-speaker-verify";

// ── Module 14 — Multi-Language Support ───────────────────────────────────────
import { languageDetection } from "./chapters/m13-language-detection";
import { sarvamDeepDive } from "./chapters/m13-sarvam-deep-dive";

// ── Module 15 — Security & Auth ───────────────────────────────────────────────
import { googleOauthSessions } from "./chapters/m14-google-oauth-sessions";
import { adminAuth } from "./chapters/m14-admin-auth";

// ── Module 16 — Debugging & Observability ────────────────────────────────────
import { readingCallLogs } from "./chapters/m15-reading-call-logs";
import { reliabilityPatterns } from "./chapters/m15-reliability-patterns";

// ── Teacher's Guide — 10-Day Programme ───────────────────────────────────────
import { teachDay01Stt } from "./chapters/tg-day01-stt";

// ── Module 17 — STT Deep Dive ────────────────────────────────────────────────
import { sttPipelinePath } from "./chapters/d1-stt-pipeline-path";
import { sarvamSttComplete } from "./chapters/d1-sarvam-stt-complete";
import { azureSttComplete } from "./chapters/d1-azure-stt-complete";
import { otherSttAdapters } from "./chapters/d1-other-stt-adapters";
import { sttTroubleshooting } from "./chapters/d1-stt-troubleshooting";

// ── Module 18 — TTS Deep Dive ────────────────────────────────────────────────
import { ttsPipelinePath } from "./chapters/d2-tts-pipeline-path";
import { sarvamTtsComplete } from "./chapters/d2-sarvam-tts-complete";
import { cartesiaTtsComplete } from "./chapters/d2-cartesia-tts-complete";
import { otherTtsAdapters } from "./chapters/d2-other-tts-adapters";
import { ttsTroubleshooting } from "./chapters/d2-tts-troubleshooting";

// ── Module 19 — LLM Deep Dive ────────────────────────────────────────────────
import { llmPipelinePath } from "./chapters/d3-llm-pipeline-path";
import { promptAssembly } from "./chapters/d3-prompt-assembly";
import { geminiAdapterComplete } from "./chapters/d3-gemini-adapter-complete";
import { openaiCompatAdapters } from "./chapters/d3-openai-compat-adapters";
import { fallbackAndRetry } from "./chapters/d3-fallback-and-retry";
import { llmTroubleshooting } from "./chapters/d3-llm-troubleshooting";

// ── Module 20 — Telephony Deep Dive ──────────────────────────────────────────
import { vobizStreamComplete } from "./chapters/d4-vobiz-stream-complete";
import { keepaliveAndAudioContinuity } from "./chapters/d4-keepalive-and-audio-continuity";
import { webhooksAndXml } from "./chapters/d4-webhooks-and-xml";
import { numbersAndInboundRouting } from "./chapters/d4-numbers-and-inbound-routing";
import { telephonyTroubleshooting } from "./chapters/d4-telephony-troubleshooting";

// Every chapter is authored. Order within each array defines reading order and
// the module's chapterSlugs (derived below via `.map((c) => c.slug)`).
const mbChapters: Chapter[] = [
  whatIsAVoiceAgent,
  whatIsAnLlm,
  whatIsStt,
  whatIsTts,
  whatIsTelephony,
  whyNodejs,
];

const m0Chapters: Chapter[] = [callJourney, repoMap, howToUseThisBook];

const m1Chapters: Chapter[] = [
  modulesAndImports,
  asyncAwaitPromises,
  buffersAndBinary,
  typescriptTypes,
  classesAndState,
];

const m2Chapters: Chapter[] = [
  drizzleIntro,
  usersAndAgents,
  callsAndProviders,
  callerMemoryTables,
  migrations,
];

const m3Chapters: Chapter[] = [
  expressApp,
  serverBootstrap,
  contractFirstOpenapi,
  middlewareAndAuth,
  routesAnatomy,
];

const m4Chapters: Chapter[] = [
  audioTs,
  sessionAndPipeline,
  endpointing,
  sileroVad,
  bargeInAndEcho,
  turnSafetyNet,
  toolExecution,
  amdVoicemail,
  callRecording,
  postCallAi,
];

const m5Chapters: Chapter[] = [
  adapterPattern,
  sttAdapters,
  llmAdapters,
  ttsAdapters,
  fallbackChains,
  httpKeepalivePool,
];

const m6Chapters: Chapter[] = [
  telephonyOverview,
  twilioDeepDive,
  vobizAndPlivo,
  webcall,
  outboundCalls,
  autoRedial,
  retryEngine,
  callbackScheduling,
  webhooksDeepDive,
];

const m7Chapters: Chapter[] = [
  reactViteApp,
  dataHooks,
  agentBuilder,
  memoryCrmPage,
  schedulingUi,
];

const m8Chapters: Chapter[] = [
  minuteRates,
  scheduling,
  campaigns,
  callerMemory,
  complianceInjection,
  memoryGuards,
];

const m9Chapters: Chapter[] = [
  toolsDispatch,
  knowledgeBase,
  stagedPrompts,
];

const m10Chapters: Chapter[] = [
  walletSystem,
  billingModes,
];

const m11Chapters: Chapter[] = [
  railwayDeployment,
  secretsAndEnv,
  productionOps,
];

const m12Chapters: Chapter[] = [
  genderDetection,
  speakerRecognition,
  inCallSpeakerVerify,
];

const m13Chapters: Chapter[] = [
  languageDetection,
  sarvamDeepDive,
];

const m14Chapters: Chapter[] = [
  googleOauthSessions,
  adminAuth,
];

const m15Chapters: Chapter[] = [
  readingCallLogs,
  reliabilityPatterns,
];

const tgChapters: Chapter[] = [teachDay01Stt];

const d1Chapters: Chapter[] = [
  sttPipelinePath,
  sarvamSttComplete,
  azureSttComplete,
  otherSttAdapters,
  sttTroubleshooting,
];

const d2Chapters: Chapter[] = [
  ttsPipelinePath,
  sarvamTtsComplete,
  cartesiaTtsComplete,
  otherTtsAdapters,
  ttsTroubleshooting,
];

const d3Chapters: Chapter[] = [
  llmPipelinePath,
  promptAssembly,
  geminiAdapterComplete,
  openaiCompatAdapters,
  fallbackAndRetry,
  llmTroubleshooting,
];

const d4Chapters: Chapter[] = [
  vobizStreamComplete,
  keepaliveAndAudioContinuity,
  webhooksAndXml,
  numbersAndInboundRouting,
  telephonyTroubleshooting,
];

export const modules: Module[] = [
  {
    id: "mb", slug: "voice-ai-from-zero", number: "0",
    title: "Voice AI, From Zero",
    tagline: "No jargon, no code — just what voice agents actually are.",
    description:
      "Never heard of an LLM, STT, or telephony? Start here. Five short, plain-English chapters that build the mental model every later module assumes — what a voice agent is and the four jobs it does.",
    icon: "Sparkles",
    chapterSlugs: mbChapters.map((c) => c.slug),
  },
  {
    id: "m0", slug: "orientation", number: "1",
    title: "Orientation",
    tagline: "See the whole machine before touching a single bolt.",
    description:
      "Get the big picture: what SnapServe does, how a phone call flows through it end to end, and where every piece of code lives. Start here.",
    icon: "Compass",
    chapterSlugs: m0Chapters.map((c) => c.slug),
  },
  {
    id: "m1", slug: "foundations", number: "2",
    title: "Node.js & TypeScript Foundations",
    tagline: "The building blocks every later chapter assumes.",
    description:
      "The handful of Node.js and TypeScript ideas the codebase leans on constantly — async, modules, buffers, types, and stateful classes. Skim if you're fluent; don't skip if you're not.",
    icon: "Boxes",
    chapterSlugs: m1Chapters.map((c) => c.slug),
  },
  {
    id: "m2", slug: "database", number: "3",
    title: "The Database Layer",
    tagline: "~50 tables, one source of truth.",
    description:
      "How SnapServe models its world in PostgreSQL using Drizzle ORM: users, agents, calls, providers, caller memory, and how schema changes ship safely.",
    icon: "Database",
    chapterSlugs: m2Chapters.map((c) => c.slug),
  },
  {
    id: "m3", slug: "api-server", number: "4",
    title: "The API Server",
    tagline: "The Express backend that runs everything.",
    description:
      "The brain of the operation: how requests come in, how they're authenticated and validated, and the contract-first flow that keeps frontend and backend in lockstep.",
    icon: "Server",
    chapterSlugs: m3Chapters.map((c) => c.slug),
  },
  {
    id: "m4", slug: "orchestration-engine", number: "5",
    title: "The Orchestration Engine",
    tagline: "The real-time heart of a live call.",
    description:
      "The hardest and most rewarding module. How audio is decoded, how a session drives the turn loop, when the system knows the caller has finished speaking, how tools fire, how calls are recorded, and what happens after the line drops.",
    icon: "Waves",
    chapterSlugs: m4Chapters.map((c) => c.slug),
  },
  {
    id: "m5", slug: "adapters", number: "6",
    title: "The Adapters",
    tagline: "One interface, every AI vendor.",
    description:
      "The pattern that makes SnapServe provider-agnostic. How STT, LLM, and TTS vendors all hide behind a uniform interface the pipeline can call blindly.",
    icon: "Plug",
    chapterSlugs: m5Chapters.map((c) => c.slug),
  },
  {
    id: "m6", slug: "telephony", number: "7",
    title: "Telephony & Web Calls",
    tagline: "Where the phone line meets the code.",
    description:
      "How real phone calls from Twilio, Plivo, and VoBiz — plus browser-based web calls — all become the same stream of audio frames. Plus: how SnapServe makes outbound calls, handles no-answers, and auto-redials dropped conversations.",
    icon: "Phone",
    chapterSlugs: m6Chapters.map((c) => c.slug),
  },
  {
    id: "m7", slug: "frontend", number: "8",
    title: "The Frontend Dashboard",
    tagline: "What the user actually clicks.",
    description:
      "The React dashboard: routing, data fetching through generated hooks, and the agent builder where users assemble their voice pipeline.",
    icon: "LayoutDashboard",
    chapterSlugs: m7Chapters.map((c) => c.slug),
  },
  {
    id: "m8", slug: "supporting-systems", number: "9",
    title: "Supporting Systems",
    tagline: "Billing, scheduling, campaigns & memory.",
    description:
      "The systems built around the call loop that turn a demo into a product: per-call billing, the scheduling engine, outbound campaigns, long-term caller memory, and compliance.",
    icon: "Layers",
    chapterSlugs: m8Chapters.map((c) => c.slug),
  },
  {
    id: "m9", slug: "ai-tools-agentic", number: "10",
    title: "AI Tools & Agentic Behaviour",
    tagline: "When the agent does more than talk.",
    description:
      "How SnapServe agents take real-world actions mid-call: the tool dispatch system, how knowledge bases are built and searched with PostgreSQL FTS, and how the system prompt is staged and managed to stay within the LLM's context budget.",
    icon: "Zap",
    chapterSlugs: m9Chapters.map((c) => c.slug),
  },
  {
    id: "m10", slug: "billing-wallets", number: "11",
    title: "Billing & Wallets",
    tagline: "How every call gets priced and paid for.",
    description:
      "The prepaid wallet model, the append-only transaction ledger, and the dynamic billing mode resolver that determines whether each call is billed at the managed rate or the BYOP orchestration-only rate.",
    icon: "CreditCard",
    chapterSlugs: m10Chapters.map((c) => c.slug),
  },
  {
    id: "m11", slug: "deployment-ops", number: "12",
    title: "Deployment & Operations",
    tagline: "From code edit to production call in minutes.",
    description:
      "How SnapServe ships to production via Docker multi-stage builds and Railway's GitHub-triggered deploys, how secrets are managed, and how to debug production issues, apply schema changes, and run admin scripts safely.",
    icon: "Rocket",
    chapterSlugs: m11Chapters.map((c) => c.slug),
  },
  {
    id: "m12", slug: "speaker-intelligence", number: "13",
    title: "Speaker Intelligence",
    tagline: "The platform that knows who's on the line.",
    description:
      "The Python sidecar that analyses caller voices in real time: MFCC-based gender detection, ECAPA-TDNN speaker recognition for voiceprint enrollment and verification, and in-call mid-conversation speaker change detection for compliance.",
    icon: "Mic",
    chapterSlugs: m12Chapters.map((c) => c.slug),
  },
  {
    id: "m13", slug: "multi-language", number: "14",
    title: "Multi-Language Support",
    tagline: "One agent, ten Indian languages.",
    description:
      "How SnapServe handles callers who switch languages mid-call: Azure's Continuous Language Identification, the Sarvam AI stack (saarika STT, bulbul TTS, sarvam-m1 LLM), language-rule prompt injection, and proper-noun exemptions.",
    icon: "Globe",
    chapterSlugs: m13Chapters.map((c) => c.slug),
  },
  {
    id: "m14", slug: "security-auth", number: "15",
    title: "Security & Auth",
    tagline: "Who you are and what you're allowed to do.",
    description:
      "The complete authentication picture: Google OAuth to HS256 JWT to URL-fragment delivery, the admin token system, impersonation exchange codes, and the security patterns that guard webhooks against forged callbacks.",
    icon: "Shield",
    chapterSlugs: m14Chapters.map((c) => c.slug),
  },
  {
    id: "m15", slug: "debugging-reliability", number: "16",
    title: "Debugging & Reliability",
    tagline: "When things go wrong and how to fix them.",
    description:
      "The diagnostic tools and safety nets baked into SnapServe: reading call execution logs to debug live and historical calls, plus the reliability patterns (recording timeouts, stuck-call sweeps, advisory locks, turn safety nets) that keep production stable.",
    icon: "Bug",
    chapterSlugs: m15Chapters.map((c) => c.slug),
  },
  {
    id: "d1", slug: "stt-deep-dive", number: "17",
    title: "STT Deep Dive",
    tagline: "Every line of the ears — hear it, fix it, tune it.",
    description:
      "The complete speech-to-text stack, line by line: how caller audio reaches STT, the Sarvam and Azure adapters in full, every other adapter's quirks, and a symptom-by-symptom playbook for misheard words, missed replies, and wrong-language transcripts.",
    icon: "Ear",
    chapterSlugs: d1Chapters.map((c) => c.slug),
  },
  {
    id: "d2", slug: "tts-deep-dive", number: "18",
    title: "TTS Deep Dive",
    tagline: "Every line of the voice — synthesis, speed, and clean endings.",
    description:
      "The complete text-to-speech stack, line by line: sentence prefetch pipelining, the Sarvam Bulbul and Cartesia adapters in full, the remaining adapters, and the playbook for clipped endings, mute agents, slow first audio, and choppy playback.",
    icon: "Volume2",
    chapterSlugs: d2Chapters.map((c) => c.slug),
  },
  {
    id: "d3", slug: "llm-deep-dive", number: "19",
    title: "LLM Deep Dive",
    tagline: "Every line of the brain — prompts, streaming, and fallbacks.",
    description:
      "The complete LLM stack, line by line: the turn loop, system prompt assembly and cache ordering, the Gemini adapter in full, the OpenAI-compatible adapters, fallback and retry chains, and the playbook for wrong-language replies, silent turns, and hallucinations.",
    icon: "Brain",
    chapterSlugs: d3Chapters.map((c) => c.slug),
  },
  {
    id: "d4", slug: "telephony-deep-dive", number: "20",
    title: "Telephony Deep Dive",
    tagline: "Every line of the phone line — streams, webhooks, and numbers.",
    description:
      "The complete telephony stack, line by line: the VoBiz audio stream end to end, keepalive and audio continuity, webhooks and XML call control, number routing and inbound canonicalization, and the playbook for dead air, drops, and one-way audio.",
    icon: "PhoneCall",
    chapterSlugs: d4Chapters.map((c) => c.slug),
  },
];

export const allChapters: Chapter[] = [
  ...mbChapters,
  ...m0Chapters,
  ...m1Chapters,
  ...m2Chapters,
  ...m3Chapters,
  ...m4Chapters,
  ...m5Chapters,
  ...m6Chapters,
  ...m7Chapters,
  ...m8Chapters,
  ...m9Chapters,
  ...m10Chapters,
  ...m11Chapters,
  ...m12Chapters,
  ...m13Chapters,
  ...m14Chapters,
  ...m15Chapters,
  ...d1Chapters,
  ...d2Chapters,
  ...d3Chapters,
  ...d4Chapters,
];

// ── Teacher's Guide — separate area at /teach, NOT part of the intern book ───
// These chapters are intentionally excluded from `modules` and `allChapters`
// so they never appear on the Home page, in Search, or in the Exam pool.
export const teacherModule: Module = {
  id: "tg", slug: "teachers-guide", number: "T",
  title: "Teacher's Guide — 10-Day Programme",
  tagline: "Lesson scripts for teaching the team, one day at a time.",
  description:
    "Ready-to-teach lesson plans for the 10-day intern programme. Each day has a timed agenda, plain-English explanations to say aloud, whiteboard diagrams, real code walked line by line, questions to ask the class, and homework.",
  icon: "GraduationCap",
  chapterSlugs: tgChapters.map((c) => c.slug),
};

export const teacherChapters: Chapter[] = tgChapters;

export function getTeacherChapter(slug: string): Chapter | undefined {
  return tgChapters.find((c) => c.slug === slug);
}

export const course: Course = {
  title: "The SnapServe Book",
  subtitle: "Learn the entire VoiceOrch codebase, one file at a time.",
  modules,
  chapters: allChapters,
};

// ── Lookups the UI can use ───────────────────────────────────────────────────
const chaptersBySlug = new Map(allChapters.map((c) => [c.slug, c]));
const modulesById = new Map(modules.map((m) => [m.id, m]));

export function getChapter(slug: string): Chapter | undefined {
  return chaptersBySlug.get(slug);
}

export function getModule(id: string): Module | undefined {
  return modulesById.get(id);
}

export function getChaptersForModule(moduleId: string): Chapter[] {
  const mod = modulesById.get(moduleId);
  if (!mod) return [];
  return mod.chapterSlugs
    .map((s) => chaptersBySlug.get(s))
    .filter((c): c is Chapter => Boolean(c));
}

/** Published-only chapters for a module (used for progress that can reach 100%). */
export function getPublishedChaptersForModule(moduleId: string): Chapter[] {
  return getChaptersForModule(moduleId).filter((c) => c.status === "published");
}

/** Flattened, ordered list of chapters across all modules (for prev/next nav). */
export function getOrderedChapters(): Chapter[] {
  return modules.flatMap((m) => getChaptersForModule(m.id));
}

/** The previous and next *published* chapters relative to a slug. */
export function getChapterNeighbors(slug: string): {
  prev: Chapter | null;
  next: Chapter | null;
} {
  const ordered = getOrderedChapters().filter((c) => c.status === "published");
  const idx = ordered.findIndex((c) => c.slug === slug);
  if (idx === -1) return { prev: null, next: null };
  return {
    prev: idx > 0 ? ordered[idx - 1]! : null,
    next: idx < ordered.length - 1 ? ordered[idx + 1]! : null,
  };
}

export const courseStats = {
  moduleCount: modules.length,
  chapterCount: allChapters.length,
  publishedCount: allChapters.filter((c) => c.status === "published").length,
};
