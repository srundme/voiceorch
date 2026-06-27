import type { Chapter } from "../types";

export const complianceInjection: Chapter = {
  slug: "compliance-injection",
  moduleId: "m8",
  number: "9.5",
  title: "Compliance as Prompt Injection (TRAI & DPDP)",
  summary:
    "Indian law requires every promotional call to disclose itself and honor opt-outs, and to protect personal data. The clever part: the agent's behaviour is steered by injecting rules into its prompt — backed by deterministic guards that don't trust the LLM.",
  fileRef: "artifacts/api-server/src/services/trai/index.ts",
  estMinutes: 14,
  prerequisites: ["campaigns", "minute-rates"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "Two regulators, two problems",
      paragraphs: [
        "Operating voice agents in India means obeying two regimes. **TRAI** (the Telecom Regulatory Authority of India) governs commercial calls: a promotional call must announce that it's a commercial communication and must let the recipient opt out — say \"STOP\" — and be removed. **DPDP** (the Digital Personal Data Protection Act) governs personal data: callers must be told their data is being processed, that data must be retained only as long as needed, and a person can demand erasure (\"right to be forgotten\").",
        "What makes this interesting from an engineering view is **how** the agent is made to comply. You can't hardcode 'say the disclosure' into a model that generates its own words. So SnapServe takes a two-pronged approach: **steer the LLM by injecting rules into its system prompt**, then **back that up with deterministic code** that doesn't trust the LLM to have obeyed. Read the services on GitHub at `srundme/voiceorch` → `artifacts/api-server/src/services/trai/index.ts` and `.../services/dpdp/index.ts`.",
      ],
    },
    {
      kind: "concept",
      title: "Steering behaviour by injecting into the prompt",
      body: [
        "Recall from Module 0 that the **system prompt** defines what an agent is and how it behaves. Compliance piggybacks on exactly that mechanism: before the call starts, code appends a fixed block of compliance instructions to the agent's base prompt. The LLM then naturally weaves the required disclosure into its opening, in whatever language and tone fits the conversation.",
        "This is elegant because it needs no special 'disclosure feature' in the pipeline — the disclosure is just more prompt. The same trick handles DPDP's data-processing notice. There's a single source of truth for each disclosure string so it's never duplicated.",
      ],
    },
    {
      kind: "code",
      filename: "services/trai/index.ts",
      language: "typescript",
      intro:
        "The TRAI disclosure is appended to the base prompt. Note it's a hard instruction ('MUST say…') plus an explicit rule for handling an opt-out gracefully.",
      code: `export function appendTraiDisclosure(basePrompt: string): string {
  return \`\${basePrompt}\\n\\n[TRAI COMPLIANCE — MANDATORY] As per TRAI regulations for
commercial communications, at the start of every call you MUST say: "This is a commercial
communication. If you wish to stop receiving such calls, please say STOP at any time and we
will immediately remove you from our list." If the caller says STOP or asks to be removed,
apologize sincerely and end the call immediately without any sales pitch.\`;
}`,
      lines: [
        {
          lines: "1",
          label: "it just transforms a string",
          explanation:
            "No magic — it takes the agent's prompt and returns a longer one. The same function is used by session.ts so the disclosure is defined in exactly one place.",
        },
        {
          lines: "2-6",
          label: "instruct, don't implement",
          explanation:
            "The behaviour (say this, and on STOP apologise and end) is expressed as natural-language rules to the LLM, not as pipeline branches. The model decides phrasing and language.",
        },
      ],
    },
    {
      kind: "concept",
      title: "Don't trust the model — verify with code",
      body: [
        "Prompt injection is **soft**: a weak model might forget the disclosure, or might not gracefully honour a caller who asks to be removed. Compliance can't rest on hope. So there's a deterministic layer underneath.",
        "Every finalized transcript is scanned in code for explicit opt-out phrases — things like 'stop calling' or 'stop contacting'. On a match, the number is written to a **suppression list** marked `opted_out`, and a compliance log row is recorded. The next time a campaign tries to dial that number, a pre-dial check sees the suppression entry and refuses — regardless of what any LLM did or didn't say. (A bare \"STOP\" is honoured live by the prompt instruction — the LLM apologises and ends the call — while this phrase scan is what blocks **future** campaign calls.) Soft steering for tone, hard code for the guarantee.",
      ],
    },
    {
      kind: "code",
      filename: "services/trai/index.ts",
      language: "typescript",
      intro:
        "scanForOptOut runs on the transcript. On a match it upserts the number as opted_out — and it is best-effort: it never throws into the call path.",
      code: `export async function scanForOptOut(agentId, callId, phoneNumber, transcript): Promise<boolean> {
  if (!phoneNumber || !transcript) return false;
  const matched = OPT_OUT_PHRASES.some((p) => transcript.toLowerCase().includes(p));
  if (!matched) return false;

  const normalized = normalizePhone(phoneNumber);
  try {
    await db.insert(traiSuppressionListTable)
      .values({ phoneNumber: normalized, status: "opted_out", source: "opt_out_detected" })
      .onConflictDoUpdate({ target: traiSuppressionListTable.phoneNumber,
        set: { status: "opted_out", source: "opt_out_detected", addedAt: new Date() } });
    return true;
  } catch (err) {
    logger.warn({ err }, "Failed to record TRAI opt-out");
    return false;
  }
}`,
      lines: [
        {
          lines: "3",
          label: "deterministic detection",
          explanation:
            "A plain phrase match on the transcript — not an LLM judgement. This is the hard guarantee that complements the soft prompt instruction.",
        },
        {
          lines: "8-11",
          label: "upsert into the suppression list",
          explanation:
            "onConflictDoUpdate makes this idempotent: opting out twice is fine. Once here, the pre-dial check will block all future campaign calls to this number.",
        },
        {
          lines: "13-15",
          label: "best-effort, never throws",
          explanation:
            "A failure to log compliance must not crash a live call. It's caught and logged. This 'never throw into the call path' rule is everywhere in the compliance code.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Compliance is a non-blocking wrapper, never in the hot path",
      body: [
        "A crucial architectural rule: compliance logic is **pre-call and post-call only**. The pre-dial check (is this number suppressed? is it within calling hours?) runs before dialling and can block a call outright; disclosure injection happens when the prompt is assembled; the opt-out scan, PII redaction, retention sweep, and erasure all happen after or outside the live turn loop. None of it sits inside the live STT→LLM→TTS turn loop.",
        "Why? Because the conversational loop is latency-critical and must never be gated on a compliance database write. Compliance wraps the call; it doesn't intrude on it.",
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "DPDP: retention and erasure run on their own schedule",
      body: [
        "DPDP adds three more deterministic jobs alongside its disclosure: a transcript **PII scan** that flags personal data for redaction in analytics; an admin-triggered **erasure** that anonymizes a person's call records on request; and a daily **retention sweep** that anonymizes DPDP-enabled calls older than the configured retention window. All three are best-effort and live outside the call — a person's right to be forgotten is honoured by a background job, not by anything the LLM does mid-conversation.",
      ],
    },
    {
      kind: "connections",
      title: "The two layers of compliance",
      intro: "Soft steering (prompt) and hard guarantees (code) work together around the call.",
      nodes: [
        { id: "prompt", label: "Disclosure injection", sublabel: "soft: into system prompt", current: true },
        { id: "predial", label: "Pre-dial check", sublabel: "hard: block suppressed", chapterSlug: "campaigns" },
        { id: "scan", label: "Opt-out scan", sublabel: "hard: post-call" },
        { id: "dpdp", label: "DPDP jobs", sublabel: "redact / erase / retain" },
        { id: "pipe", label: "The live call", sublabel: "never gated", chapterSlug: "session-and-pipeline" },
      ],
      edges: [
        { from: "predial", to: "pipe", label: "allowed?" },
        { from: "prompt", to: "pipe", label: "prepended" },
        { from: "pipe", to: "scan", label: "transcript" },
        { from: "scan", to: "predial", label: "suppression list" },
        { from: "pipe", to: "dpdp", label: "after call" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "How does the agent get instructed to give the TRAI disclosure?",
          choices: [
            "A special pipeline step plays a pre-recorded message.",
            "Compliance rules are appended to the agent's system prompt, so the LLM weaves the disclosure into its speech naturally.",
            "The telephony provider says it.",
            "A human reads it.",
          ],
          correctIndex: 1,
          explanation:
            "The disclosure is injected into the system prompt. No special pipeline feature is needed — to the model, it's just more instructions.",
        },
        {
          prompt: "Why isn't prompt injection alone enough for opt-out compliance?",
          choices: [
            "It's too slow.",
            "It's soft — a model could forget or miss it — so a deterministic transcript scan + suppression list provides the hard guarantee.",
            "It costs too many tokens.",
            "It only works in English.",
          ],
          correctIndex: 1,
          explanation:
            "Compliance can't depend on the LLM behaving. Code scans for opt-out phrases and writes a suppression entry that a pre-dial check enforces independently of the model.",
        },
        {
          prompt: "Why is all compliance logic kept out of the live STT→LLM→TTS loop?",
          choices: [
            "It's not — it runs inside the loop.",
            "Because the conversational loop is latency-critical; compliance is a pre/post-call wrapper, so it never adds latency inside a live turn.",
            "Because the LLM handles it.",
            "To save database space.",
          ],
          correctIndex: 1,
          explanation:
            "Compliance runs before and after the call (pre-dial check, prompt assembly, post-call scans/jobs) — never in the hot path, so it can't add latency to a turn.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "TRAI governs commercial-call disclosure and opt-out; DPDP governs personal-data notice, retention, and erasure.",
        "Behaviour is steered by injecting compliance rules into the agent's system prompt — no special pipeline feature.",
        "Prompt injection is soft, so deterministic code backs it: a transcript opt-out scan writes a suppression list a pre-dial check enforces.",
        "DPDP adds PII redaction, admin erasure, and a daily retention sweep — all best-effort background jobs.",
        "All compliance is a non-blocking pre/post-call wrapper; it never sits in the latency-critical call loop.",
      ],
    },
  ],
};
