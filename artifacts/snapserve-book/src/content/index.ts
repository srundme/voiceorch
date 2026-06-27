import type { Chapter, Module, Course } from "./types";
import { callJourney } from "./chapters/m0-call-journey";
import { repoMap } from "./chapters/m0-repo-map";
import { buffersAndBinary } from "./chapters/m1-buffers";
import { audioTs } from "./chapters/m4-audio";

// ─────────────────────────────────────────────────────────────────────────────
// Helper to declare a not-yet-written chapter. These still appear in the course
// outline (so learners see the full roadmap) but render a "coming soon" state.
// As chapters are authored, replace the stub with a real imported Chapter.
// ─────────────────────────────────────────────────────────────────────────────
function soon(
  moduleId: string,
  number: string,
  slug: string,
  title: string,
  summary: string,
  estMinutes = 12,
  fileRef?: string,
): Chapter {
  return { moduleId, number, slug, title, summary, estMinutes, fileRef, status: "coming-soon", blocks: [] };
}

// ── Module 0 — Orientation ────────────────────────────────────────────────────
const m0Chapters: Chapter[] = [
  callJourney,
  repoMap,
  soon("m0", "0.3", "how-to-use-this-book", "How to Use This Book",
    "The 5-part lesson rhythm, how the code panels work, and how to track your progress."),
];

// ── Module 1 — Node.js & TypeScript Foundations ──────────────────────────────
const m1Chapters: Chapter[] = [
  soon("m1", "1.1", "modules-and-imports", "Modules, Imports & the Event Loop",
    "How Node loads files, what import/export really do, and why JavaScript can do many things 'at once' on one thread."),
  soon("m1", "1.2", "async-await-promises", "Async, Await & Promises",
    "The single most important pattern in the codebase: doing slow things (network, DB) without freezing everything else."),
  buffersAndBinary,
  soon("m1", "1.4", "typescript-types", "TypeScript: Types Without Tears",
    "Just enough TypeScript to read SnapServe confidently — interfaces, unions, generics, and the `!` and `?` operators."),
  soon("m1", "1.5", "classes-and-state", "Classes & Holding State",
    "When to reach for a class instead of a function, using a real stateful component from the audio engine."),
];

// ── Module 2 — The Database Layer ────────────────────────────────────────────
const m2Chapters: Chapter[] = [
  soon("m2", "2.1", "drizzle-intro", "Meet Drizzle: Tables as TypeScript",
    "How SnapServe defines ~50 database tables in code, and why the schema is the single source of truth.",
    12, "lib/db/src/schema/"),
  soon("m2", "2.2", "users-and-agents", "The Core Tables: Users & Agents",
    "The two tables everything hangs off of, including the repurposed `clerk_id` Google-sub trick.",
    14, "lib/db/src/schema/users.ts"),
  soon("m2", "2.3", "calls-and-providers", "Calls, Providers & Encrypted Keys",
    "How a call is recorded and how user-supplied API keys are stored encrypted at rest.",
    14, "lib/db/src/schema/calls.ts"),
  soon("m2", "2.4", "caller-memory-tables", "Caller Memory: Remembering Who Called",
    "The phone-keyed tables that let an agent greet a returning caller by name.",
    16, "lib/db/src/schema/callerProfiles.ts"),
  soon("m2", "2.5", "migrations", "Migrations: Changing the Schema Safely",
    "How schema changes reach the database in dev and in production without losing data."),
];

// ── Module 3 — The API Server ────────────────────────────────────────────────
const m3Chapters: Chapter[] = [
  soon("m3", "3.1", "express-app", "Express in 20 Minutes",
    "Requests, responses, routers, and middleware — the four ideas the entire backend is built on.",
    14, "artifacts/api-server/src/app.ts"),
  soon("m3", "3.2", "server-bootstrap", "Server Bootstrap: index.ts Line by Line",
    "How the server starts: binding the port, the WebSocket upgrade handler, migrations, and background workers.",
    18, "artifacts/api-server/src/index.ts"),
  soon("m3", "3.3", "contract-first-openapi", "Contract-First: One Spec, Two Codegens",
    "How the OpenAPI file generates both server validation schemas and frontend data hooks.",
    16, "lib/api-spec/openapi.yaml"),
  soon("m3", "3.4", "middleware-and-auth", "Middleware & Authentication",
    "How a request proves who it is — session JWTs, the `attachSession` middleware, and the admin-token boundary.",
    16, "artifacts/api-server/src/middlewares/session.ts"),
  soon("m3", "3.5", "routes-anatomy", "Anatomy of a Route Handler",
    "Reading one real CRUD route end to end: validate input, check ownership, hit the DB, shape the response.",
    14, "artifacts/api-server/src/routes/agents.ts"),
];

// ── Module 4 — The Orchestration Engine ──────────────────────────────────────
const m4Chapters: Chapter[] = [
  audioTs,
  soon("m4", "4.2", "session-and-pipeline", "The Session & the Pipeline",
    "The object that holds one call's entire state, and the loop that drives every conversational turn.",
    20, "artifacts/api-server/src/orchestration/pipeline.ts"),
  soon("m4", "4.3", "endpointing", "Endpointing: Knowing When They're Done",
    "How the system detects the end of a caller's turn without interrupting them or leaving dead air.",
    18, "artifacts/api-server/src/orchestration/endpointing.ts"),
  soon("m4", "4.4", "silero-vad", "Voice Activity Detection with Silero",
    "The neural net that decides 'is this speech or silence?' in real time.",
    14, "artifacts/api-server/src/orchestration/silero-vad.ts"),
];

// ── Module 5 — The Adapters ──────────────────────────────────────────────────
const m5Chapters: Chapter[] = [
  soon("m5", "5.1", "adapter-pattern", "The Adapter Pattern: One Interface, Many Vendors",
    "The design trick that lets SnapServe swap OpenAI for DeepSeek, or Deepgram for Azure, without changing the pipeline.",
    16),
  soon("m5", "5.2", "stt-adapters", "Speech-to-Text Adapters",
    "Streaming transcription over WebSockets — Deepgram, Azure, and the Sarvam Indic-language models.",
    18),
  soon("m5", "5.3", "llm-adapters", "LLM Adapters & Tool Calls",
    "Streaming replies token-by-token, and how the AI triggers actions (booking, transfers) mid-conversation.",
    18),
  soon("m5", "5.4", "tts-adapters", "Text-to-Speech Adapters",
    "Turning the reply into a voice — ElevenLabs, Cartesia, and streaming audio back with minimal latency.",
    16),
  soon("m5", "5.5", "fallback-chains", "Fallback Chains: When a Provider Fails",
    "How the pipeline survives a provider outage mid-call by failing over to a backup.",
    12),
];

// ── Module 6 — Telephony & Web Calls ─────────────────────────────────────────
const m6Chapters: Chapter[] = [
  soon("m6", "6.1", "telephony-overview", "Telephony: The Phone-Network Bridge",
    "How a real phone call becomes a WebSocket of audio frames, and what every provider has in common.",
    14, "artifacts/api-server/src/orchestration/telephony/"),
  soon("m6", "6.2", "twilio-deep-dive", "Twilio, Frame by Frame",
    "Reading the Twilio media-stream protocol and wiring it into the shared pipeline.",
    16, "artifacts/api-server/src/orchestration/telephony/twilio.ts"),
  soon("m6", "6.3", "vobiz-and-plivo", "VoBiz & Plivo",
    "The other two providers, their quirks (byte order, session races), and why audio details matter.",
    14, "artifacts/api-server/src/orchestration/telephony/vobiz.ts"),
  soon("m6", "6.4", "webcall", "Web Calls: Testing in the Browser",
    "The thin WebSocket transport that runs the exact same pipeline from a browser mic — no phone needed.",
    16, "artifacts/api-server/src/orchestration/telephony/webcall.ts"),
];

// ── Module 7 — The Frontend Dashboard ────────────────────────────────────────
const m7Chapters: Chapter[] = [
  soon("m7", "7.1", "react-vite-app", "How the Dashboard Is Built",
    "React + Vite + Wouter routing, and how the frontend talks to the backend through generated hooks.",
    14, "artifacts/dashboard/src/App.tsx"),
  soon("m7", "7.2", "data-hooks", "Data Fetching with Generated Hooks",
    "Using the auto-generated TanStack Query hooks instead of hand-writing fetch calls.",
    12, "lib/api-client-react/src/generated/api.ts"),
  soon("m7", "7.3", "agent-builder", "The Agent Builder",
    "The multi-step form where users wire up an agent's STT + LLM + TTS + telephony pipeline.",
    16, "artifacts/dashboard/src/pages/"),
];

// ── Module 8 — Supporting Systems ────────────────────────────────────────────
const m8Chapters: Chapter[] = [
  soon("m8", "8.1", "minute-rates", "Billing: Managed vs BYOP per Call",
    "How each call's cost and billing mode is resolved at call-end, and where wallet balances live.",
    16, "artifacts/api-server/src/services/minute-rates.ts"),
  soon("m8", "8.2", "scheduling", "The Scheduling Engine",
    "A multi-tenant booking system: calendars, availability, advisory-locked slots, and Google Calendar sync.",
    18, "artifacts/api-server/src/services/scheduling/"),
  soon("m8", "8.3", "campaigns", "Outbound Campaigns",
    "Dialing a list of leads automatically, with retries, scheduling, and answering-machine detection.",
    16),
  soon("m8", "8.4", "caller-memory", "Caller Memory End to End",
    "How facts about a caller are extracted, stored under a canonical phone identity, and recalled next time.",
    18),
];

export const modules: Module[] = [
  {
    id: "m0", slug: "orientation", number: "0",
    title: "Orientation",
    tagline: "See the whole machine before touching a single bolt.",
    description:
      "Get the big picture: what SnapServe does, how a phone call flows through it end to end, and where every piece of code lives. Start here.",
    icon: "Compass",
    chapterSlugs: m0Chapters.map((c) => c.slug),
  },
  {
    id: "m1", slug: "foundations", number: "1",
    title: "Node.js & TypeScript Foundations",
    tagline: "The building blocks every later chapter assumes.",
    description:
      "The handful of Node.js and TypeScript ideas the codebase leans on constantly — async, modules, buffers, types, and stateful classes. Skim if you're fluent; don't skip if you're not.",
    icon: "Boxes",
    chapterSlugs: m1Chapters.map((c) => c.slug),
  },
  {
    id: "m2", slug: "database", number: "2",
    title: "The Database Layer",
    tagline: "~50 tables, one source of truth.",
    description:
      "How SnapServe models its world in PostgreSQL using Drizzle ORM: users, agents, calls, providers, caller memory, and how schema changes ship safely.",
    icon: "Database",
    chapterSlugs: m2Chapters.map((c) => c.slug),
  },
  {
    id: "m3", slug: "api-server", number: "3",
    title: "The API Server",
    tagline: "The Express backend that runs everything.",
    description:
      "The brain of the operation: how requests come in, how they're authenticated and validated, and the contract-first flow that keeps frontend and backend in lockstep.",
    icon: "Server",
    chapterSlugs: m3Chapters.map((c) => c.slug),
  },
  {
    id: "m4", slug: "orchestration-engine", number: "4",
    title: "The Orchestration Engine",
    tagline: "The real-time heart of a live call.",
    description:
      "The hardest and most rewarding module. How audio is decoded, how a session drives the turn loop, and how the system knows when a caller has finished speaking.",
    icon: "Waves",
    chapterSlugs: m4Chapters.map((c) => c.slug),
  },
  {
    id: "m5", slug: "adapters", number: "5",
    title: "The Adapters",
    tagline: "One interface, every AI vendor.",
    description:
      "The pattern that makes SnapServe provider-agnostic. How STT, LLM, and TTS vendors all hide behind a uniform interface the pipeline can call blindly.",
    icon: "Plug",
    chapterSlugs: m5Chapters.map((c) => c.slug),
  },
  {
    id: "m6", slug: "telephony", number: "6",
    title: "Telephony & Web Calls",
    tagline: "Where the phone line meets the code.",
    description:
      "How real phone calls from Twilio, Plivo, and VoBiz — plus browser-based web calls — all become the same stream of audio frames the pipeline consumes.",
    icon: "Phone",
    chapterSlugs: m6Chapters.map((c) => c.slug),
  },
  {
    id: "m7", slug: "frontend", number: "7",
    title: "The Frontend Dashboard",
    tagline: "What the user actually clicks.",
    description:
      "The React dashboard: routing, data fetching through generated hooks, and the agent builder where users assemble their voice pipeline.",
    icon: "LayoutDashboard",
    chapterSlugs: m7Chapters.map((c) => c.slug),
  },
  {
    id: "m8", slug: "supporting-systems", number: "8",
    title: "Supporting Systems",
    tagline: "Billing, scheduling, campaigns & memory.",
    description:
      "The systems built around the call loop that turn a demo into a product: per-call billing, the scheduling engine, outbound campaigns, and long-term caller memory.",
    icon: "Layers",
    chapterSlugs: m8Chapters.map((c) => c.slug),
  },
];

const allChapters: Chapter[] = [
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
