import type { Chapter } from "../types";

export const howToUseThisBook: Chapter = {
  slug: "how-to-use-this-book",
  moduleId: "m0",
  number: "0.3",
  title: "How to Use This Book",
  summary:
    "The 5-part lesson rhythm, how the code panels work, and how to track your progress.",
  estMinutes: 12,
  prerequisites: ["the-call-journey", "the-repo-map"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "SnapServe is a big, real, production codebase — over a hundred thousand lines that run live phone calls between humans and AI. That can feel intimidating. This book exists to make it **feel small**, one file at a time.",
        "Every chapter teaches exactly one idea or one real file from the repo, in the same predictable shape. Once you know the shape, you can move fast: you'll know where the analogy is, where the real code is, and where to test yourself. This short chapter teaches you that shape so the other forty don't surprise you.",
      ],
    },
    {
      kind: "concept",
      title: "The 5-part rhythm of every chapter",
      body: [
        "Every lesson is built from the same ordered beats, so your brain always knows what's coming next:",
        "**1. What & Why** — a plain-language hook. Why does this file or idea exist? What breaks without it? You read this first, before any code.",
        "**2. Concept & Analogy** — the computer-science idea taught *before* you see the code, always with a real-world analogy (a restaurant kitchen, a zip code, an egg carton) so the abstract thing sticks.",
        "**3. The Code** — the centerpiece. Real code copied verbatim from the repo, broken into bite-size blocks, each with a line-by-line walkthrough. This is where most of the learning happens.",
        "**4. How It Connects** — a clickable diagram showing where this file sits in the bigger machine, with links to the chapters around it.",
        "**5. Quiz & Key Takeaways** — a couple of check-yourself questions, then a tight bullet recap you can re-read in 30 seconds before moving on.",
      ],
    },
    {
      kind: "analogy",
      title: "Each chapter is a guided museum tour",
      body: [
        "Imagine a museum guide who always works the same way. First they tell you *why* a painting matters (What & Why). Then they explain the technique in everyday words (Concept & Analogy). Then they walk you right up to the canvas and point at each brushstroke (The Code). Then they show you which room to visit next (How It Connects). Finally they quiz you at the gift shop (Quiz & Takeaways).",
        "Because the tour is always the same shape, you stop worrying about the *format* and spend all your attention on the *art* — which here is the real SnapServe code.",
      ],
    },
    {
      kind: "concept",
      title: "How the code panels work",
      body: [
        "The code you see in this book is never invented or simplified-into-fiction. It is the **actual source** of SnapServe, pasted in unchanged (sometimes trimmed, with `// …` marking a snip).",
        "Each code block comes with line-by-line annotations. An annotation points at a line (or a range like `5-8`), gives it a short label, and explains it in plain English. Clicking a line highlights its explanation, so you can read code and prose side by side instead of scrolling back and forth.",
        "Inside any explanation, text wrapped in `backticks` is code or an identifier, and text in **bold** is emphasis. That's the entire formatting vocabulary — deliberately tiny so nothing distracts from the lesson.",
      ],
    },
    {
      kind: "code",
      filename: "src/content/types.ts",
      language: "typescript",
      intro:
        "This book is itself a small program: every chapter is typed data, and a line annotation is literally this shape from the book's own source. Here is the real type that powers the code panels you'll read all course.",
      code: `export interface LineAnnotation {
  lines: string;
  label?: string;
  explanation: string;
}`,
      lines: [
        {
          lines: "2",
          label: "lines: string",
          explanation:
            "Which line(s) of the snippet this annotation explains — `\"1\"` for a single line or `\"5-8\"` for a range. The numbers are relative to the snippet, not the original file.",
        },
        {
          lines: "3",
          label: "label?: string",
          explanation:
            "The `?` means **optional** — a short headline for the line, like the line of code itself. You'll learn what `?` means properly in the TypeScript chapter.",
        },
        {
          lines: "4",
          label: "explanation: string",
          explanation:
            "The plain-English walkthrough — exactly the kind of text you're reading right now. This is where the teaching lives.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "The connections diagram is clickable",
      body: [
        "In the 'How It Connects' diagram near the end of each chapter, the box for the current file is spotlighted, and any box that maps to another chapter is a link.",
        "Use it like a subway map: when a chapter mentions the STT adapter or the session object, click straight through to that chapter, skim it, then come back. You don't have to read the book strictly front-to-back.",
      ],
    },
    {
      kind: "concept",
      title: "Tracking your progress",
      body: [
        "The book remembers what you've finished. When you mark a chapter complete, it's saved in your browser, and each module shows a progress bar so you can see how far you've come.",
        "Your quiz answers are saved too, so a chapter you revisit still shows what you picked. Nothing is sent to a server — it all lives locally on your machine.",
      ],
    },
    {
      kind: "code",
      filename: "src/hooks/use-progress.ts",
      language: "typescript",
      intro:
        "The percentage you see on each module card comes from this real function in the book's progress store — a nice first look at code you'll soon read fluently.",
      code: `getModuleProgress: (chapterSlugs) => {
  const completed = chapterSlugs.filter((slug) => get().completedChapters.includes(slug)).length;
  const total = chapterSlugs.length;
  return {
    completed,
    total,
    percentage: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
},`,
      lines: [
        {
          lines: "2",
          label: "count the completed ones",
          explanation:
            "Take the module's chapter slugs, keep only the ones in your `completedChapters` list, and count them. That's how many you've finished.",
        },
        {
          lines: "3",
          label: "total = how many chapters",
          explanation:
            "The denominator — how many chapters the module has in total.",
        },
        {
          lines: "7",
          label: "percentage",
          explanation:
            "Completed ÷ total, rounded to a whole number. The `total === 0 ? 0 : …` guard avoids dividing by zero for an empty module — a tiny but important safety check you'll see everywhere.",
        },
      ],
    },
    {
      kind: "connections",
      title: "Your route through the book",
      intro:
        "You're in Module 0 (Orientation). From here the book builds upward: foundations first, then the database, server, and the real-time call engine. Click ahead to peek.",
      nodes: [
        { id: "guide", label: "How to Use This Book", sublabel: "you are here", current: true },
        { id: "journey", label: "The Call Journey", sublabel: "the big-picture map", chapterSlug: "the-call-journey" },
        { id: "repo", label: "The Repo Map", sublabel: "where code lives", chapterSlug: "the-repo-map" },
        { id: "foundations", label: "Foundations", sublabel: "modules, async, types", chapterSlug: "modules-and-imports" },
        { id: "audio", label: "audio.ts", sublabel: "the gold-standard chapter", chapterSlug: "audio-ts" },
      ],
      edges: [
        { from: "journey", to: "repo", label: "then" },
        { from: "repo", to: "guide", label: "then" },
        { from: "guide", to: "foundations", label: "start learning" },
        { from: "foundations", to: "audio", label: "builds toward" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "In the 5-part rhythm, when do you first see real code?",
          choices: [
            "Right at the very top, before any explanation.",
            "After the What & Why and the Concept & Analogy — the code is the centerpiece in the middle.",
            "Only in the quiz.",
            "Never — the book paraphrases all code.",
          ],
          correctIndex: 1,
          explanation:
            "You always get the why and the concept first, then the real code with line-by-line annotations, then connections and a quiz. Code is taught, not dumped.",
        },
        {
          prompt: "Is the code shown in this book real or simplified for teaching?",
          choices: [
            "Invented examples written just for the book.",
            "Real source copied verbatim from the repo, sometimes trimmed with `// …`.",
            "Pseudocode only.",
            "Auto-generated and possibly wrong.",
          ],
          correctIndex: 1,
          explanation:
            "Every code block is real SnapServe source. It may be excerpted, but every line shown actually exists in the codebase.",
        },
        {
          prompt: "Where is your chapter-completion progress stored?",
          choices: [
            "On a SnapServe server.",
            "In a database table.",
            "Locally in your own browser.",
            "It isn't stored at all.",
          ],
          correctIndex: 2,
          explanation:
            "Progress and quiz answers persist in your browser via the local progress store — nothing leaves your machine.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Every chapter follows the same 5-part rhythm: What & Why → Concept & Analogy → Code → How It Connects → Quiz & Takeaways.",
        "All code is real, copied verbatim from the repo, with clickable line-by-line annotations.",
        "Only two inline markers exist: `backticks` for code and **bold** for emphasis.",
        "Connections diagrams are clickable — jump around like a subway map instead of reading strictly in order.",
        "Your progress and quiz answers are saved locally in your browser, with a per-module progress bar.",
      ],
    },
  ],
};
