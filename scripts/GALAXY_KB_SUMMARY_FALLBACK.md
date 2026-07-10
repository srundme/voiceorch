# Galaxy KB pinned summary — manual fallback (paste-ready)

Use this ONLY if the seeding script can't be run against production
(`DATABASE_URL=<prod url> pnpm --filter @workspace/scripts run seed-galaxy-kb-summary -- --apply`).

Prerequisite either way: migration `0048_knowledge_entry_pinned` must already be applied
(the `pinned` column exists on `knowledge_entries`), or step 3 will fail.

## Steps (dashboard KB entry flow)

1. Sign in to the dashboard as the Galaxy agent's owner → **Knowledge Base**.
2. Open the Galaxy knowledge source (the one attached to the "Galaxy Final" agent).
3. Click **Add Entry** and paste:
   - **Title** (exact — the seed script upserts by this marker; keep it byte-identical):
     ```
     Galaxy Health — Master Summary (pinned)
     ```
   - **Keywords**:
     ```
     galaxy health, summary, overview, products, plans, discounts, claims, app guide, benefits, wellness, teleconsultation, labs, hospital, pharmacy, waiting period, toll free
     ```
   - **Content**: run `pnpm --filter @workspace/scripts run seed-galaxy-kb-summary -- --print`
     and paste the content block it outputs (source of truth:
     `scripts/src/galaxy-kb-summary-content.ts`). Do not retype it by hand.
4. Save the entry. The embed worker will embed it automatically (embedding starts NULL).
5. The dashboard has no pinned toggle yet, so set the flag with SQL on the production DB:
   ```sql
   UPDATE knowledge_entries
   SET pinned = true
   WHERE title = 'Galaxy Health — Master Summary (pinned)';
   -- expect: UPDATE 1
   ```
6. Verify:
   ```sql
   SELECT id, source_id, pinned, length(content) AS chars
   FROM knowledge_entries
   WHERE title = 'Galaxy Health — Master Summary (pinned)';
   ```
   `pinned` must be `t`. On the next call, the baked KB block and the per-turn
   prefetch fallback will lead with this entry; the call execution log's
   per-turn "Knowledge" event confirms injection (`hit`, `source`, `contextChars`).

## When the source documents change

The summary content is hand-curated from the App User Guide and the Policy
Knowledge Base PDF. Whenever those documents are updated, review and update
`scripts/src/galaxy-kb-summary-content.ts`, then re-run the seed script with
`--apply` (it resets the embedding for re-embed automatically).
