---
name: Dashboard agent form schema is shared (edit + create wizard)
description: edit.schema.ts / AgentFormValues / buildUpdateAgentPayload are shared between edit.tsx and builder.tsx — removing a field breaks the wizard
---

The dashboard agent form contract is shared across two surfaces:
`artifacts/dashboard/src/pages/agents/edit.schema.ts` (the `agentFormSchema` / `AgentFormValues` type) and `buildUpdateAgentPayload` (exported from `edit.tsx`) are imported by BOTH `edit.tsx` (Edit Agent page) AND `builder.tsx` (the Create Wizard).

**Rule:** Do not remove or rename a field on `agentFormSchema` just to change one surface. The Create Wizard (`builder.tsx`) sets/reads many of the same fields in its own `defaultValues`/`form.reset` and will fail to typecheck if a field disappears from the schema.

**Why:** A task asked to remove the Greeting Message field from the Edit page's Prompt tab "including the form schema". Doing so broke `builder.tsx` typecheck (it still has its own greeting field). The fix: keep the field optional in the shared schema and only drop it from the target surface's UI/defaults/reset (the edit form simply never sets it, so it isn't sent and the existing DB value is preserved).

**How to apply:** To remove a field from only one of the two forms, leave it `.optional()` in `agentFormSchema`, remove its `FormField`/defaults/reset from that one page, and rely on the field being absent from that form's `data` so `buildUpdateAgentPayload`'s `...rest` spread never emits it.
