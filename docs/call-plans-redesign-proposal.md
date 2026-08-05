# Call plans redesign — proposal

*Response to the brief's Ask for Claude (section 13). Ground truth: current shipped IA as described in `docs/call-plans-claude-redesign-brief.md`.*

**Status:** Phase 1 implemented (UX)  
**Date:** August 2026

---

## 1. What's actually broken (root cause, not symptom list)

The ten friction points in section 7 all trace back to **one design error**: the product asks the user to make the same three decisions twice, in two different UI metaphors, with two different vocabularies.

- **Decision 1 (who to reach)** is made once in Compose (lead source) and asked again in Detail (Leads hero).
- **Decision 2 (what happens)** is made once in Compose (Recipe) and asked again in Detail (step editor) — but the second time it's a totally different UI (individual step rows vs. a named template).
- **Decision 3 (how it starts)** is scattered across Start queue / Start drip / Continue / Pause / Resume, which map to internal engine states (batch cursor, campaign refill, drip cursor) rather than user intent.

Everything else — jargon ("Recipe"), overlapping intake vs. lead-source, two Vibe brands, dense step editor — is a *symptom* of not having committed to a single object model the user builds once and edits in place.

**The fix isn't more polish on Compose or Detail. It's collapsing them into one screen.**

---

## 2. Proposed mental model (unchanged core, tighter frame)

Keep exactly what the brief says must be preserved: agent owns voice, plan owns sequence, timeline not graph, concurrency queue, calling hours, drain/drip. The change is in *how many screens it takes to declare those things*, not what the underlying objects are.

New framing for the user, in one sentence each:

1. **Agent** — who's calling.
2. **Plan** — what happens to each lead, in order.
3. **Leads** — who's getting called.
4. **Start** — turn it on.

This is the same default path (`Agent → Call plan → Leads → Start queue`) the brief already teaches. The redesign makes the *screens* match that sentence instead of splitting step 2 and step 3 into a wizard-then-detail pattern.

---

## 3. New IA: single-screen builder, no Compose/Detail split

### 3.1 `/app/call-plans` (list) — unchanged

Keep as-is. Two CTAs stay: **Build with AI** and **Compose** — but "Compose" now opens directly into the plan builder screen below (skip the 4-step wizard) with a blank/empty state, rather than a separate dialog.

*Implementation note:* Prefer rename of plan CTA per §4.4 ("Suggest a starter") while list CTAs remain two doors.

### 3.2 `/app/call-plans/:id` (the builder — merges Compose + Detail)

One screen, always in the same layout whether the plan is new (`draft`) or existing. No modal-then-navigate. Three stacked sections, top to bottom, each independently save-on-change:

1. **Agent + name** (top bar) — pick agent, name the plan. Collapsed to one line once set.
2. **Who** — Leads attach point. List / Sheet (with Drain/Drip inline, not buried in "more settings") / Paste numbers / Intake (form/Meta). This *is* "lead source" — kill the separate "intake" concept (see 4.3).
3. **What happens** — the step timeline. New plans start with a **starter picked inline** (see 4.1 on Recipe), not a separate wizard step. Editing steps here is the only place steps are ever edited — no duplicate.

**Calling hours** stays in a collapsed "More settings" under section 3, matching current placement — that's genuinely secondary and the brief's own friction list doesn't flag it as confusing, so leave it.

**Start button** is a single primary action in the top bar, labeled contextually: **Start queue** (list/paste), **Start drip** (sheet-live), disabled with a one-line reason if Who or What is incomplete (not a banner elsewhere on the page — put the blocker at the button).

Net effect: creating a plan and editing an existing one are *the same screen doing the same thing*. Nothing to reconcile between "what I picked at create" and "what I see after." This directly kills friction #1 and #9.

### 3.3 `/app/call-plans/:id/activity` — unchanged

The brief doesn't flag Activity as broken. Leave it.

---

## 4. Decisions the brief asked for

### 4.1 Fate of "Recipe" — rename, don't remove

Keep the underlying template mechanism (it's genuinely useful — nobody wants to build "call → miss → WA → wait → call again" from scratch). Kill the word "Recipe" and the idea that it's a one-time create-time choice.

Replace with **starters**, presented as a row of named cards *inside the step timeline itself* when the timeline is empty — "Start from: Lead follow-up · Soft nudge · Sheet drip · Form follow-up · Callback rescue · Blank." Picking one populates real, editable steps. Because it's a starter for an empty list rather than a wizard question, there's no "recipe" object to explain — it's just autofill for an empty timeline, same mental slot as a document template. This also fixes friction #2 (jargon) and #1 (duplication) at once, since there's no longer a separate create-time "recipe" screen to contradict the detail-time step editor.

### 4.2 Build with AI depth — be honest about the ceiling, narrow the promise

Don't try to make it generate arbitrary step graphs from one prompt (that reopens the Zapier-graph question the brief says to avoid, and the brief is right to avoid it — timelines are the product decision). Instead:

- Keep NL → draft → recipe mapping as today, but change the UI copy so it never implies free-form branching logic was built. Something like: *"I'll set this up as a [starter name] and you can adjust the branches after."* Set the expectation before the user hits the disappointment, not after.
- Where the NL prompt clearly describes a Then/Else branch (the brief's own example: "if no answer → WhatsApp, wait 1 day, call again"), have vibe-draft pre-select the starter that already has that shape (`lead_followup`) rather than leaving the user to notice and add an If… step manually. That's a small backend win (better starter-matching heuristic), not new step-graph generation — cheap relative to value.
- Rename the dialog to disambiguate from Agent Vibe (see 4.4).

This keeps Build with AI honest: it's a fast path to a *good starting template*, not a plan compiler. That's a UX-copy fix plus a heuristic-matching improvement, not a rebuild.

### 4.3 Lead source vs. intake — merge into one concept

Kill "intake" as a separate settings-panel idea. A website form or Meta Lead Ads feed is just another **Who** option, same list as CSV list / Sheet / Paste. Present all four as tabs/pills in the Who section:

`List · Sheet · Paste numbers · Form / Meta`

Selecting Form/Meta shows the hook URL and connection status inline, same as Sheet shows Drain/Drip inline. No more "chosen at create" vs. "also available in more settings" split — one place, one set of options, always. This directly resolves friction #4.

### 4.4 Two Vibe brands — rename the plan one

Agent Vibe stays "Vibe" (it's the more mature, standalone builder at `/app/vibe`). Rename the plan-level dialog from "Build with AI" to something that doesn't share a mental slot with Vibe at all — e.g. **"Suggest a starter"** or **"Draft from a sentence."** The goal is that a user who's used Agent Vibe never expects plan Build-with-AI to have the same depth. Naming it differently, not just placing it differently, is what actually prevents the confusion (friction #7).

---

## 5. What to delete / rename / rebuild

| Item | Verdict | Why |
|---|---|---|
| Compose 4-step wizard | **Delete** | Replaced by builder screen (3.2) with inline starter picker |
| "Recipe" as a word/concept | **Rename** → "starter" | Same mechanism, honest framing (4.1) |
| Detail page's separate Leads/steps re-ask | **Delete** | Merged into single builder screen |
| "Intake" as distinct settings panel | **Delete**, folded into Who tabs | 4.3 |
| "Continue" (legacy batch cursor) | **Delete from UI** | Brief says auto-feed replaces it; if backend still needs it, keep server-side only, no user-facing button |
| "Build with AI" (plan) label | **Rename** → "Suggest a starter" or similar | 4.4 |
| Journey/workflow/campaign words | **Keep hidden**, audit for leaks (URLs, table names in error messages) | Brief already flags leak points (`/app/people`, journeys API) — sweep user-visible strings only, don't rename DB tables |
| Timeline step model, If Then/Else, calling hours, drain/drip, concurrency queue | **Keep as-is** | Explicitly preserved per brief section 8, and not flagged as broken |
| Start queue / Start drip / Pause / Resume / Stop drip | **Keep the actions, consolidate the button** | Contextual single primary button (3.2) rather than a button cluster |

---

## 6. Phased plan

### Phase 1 — UX-only (no API changes)

- Merge Compose + Detail into one builder screen, reusing existing `POST /api/journeys` (draft on first Who/What input) and `PATCH /api/journeys/:id` (everything after) — the API already supports incremental edits, this is a frontend restructure of `[id].tsx`, `index.tsx`, `step-editor.tsx`, `lead-sources.tsx`.
- Move starter picker inline into `step-editor.tsx` empty state; delete the standalone Compose recipe step.
- Fold intake into Who tabs (`lead-sources.tsx` already has the plumbing for sheet/list/paste; add form/Meta as a fourth tab reading existing settings fields).
- Rename "Build with AI" dialog copy and title in `plan-vibe-dialog.tsx`; add the pre-hit expectation-setting copy.
- Consolidate header buttons into one contextual Start button + overflow menu for Pause/Resume/Stop drip.
- Sweep user-facing strings for "journey"/"campaign"/"workflow"/"recipe" leaks.

### Phase 2 — needs small API/backend work

- Improve `vibe-draft` heuristic to prefer branch-shaped starters (`lead_followup`) when the prompt describes conditional follow-up, per 4.2.
- Confirm `stepsForTemplate(...)` can be invoked from the inline starter picker without going through the old wizard's create flow (likely already true, needs verification against `journey-presets.ts`).
- Remove "Continue" from any API response the frontend reads for button state, or explicitly mark it internal-only in `journeys.ts`.

### Not recommended

- Rebuilding the step editor as a node-graph canvas — explicitly against the brief's constraint, and none of the ten friction points require it (branching is already possible via If… Then/Else; the complaint in #3 is about *AI depth*, not the editor's own expressiveness).
- Renaming backend tables/routes (`journeys`, `/api/journeys/*`) — internal, no user-facing cost to leaving as-is; brief's own glossary treats this as acceptable ("avoid in UI," not "avoid in code").

---

## 7. Success criteria (non-technical user, <10 minutes)

A user who has already connected a CSV or Sheet should be able to, unaided:

1. From the empty Call plans list, pick **Compose**, land on one screen (not a wizard).
2. Pick an agent (or none if only one exists).
3. Pick **Who** (their list/sheet) — one tab click, no separate dialog.
4. See steps already populated from a starter, or pick a different starter card, without needing to know the word "recipe."
5. Edit one step (e.g., change the WhatsApp wait time) without leaving the screen.
6. Hit **Start queue** and see it's running from the same screen — no navigation to a separate detail page to discover the leads didn't attach.
7. Never encounter the words "journey," "campaign," "workflow," or "recipe" anywhere in the UI.

If steps 1–6 take under 10 minutes for someone who has never used the product, on the first try, without asking what a step means — the redesign has done its job. The specific failure the brief documents today (friction #9: "land on empty Leads section, what do I do next?") should be structurally impossible under this IA, since Who is never empty after Compose — it's asked once, inline, before Start is even enabled.
