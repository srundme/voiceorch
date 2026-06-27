// ─────────────────────────────────────────────────────────────────────────────
// The SnapServe Book — content data model
//
// This file is the CONTRACT between course content (authored as typed data) and
// the rendering UI. Every chapter is an ordered list of `ContentBlock`s. The UI
// renders each block by its `kind`. Adding a new teaching device = add a block
// variant here + a renderer for it.
//
// Inline formatting inside any string: text wrapped in `backticks` is code,
// **double asterisks** is bold. The renderer is responsible for interpreting
// these lightweight markers. Keep it simple — no full markdown.
// ─────────────────────────────────────────────────────────────────────────────

/** A line-by-line annotation attached to a code block. */
export interface LineAnnotation {
  /** Which line(s) this explains, relative to the snippet. "1" or "5-8". */
  lines: string;
  /** Optional short label / the line of code being referenced. */
  label?: string;
  /** Plain-English explanation. Supports `code` and **bold** inline markers. */
  explanation: string;
}

/** A node in a "How it connects" diagram. */
export interface ConnectionNode {
  id: string;
  label: string;
  /** Optional second line, e.g. a file path or a one-word role. */
  sublabel?: string;
  /** If set, clicking this node navigates to that chapter slug. */
  chapterSlug?: string;
  /** Marks THIS file (the subject of the current chapter) so the UI can spotlight it. */
  current?: boolean;
}

/** A directed edge between two connection nodes. */
export interface ConnectionEdge {
  from: string;
  to: string;
  /** Optional label describing what flows along this edge ("μ-law bytes"). */
  label?: string;
}

/** A single quiz question (multiple choice, reveal-on-answer). */
export interface QuizQuestion {
  prompt: string;
  choices: string[];
  /** Index into `choices` of the correct answer. */
  correctIndex: number;
  /** Shown after the learner answers — explains WHY. */
  explanation: string;
}

// ── Content blocks (discriminated union on `kind`) ───────────────────────────

/** Narrative paragraphs. The workhorse for "What & Why" and transitions. */
export interface ProseBlock {
  kind: "prose";
  heading?: string;
  paragraphs: string[];
}

/** A concept explainer — the CS/Node idea you need *before* the code. */
export interface ConceptBlock {
  kind: "concept";
  title: string;
  body: string[];
}

/** A playful, real-world analogy that makes an abstract idea stick. */
export interface AnalogyBlock {
  kind: "analogy";
  title?: string;
  body: string[];
}

/** A side callout. Variant drives the icon/color in the UI. */
export interface CalloutBlock {
  kind: "callout";
  variant: "why" | "tip" | "warning" | "gotcha" | "insight";
  title?: string;
  body: string[];
}

/**
 * The centerpiece: a real code snippet plus optional line-by-line annotations.
 * The UI shows syntax-highlighted code with the annotations alongside; clicking
 * a line scrolls to / highlights its explanation.
 */
export interface CodeBlock {
  kind: "code";
  /** Real path of the file this came from, e.g. "orchestration/audio.ts". */
  filename?: string;
  language: string;
  /** The exact source. Use real code from the repo — never invented. */
  code: string;
  /** Optional sentence introducing the chunk before the code. */
  intro?: string;
  /** Line-by-line walkthrough. Omit for short "just look at this" snippets. */
  lines?: LineAnnotation[];
}

/** A "How it connects" clickable diagram. */
export interface ConnectionsBlock {
  kind: "connections";
  title?: string;
  intro?: string;
  nodes: ConnectionNode[];
  edges: ConnectionEdge[];
}

/** Check-yourself quiz. */
export interface QuizBlock {
  kind: "quiz";
  questions: QuizQuestion[];
}

/** A compact bulleted recap at the end of a chapter. */
export interface KeyTakeawaysBlock {
  kind: "keyTakeaways";
  items: string[];
}

export type ContentBlock =
  | ProseBlock
  | ConceptBlock
  | AnalogyBlock
  | CalloutBlock
  | CodeBlock
  | ConnectionsBlock
  | QuizBlock
  | KeyTakeawaysBlock;

// ── Structural types ─────────────────────────────────────────────────────────

export type ChapterStatus = "published" | "coming-soon";

export interface Chapter {
  /** URL-safe unique id, e.g. "audio-ts". Used in routes: /chapter/:slug */
  slug: string;
  /** Owning module id, e.g. "m4". */
  moduleId: string;
  /** Human chapter number, e.g. "4.1". */
  number: string;
  title: string;
  /** One-sentence hook shown in lists and at the top of the chapter. */
  summary: string;
  /** Real file(s) taught, e.g. "artifacts/api-server/src/orchestration/audio.ts". */
  fileRef?: string;
  /** Rough reading time in minutes. */
  estMinutes: number;
  /** Prerequisite chapter slugs (for "you should read X first"). */
  prerequisites?: string[];
  status: ChapterStatus;
  /** The lesson itself. Empty for coming-soon chapters. */
  blocks: ContentBlock[];
}

export interface Module {
  /** e.g. "m4". */
  id: string;
  /** URL-safe, e.g. "orchestration-engine". */
  slug: string;
  /** Display number, e.g. "4". */
  number: string;
  title: string;
  /** Short punchy tagline for the module card. */
  tagline: string;
  /** A paragraph describing what the module covers. */
  description: string;
  /** lucide-react icon name (the UI maps this to a component). */
  icon: string;
  /** Ordered chapter slugs belonging to this module. */
  chapterSlugs: string[];
}

export interface Course {
  title: string;
  subtitle: string;
  modules: Module[];
  chapters: Chapter[];
}
