/**
 * The SnapServe Book — final exam.
 *
 * The full question bank (including the answer key and explanations) lives here,
 * SERVER-SIDE ONLY. The book frontend never receives `correct`/`explanation`
 * until after it submits, so the exam is a real gatekeeper — you can't read the
 * answers out of the JS bundle. Grading is authoritative on the server.
 *
 * Difficulty is tuned so roughly 1 in 5 first-time takers pass: 30 marks total,
 * pass mark 24 (80%), a 30-minute clock, subtle distractors, and 5 brutal
 * all-or-nothing multi-select questions worth 2 marks each.
 *
 * Questions are grounded in real VoiceOrch behaviour (billing modes, caller
 * memory canonicalization, turn safety-nets, the shared HTTP pool, contract-first
 * codegen, auth, Drizzle gotchas, providers) — all of which the book teaches.
 */

export interface ExamQuestionPublic {
  id: string;
  prompt: string;
  code?: string;
  choices: string[];
  marks: number;
  topic: string;
  /** true => multiple correct answers, all-or-nothing scoring (checkbox UI). */
  multi: boolean;
}

interface ExamQuestion extends ExamQuestionPublic {
  /** index (single) or sorted indices (multi). */
  correct: number | number[];
  explanation: string;
}

export interface ExamGrade {
  score: number;
  total: number;
  passMarks: number;
  passed: boolean;
}

export type ExamAnswerMap = Record<string, number | number[]>;

const RAW_QUESTIONS: ExamQuestion[] = [
  {
    id: "q-billing-default",
    topic: "Billing",
    marks: 1,
    multi: false,
    prompt:
      "A user signs up and creates an agent but never adds any provider API keys in the Providers page. At call-end, what per-minute rate are they billed?",
    choices: [
      "$0.05/min (managed plan)",
      "$0.035/min (BYOP orchestration fee)",
      "Nothing — managed users are free",
      "$0.05 per call regardless of duration",
    ],
    correct: 0,
    explanation:
      "No provider keys → managed plan → $0.05/min. The $0.035/min BYOP rate only applies once the user supplies their own keys for the agent's providers.",
  },
  {
    id: "q-billing-resolve",
    topic: "Billing",
    marks: 1,
    multi: false,
    prompt: "Where and when is an agent's billing mode (managed vs BYOP) decided?",
    choices: [
      "Dynamically at call-end time in minute-rates.ts → resolveAgentBillingMode()",
      "At call-start, from a fixed flag on the agent row",
      "When the user signs up, fixed for the whole account",
      "In the frontend, just before dialing",
    ],
    correct: 0,
    explanation:
      "resolveAgentBillingMode() runs at call-end and checks the providers table for keys matching the agent's ASR/LLM/TTS providers. Any match → BYOP, no match → managed.",
  },
  {
    id: "q-byop-trigger",
    topic: "Billing",
    marks: 1,
    multi: false,
    prompt: "What single condition flips an agent from the managed rate to the BYOP rate?",
    choices: [
      "The user has configured their own key for any of the agent's ASR/LLM/TTS providers",
      "The user toggles a 'BYOP' switch in Settings",
      "An admin enables BYOP for the account",
      "The agent exceeds 100 calls",
    ],
    correct: 0,
    explanation: "It's automatic — a single key match against the agent's providers is enough.",
  },
  {
    id: "q-caller-key-tables",
    topic: "Caller Memory",
    marks: 1,
    multi: false,
    prompt:
      "The three caller-memory tables (caller_profiles, caller_facts, caller_call_archive) are keyed on which composite identity?",
    choices: [
      "(agent_id, canonical phone_number)",
      "(user_id, phone_number)",
      "(call_id)",
      "(agent_id, raw inbound fromNumber)",
    ],
    correct: 0,
    explanation:
      "Keyed on (agent_id, phone_number), where phone_number is the canonical form produced by canonicalizeCallerKey.",
  },
  {
    id: "q-caller-key-why",
    topic: "Caller Memory",
    marks: 1,
    multi: false,
    prompt: "Why must canonicalizeCallerKey() run on BOTH the read and write paths of caller memory?",
    choices: [
      "Otherwise format drift (+ prefix, trunk 0, inbound vs outbound number) misses stored memory and the agent greets a returning caller as a stranger",
      "To encrypt the phone number at rest",
      "To rate-limit repeat callers",
      "To deduplicate calls within a single session",
    ],
    correct: 0,
    explanation:
      "The same number in different formats must collapse to one key, or stored memory is silently missed on the next call.",
  },
  {
    id: "q-webcall-key",
    topic: "Caller Memory",
    marks: 1,
    multi: false,
    prompt: "What caller key does a browser web call use for caller memory?",
    choices: [
      "A synthetic webcall:user_<id> key, passed through unchanged",
      "The browser's IP address",
      "A canonical phone number derived from the account",
      "The agent id",
    ],
    correct: 0,
    explanation:
      "Web calls have no phone number, so they use the synthetic webcall:user_<id> key (canonicalize passes it through unchanged).",
  },
  {
    id: "q-force-finalize",
    topic: "Voice Pipeline",
    marks: 1,
    multi: false,
    prompt: "FORCE_FINALIZE_MS (default 1800) governs which turn safety-net behaviour?",
    choices: [
      "If STT streams partials but never a final, force-finalize the turn from the best partial after this many ms",
      "How long to wait before dialing",
      "Maximum call length before a forced hangup",
      "The TTS sentence-flush interval",
    ],
    correct: 0,
    explanation: "Partials-but-no-final is a known STT failure mode; after FORCE_FINALIZE_MS we finalize from the best partial.",
  },
  {
    id: "q-stall-backstop",
    topic: "Voice Pipeline",
    marks: 1,
    multi: false,
    prompt: "STALL_BACKSTOP_MS (default 15000) does what when NO usable transcript arrives at all?",
    choices: [
      "Speaks a recovery reprompt",
      "Immediately ends the call",
      "Switches the STT provider",
      "Lowers the microphone gain",
    ],
    correct: 0,
    explanation: "If nothing usable arrives, after STALL_BACKSTOP_MS the agent speaks a recovery reprompt rather than hanging silently.",
  },
  {
    id: "q-stall-max",
    topic: "Voice Pipeline",
    marks: 1,
    multi: false,
    prompt: "After STALL_MAX_REPROMPTS (default 2) with continued silence, the safety-net…",
    choices: ["Ends the call", "Reprompts forever", "Plays hold music", "Transfers to a human agent"],
    correct: 0,
    explanation: "Once the reprompt budget is exhausted and silence continues, the call is ended.",
  },
  {
    id: "q-safety-net-state",
    topic: "Voice Pipeline",
    marks: 1,
    multi: false,
    prompt: "The turn safety-net (force-finalize / backstop / reprompts) is active in which state only?",
    choices: [
      "While listening to the caller",
      "During agent TTS playback",
      "At all times, including while dialing",
      "Only after the call has ended",
    ],
    correct: 0,
    explanation: "It is Listening-state-only — it must never fire while the agent itself is speaking.",
  },
  {
    id: "q-http-pool-install",
    topic: "HTTP Pool",
    marks: 1,
    multi: false,
    prompt: "How is the shared HTTP keep-alive pool installed?",
    choices: [
      "One undici Agent via setGlobalDispatcher — process-wide",
      "A custom fetch agent passed into each provider adapter",
      "axios configured with keepAlive: true",
      "Node's http.globalAgent only",
    ],
    correct: 0,
    explanation: "A single undici Agent set with setGlobalDispatcher covers every outbound HTTP call in the process.",
  },
  {
    id: "q-http-pool-timeout",
    topic: "HTTP Pool",
    marks: 1,
    multi: false,
    prompt:
      "The default HTTP_POOL_KEEPALIVE_TIMEOUT_MS is 30000. Why is undici's own 4s default too low here?",
    choices: [
      "Real between-turn gaps (caller pauses, reading out digits) exceed 4s, so the next provider call would re-pay the TCP+TLS handshake",
      "Because the database connection shares the same socket",
      "4s violates the telephony spec",
      "It must match the TTS frame size",
    ],
    correct: 0,
    explanation: "Idle sockets must stay warm across natural pauses, otherwise every turn re-handshakes and adds latency.",
  },
  {
    id: "q-http-pool-ws",
    topic: "HTTP Pool",
    marks: 1,
    multi: false,
    prompt: "Do the WebSocket streaming STT/TTS connections use this global dispatcher?",
    choices: ["No — they are unaffected by it", "Yes, all sockets go through it", "Only TTS does", "Only in production"],
    correct: 0,
    explanation: "The dispatcher covers REST/HTTP only; WebSocket streaming STT/TTS do not use it.",
  },
  {
    id: "q-shutdown-close",
    topic: "HTTP Pool",
    marks: 1,
    multi: false,
    prompt: "On a Railway SIGTERM redeploy, graceful shutdown calls Agent.close() (not destroy()) so that…",
    choices: [
      "In-flight provider calls on a live call finish instead of being killed mid-call",
      "The process exits faster",
      "Sockets are forcibly reset",
      "The DB pool is drained first",
    ],
    correct: 0,
    explanation: "close() lets in-flight requests drain; destroy() would abort a live call's provider requests.",
  },
  {
    id: "q-contract-first",
    topic: "Architecture",
    marks: 1,
    multi: false,
    prompt: "What is the source of truth for every API contract, and what is generated from it?",
    choices: [
      "openapi.yaml → Orval codegen → typed React Query hooks (frontend) + Zod schemas (server)",
      "The Express routes → a generated OpenAPI doc",
      "A Prisma schema → a generated client",
      "A GraphQL SDL → generated resolvers",
    ],
    correct: 0,
    explanation: "Contract-first: openapi.yaml drives Orval, which emits typed hooks for the client and Zod schemas for the server.",
  },
  {
    id: "q-codegen-cmd",
    topic: "Architecture",
    marks: 1,
    multi: false,
    prompt: "After editing openapi.yaml, what must you run before touching backend routes?",
    choices: [
      "pnpm --filter @workspace/api-spec run codegen, then pnpm run typecheck:libs",
      "pnpm run dev at the workspace root",
      "pnpm --filter @workspace/db run push",
      "Nothing — routes pick up spec changes automatically",
    ],
    correct: 0,
    explanation: "Regenerate hooks/Zod schemas, then rebuild the lib declarations so the server sees the new types.",
  },
  {
    id: "q-provider-encryption",
    topic: "Security",
    marks: 1,
    multi: false,
    prompt: "How is a user's provider apiKey stored at rest?",
    choices: [
      "AES-256-GCM encrypted, key derived from SESSION_SECRET; the UI shows only a last-4 hint",
      "Plaintext, but the column is access-controlled",
      "bcrypt-hashed",
      "RSA-encrypted with a public key committed to the repo",
    ],
    correct: 0,
    explanation: "Symmetric AES-256-GCM with a key derived from SESSION_SECRET; only the last-4 hint is ever shown.",
  },
  {
    id: "q-advisory-lock",
    topic: "Scheduling",
    marks: 1,
    multi: false,
    prompt: "What prevents two attendees from booking the same scheduling slot at the same time?",
    choices: [
      "pg_try_advisory_xact_lock (a Postgres transaction-scoped advisory lock)",
      "A UNIQUE constraint on the slot column only",
      "SELECT ... FOR UPDATE on a slots table",
      "An in-memory mutex in Node",
    ],
    correct: 0,
    explanation: "The booking takes a transaction-scoped advisory lock so concurrent bookings serialize instead of double-booking.",
  },
  {
    id: "q-auth-jwt",
    topic: "Auth",
    marks: 1,
    multi: false,
    prompt: "How is an end-user session represented?",
    choices: [
      "A platform-issued HS256 JWT signed with SESSION_SECRET (30-day TTL), carrying the Google sub",
      "A Clerk session token",
      "A random session id stored in a DB sessions table",
      "Google's own id_token used directly as the session",
    ],
    correct: 0,
    explanation: "Auth is standalone Google OAuth; the platform mints its OWN HS256 JWT signed with SESSION_SECRET.",
  },
  {
    id: "q-clerk-id-repurpose",
    topic: "Auth",
    marks: 1,
    multi: false,
    prompt: "The users.clerk_id column was NOT renamed during the Clerk→Google migration. What does it store now?",
    choices: [
      "The Google sub (the column was repurposed)",
      "A Clerk user id still",
      "The session JWT",
      "The user's email address",
    ],
    correct: 0,
    explanation: "clerk_id is repurposed to hold the Google sub, so ~20 route files keep compiling unchanged.",
  },

  /* ── Multi-select, 2 marks each, all-or-nothing ──────────────────────────── */
  {
    id: "m-http-pool",
    topic: "HTTP Pool",
    marks: 2,
    multi: true,
    prompt: "Select ALL statements that are true about the global HTTP dispatcher.",
    choices: [
      "It covers every outbound HTTP call process-wide",
      "WebSocket streaming STT/TTS bypass it",
      "It forces HTTP/2 for provider REST endpoints",
      "Its default idle keep-alive is 30s, well above undici's 4s",
      "Shutdown uses Agent.destroy() to reset sockets immediately",
    ],
    correct: [0, 1, 3],
    explanation:
      "HTTP/2 is deliberately NOT forced (h1 keep-alive only), and shutdown uses close() (not destroy()) so live calls survive.",
  },
  {
    id: "m-drizzle",
    topic: "Database",
    marks: 2,
    multi: true,
    prompt: "Select ALL true Drizzle / migration facts for this repo.",
    choices: [
      "Over-long FK names truncate at 63 chars, which can make drizzle-kit push loop forever",
      "Columns added via raw SQL only (not in the schema) can silently drift and get dropped",
      "bootstrapMigrationJournal executes the SQL of the migrations it seeds",
      "A brand-new table needs a new migration file with a fresh `when` timestamp to actually run",
      "lib/db/drizzle/ must be copied into the production Docker stage or DB queries 500",
    ],
    correct: [0, 1, 3, 4],
    explanation:
      "bootstrapMigrationJournal seeds the journal WITHOUT running the SQL — so a new table/column still needs its own fresh migration file.",
  },
  {
    id: "m-codegen",
    topic: "Architecture",
    marks: 2,
    multi: true,
    prompt: "Select ALL true statements about the contract-first codegen.",
    choices: [
      "openapi.yaml is the single source of truth",
      "Orval generates React Query hooks for the frontend",
      "Orval generates Zod schemas used for server-side validation",
      "You should hand-edit files under lib/api-client-react/src/generated",
      "Changing the OpenAPI info.title changes the generated filenames",
    ],
    correct: [0, 1, 2, 4],
    explanation: "Generated files are never hand-edited; the OpenAPI info.title controls generated filenames.",
  },
  {
    id: "m-caller-mem",
    topic: "Caller Memory",
    marks: 2,
    multi: true,
    prompt: "Select ALL true statements about caller memory.",
    choices: [
      "It is keyed on (agent_id, phone_number)",
      "phone_number must be derived via canonicalizeCallerKey on read AND write",
      "Web calls use a webcall:user_<id> synthetic key",
      "India defaults are country code 91 and national length 10",
      "After a persona swap you can safely keep the prior facts",
    ],
    correct: [0, 1, 2, 3],
    explanation:
      "A persona swap must clear prior facts + DB rows + prior context together, or the first post-swap extraction re-pollutes memory.",
  },
  {
    id: "m-providers",
    topic: "Providers",
    marks: 2,
    multi: true,
    prompt: "Select ALL providers that are valid TTS (text-to-speech) options in VoiceOrch.",
    choices: ["Cartesia", "ElevenLabs", "Deepgram", "DeepSeek", "Twilio"],
    correct: [0, 1, 2],
    explanation:
      "TTS providers: ElevenLabs, OpenAI, AWS Polly, Azure, Cartesia, Deepgram. Deepgram does both ASR and TTS. DeepSeek is an LLM; Twilio is telephony.",
  },
];

// Deterministic per-question choice shuffle. The bank above is authored with the
// correct option(s) first for readability; if we served that order the answer key
// would be trivially guessable ("pick the first option"). We scatter the choices
// with a fixed FNV-1a(id)-seeded LCG so the order is stable across restarts (and
// therefore consistent mid-exam and at grading time) yet not index-0-biased. The
// seed and remapped key never leave the server.
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededPermutation(n: number, seed: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  let s = seed >>> 0;
  for (let i = n - 1; i > 0; i--) {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

const QUESTIONS: ExamQuestion[] = RAW_QUESTIONS.map((q) => {
  const order = seededPermutation(q.choices.length, hashStr(q.id));
  const choices = order.map((i) => q.choices[i]);
  const newIndexOfOld = (oldIdx: number) => order.indexOf(oldIdx);
  const correct = Array.isArray(q.correct)
    ? q.correct.map(newIndexOfOld).sort((a, b) => a - b)
    : newIndexOfOld(q.correct);
  return { ...q, choices, correct };
});

export const EXAM_DURATION_MINUTES = 30;
export const EXAM_PASS_MARKS = 24;
export const EXAM_TOTAL_MARKS = QUESTIONS.reduce((sum, q) => sum + q.marks, 0);

// Fail fast at boot if the bank ever drifts from the intended 30-mark total.
if (EXAM_TOTAL_MARKS !== 30) {
  throw new Error(`book-exam: question bank totals ${EXAM_TOTAL_MARKS} marks, expected 30`);
}

export const EXAM_QUESTION_IDS: ReadonlySet<string> = new Set(QUESTIONS.map((q) => q.id));

export function getPublicQuestions(): ExamQuestionPublic[] {
  return QUESTIONS.map(({ correct: _c, explanation: _e, ...pub }) => pub);
}

/** Drop any answer keyed to an id that isn't in the bank, so unauthenticated
 *  callers can't persist arbitrary jsonb payloads via the public submit route. */
export function filterKnownAnswers(answers: ExamAnswerMap): ExamAnswerMap {
  const out: ExamAnswerMap = {};
  for (const [id, val] of Object.entries(answers)) {
    if (EXAM_QUESTION_IDS.has(id)) out[id] = val;
  }
  return out;
}

function answersMatch(q: ExamQuestion, ans: number | number[] | undefined): boolean {
  if (q.multi) {
    if (!Array.isArray(ans)) return false;
    const got = [...new Set(ans)].sort((a, b) => a - b);
    const want = [...(q.correct as number[])].sort((a, b) => a - b);
    return got.length === want.length && got.every((v, i) => v === want[i]);
  }
  return typeof ans === "number" && ans === q.correct;
}

export function gradeExam(answers: ExamAnswerMap): ExamGrade {
  let score = 0;
  for (const q of QUESTIONS) {
    if (answersMatch(q, answers[q.id])) score += q.marks;
  }
  return {
    score,
    total: EXAM_TOTAL_MARKS,
    passMarks: EXAM_PASS_MARKS,
    passed: score >= EXAM_PASS_MARKS,
  };
}
