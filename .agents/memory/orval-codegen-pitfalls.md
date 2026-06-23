---
name: Orval codegen pitfalls
description: orval 8.9.1 codegen failure modes and fixes in this project
---

## Duplicate OpenAPI schema key breaks codegen silently

`@scalar/json-magic` (used by orval to parse the spec) throws `DUPLICATE_KEY` when `yaml.parse` finds two schemas with the same name in `components/schemas`. The error surfaces as the cryptic "Failed to resolve input: Please provide a valid string value or pass a loader to process the input" message — NOT as a YAML parse error.

**Why:** The `normalize()` helper in `@scalar/json-magic` catches the `yaml.parse` exception, and when `parse` throws `DUPLICATE_KEY`, `normalize` returns `undefined`, causing `resolveContents` to return `{ ok: false }`.

**How to apply:** Before adding schemas to `openapi.yaml`, grep for the name first: `grep -n "^    SchemaName:" lib/api-spec/openapi.yaml`. The existing campaign-leads feature already uses `CallbackItem`, `CallbacksPage`, `CallbackMetrics`, `CallbackLeadInfo` — new scheduled-callback schemas must use `ScheduledCallbackItem`, `ScheduledCallbackListResponse`, `ScheduledCallbackStats`.

## orval 8.9.1 TS config and InputTransformerFn

The `InputTransformerFn` type in orval 8.9.1 causes `jiti` to fail loading the config. Use `orval.config.mjs` (plain ESM) instead of `orval.config.ts`. The package.json `codegen` script now uses `orval --config ./orval.config.mjs`.

**Why:** The `titleTransformer` function passed as `input.override.transformer` is also unnecessary — the YAML already has `title: Api` (do not change this — it controls generated filenames).

## orval clean wipes generated files before generation

orval's `clean: true` output option deletes the generated directory FIRST, then generates. If codegen fails for any reason, the directory is left empty and the api-server build fails (esbuild can't resolve `./generated/api`).

**How to apply:** Always fix codegen failures before restarting the api-server workflow. If the generated files are gone, the api-server build will fail with "Could not resolve `./generated/api`" even though the error is actually in the spec.
