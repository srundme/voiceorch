import type { Chapter, Module, Course } from "./types";

// ── Module 0 — Voice AI, From Zero (true beginner) ───────────────────────────
import { whatIsAVoiceAgent } from "./chapters/mb-what-is-a-voice-agent";
import { whatIsAnLlm } from "./chapters/mb-what-is-an-llm";
import { whatIsStt } from "./chapters/mb-what-is-stt";
import { whatIsTts } from "./chapters/mb-what-is-tts";
import { whatIsTelephony } from "./chapters/mb-what-is-telephony";

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

// ── Module 8 — The Frontend Dashboard ────────────────────────────────────────
import { reactViteApp } from "./chapters/m7-react-vite-app";
import { dataHooks } from "./chapters/m7-data-hooks";
import { agentBuilder } from "./chapters/m7-agent-builder";

// ── Module 9 — Supporting Systems ────────────────────────────────────────────
import { minuteRates } from "./chapters/m8-minute-rates";
import { scheduling } from "./chapters/m8-scheduling";
import { campaigns } from "./chapters/m8-campaigns";
import { callerMemory } from "./chapters/m8-caller-memory";
import { complianceInjection } from "./chapters/m8-compliance-injection";
import { memoryGuards } from "./chapters/m8-memory-guards";

// Every chapter is authored. Order within each array defines reading order and
// the module's chapterSlugs (derived below via `.map((c) => c.slug)`).
const mbChapters: Chapter[] = [
  whatIsAVoiceAgent,
  whatIsAnLlm,
  whatIsStt,
  whatIsTts,
  whatIsTelephony,
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
];

const m5Chapters: Chapter[] = [
  adapterPattern,
  sttAdapters,
  llmAdapters,
  ttsAdapters,
  fallbackChains,
  httpKeepalivePool,
];

const m6Chapters: Chapter[] = [telephonyOverview, twilioDeepDive, vobizAndPlivo, webcall];

const m7Chapters: Chapter[] = [reactViteApp, dataHooks, agentBuilder];

const m8Chapters: Chapter[] = [
  minuteRates,
  scheduling,
  campaigns,
  callerMemory,
  complianceInjection,
  memoryGuards,
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
      "The hardest and most rewarding module. How audio is decoded, how a session drives the turn loop, and how the system knows when a caller has finished speaking.",
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
      "How real phone calls from Twilio, Plivo, and VoBiz — plus browser-based web calls — all become the same stream of audio frames the pipeline consumes.",
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
      "The systems built around the call loop that turn a demo into a product: per-call billing, the scheduling engine, outbound campaigns, and long-term caller memory.",
    icon: "Layers",
    chapterSlugs: m8Chapters.map((c) => c.slug),
  },
];

const allChapters: Chapter[] = [
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
];

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
