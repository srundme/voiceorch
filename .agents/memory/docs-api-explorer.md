---
name: Docs API Reference explorer
description: The dashboard's docs "API Reference" is spec-driven (auto-generated from openapi.yaml); design constraints and cycle-safety gotchas.
---

# Docs API Reference explorer

The dashboard docs "API Reference" (`artifacts/dashboard/src/pages/docs/api/` + `openapi/`)
is fully auto-generated from `lib/api-spec/openapi.yaml`. Add/change an endpoint in the
spec and it shows up in the explorer automatically — there is no hand-maintained endpoint
list to update. The spec is loaded via a Vite virtual module (`virtual:openapi-spec`) so it
lands in a lazy chunk, not the main bundle.

## "Try it" is copy-only — do NOT add live execution
The "Try it" button copies a cURL scaffold; it never fires a request from the browser.

**Why:** the spec has ~245 operations, many of them mutating or admin-only
(`X-Admin-Token`). A live "execute" button in public-ish docs would let anyone run
destructive/admin calls. This was a deliberate decision (architect-confirmed), not an
oversight. If asked to "make Try it actually work," surface this tradeoff first.

## OpenAPI $refs must be RESOLVED, not filtered
Parameters and responses can be `$ref` objects (e.g. all admin endpoints share
`#/components/parameters/AdminToken`). Early code filtered refs out, which silently
dropped the `X-Admin-Token` header and mis-showed Bearer auth. Always resolve param/
response refs via `resolveRef` before rendering.

## Cycle tracking uses FULL $ref strings, not short names
The schema tree's visited-set keys on the full `$ref` id (`#/components/schemas/Agent`),
exposed as `ResolvedSchema.refId`, NOT the short display name (`Agent`).

**Why:** short names collide and make `seenRefs.has(...)` unreliable; the schema renderer
otherwise over-resolves through ancestor refs. `refName` is display-only; `refId` is the
cycle key. Keep them distinct. There is also a depth cap (`MAX_DEPTH`) as a backstop.

**How to apply:** when touching `openapi/schema.ts` or `api/SchemaTable.tsx`, seed and
extend the visited set with `refId`, never `refName`.
