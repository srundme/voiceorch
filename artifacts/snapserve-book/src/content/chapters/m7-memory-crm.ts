import type { Chapter } from "../types";

export const memoryCrmPage: Chapter = {
  slug: "memory-crm-page",
  moduleId: "m7",
  number: "8.4",
  title: "The Memory / CRM Page",
  summary:
    "A tour of the caller-centric CRM built into the dashboard — how agent selection, caller lists, the five-tab detail pane, and the Timeline view are wired together from the hook data.",
  estMinutes: 11,
  fileRef: "artifacts/dashboard/src/pages/memory/index.tsx",
  prerequisites: ["data-hooks", "caller-memory"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "One page, three panes",
      paragraphs: [
        "The Memory / CRM page is a three-column layout: a narrow **agent rail** on the left, a **caller list** in the middle, and a **caller detail pane** on the right. The page URL contains both selections as query params (`?agent=123&caller=%2B91...`), so links are shareable and deep-linkable.",
        "The design is deliberately caller-centric, not agent-centric. Agents are a filter — you pick one to scope the caller list. The caller is the subject. This reflects how a support team actually works: they want to know everything about a specific caller, not aggregate statistics about an agent.",
        "All data on this page comes from three hooks: `useCallerProfilesForAgent` (caller list + per-caller counts), `useCallerFacts` (the structured facts the agent has extracted), and `useCallerCallHistory` (the full call archive). No additional API calls are made when switching tabs — the data is fetched once on caller selection and cached by TanStack Query.",
      ],
    },
    {
      kind: "concept",
      title: "The five-tab detail pane",
      body: [
        "**Overview** — the Memory Summary card (the agent's synthesized prose description of the caller), plus a 2-column grid of the most recent facts and a call history preview. This tab is designed to be a 10-second briefing before answering a call.",
        "**Facts** — all extracted facts as chips, with delete buttons. Facts are semi-structured key-value pairs (e.g. `preferred_language: Tamil`). Clicking the trash icon calls `DELETE /api/memory/facts/:id` and invalidates the query cache.",
        "**Episodes** — call summaries as cards. Each episode is a prose paragraph the LLM wrote at call end, capturing what happened in that conversation. Episodes are the human-readable layer above raw transcripts.",
        "**Timeline** — a merged chronological view built entirely from already-fetched data. No new API call. The component merges `callerFacts` (with their `createdAt`) and `episodes` (with their `calledAt`) into a single array, sorts by timestamp, and renders each item with a different icon. This gives a unified history view without a dedicated endpoint.",
        "**Call History** — a full-width table: date, duration, outcome badge, agent name, and a link to the call detail page. Outcome badges use `completed = emerald`, `failed = red`, `cancelled = amber`, everything else neutral.",
      ],
    },
    {
      kind: "code",
      filename: "dashboard/src/pages/memory/index.tsx",
      language: "typescript",
      intro: "The Timeline tab — merging facts and episodes from already-fetched data into a single sorted array.",
      code: `const timelineItems = useMemo(() => {
  const factItems = (callerFacts ?? []).map(f => ({
    kind: "fact" as const,
    at:   new Date(f.createdAt),
    fact: f,
  }));
  const episodeItems = (callerEpisodes ?? []).map(e => ({
    kind:    "episode" as const,
    at:      new Date(e.calledAt ?? e.createdAt),
    episode: e,
  }));
  return [...factItems, ...episodeItems]
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}, [callerFacts, callerEpisodes]);`,
      lines: [
        {
          lines: "2-5",
          label: "fact items",
          explanation:
            "Each fact is wrapped with `kind: 'fact'` for the discriminated union and a `Date` object derived from `f.createdAt`. The `kind` field drives the icon and layout in the render.",
        },
        {
          lines: "6-10",
          label: "episode items",
          explanation:
            "`calledAt` is preferred over `createdAt` for episodes — it represents when the call happened, not when the DB row was written. The `??` fallback handles older episodes that were created before `calledAt` was added to the schema.",
        },
        {
          lines: "11-13",
          label: "merge and sort descending",
          explanation:
            "Spreading both arrays and sorting by `at` descending gives a unified timeline. `useMemo` ensures the sort only re-runs when the source data changes, not on every render.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "Auto-selection and deep-linking",
      paragraphs: [
        "When the page loads with no `?agent=` param, the first agent in the list is auto-selected. When no `?caller=` param is present (or after an agent switch resets the caller list), the first caller is auto-selected. This ensures the detail pane always shows something useful rather than an empty state.",
        "All selection changes update the URL via `setSearchParam` (a Wouter utility). Because the params are in the URL, the back button works correctly and links can be shared: `/memory?agent=123&caller=%2B91987...` drops the recipient directly into that caller's profile.",
        "The agent rail and caller list update their `selected` CSS class by comparing the current URL param to each row's identifier. No component state — the URL IS the state.",
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Why caller phone numbers are URL-encoded in the query param",
      body: [
        "Phone numbers like `+919876543210` contain a `+` character, which in a URL query string means a space. Without encoding, `?caller=+919876543210` is parsed as `caller= 919876543210` — a different string that won't match any DB record.",
        "`encodeURIComponent('+919876543210')` produces `%2B919876543210`. On read, `decodeURIComponent(searchParams.get('caller') ?? '')` restores the `+`. The hooks always work with the decoded, canonical phone number.",
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "The Timeline tab makes no additional API calls when selected. How?",
          choices: [
            "It's loaded lazily on first tab click and cached in component state",
            "It merges already-fetched callerFacts and callerEpisodes arrays in a useMemo — no new hook calls",
            "A single `/api/memory/timeline` endpoint returns a pre-merged list",
            "It reads from a Redux store populated during the Overview tab render",
          ],
          correctIndex: 1,
          explanation:
            "`callerFacts` and `callerEpisodes` are fetched when the caller is selected (not when the tab is clicked). The Timeline tab merges them in `useMemo` at render time — zero additional network requests.",
        },
        {
          prompt: "A user bookmarks the URL `/memory?agent=5&caller=%2B919876543210`. They open it two days later. What happens?",
          choices: [
            "The page loads the agent list and auto-selects the first agent, ignoring the URL params",
            "The page reads the URL params, selects agent 5 and the decoded caller number, and shows that caller's profile",
            "The page shows an error because phone numbers can't be in URLs",
            "The caller list shows all agents' callers because agent 5 might have been deleted",
          ],
          correctIndex: 1,
          explanation:
            "The URL params are the source of truth for selection. On load, the page reads `agent=5` and `caller=%2B919876543210` (decoded to `+919876543210`), fetches data for that agent, and pre-selects that caller. If the agent or caller no longer exists, the auto-selection fallback picks the first available item.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Three-column layout: agent rail (filter) → caller list (subject selection) → caller detail (focus)",
        "URL params hold selection state — back button and shareable links work out of the box",
        "Five tabs: Overview, Facts, Episodes, Timeline, Call History — all served from three hooks, no per-tab fetches",
        "Timeline merges facts + episodes in `useMemo` — cheapest possible joined view",
        "Phone numbers in URL params must be `encodeURIComponent`-encoded — `+` decodes as space",
      ],
    },
  ],
};
