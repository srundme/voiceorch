---
name: Planning executeSql hits dev DB, not prod
description: Why a call/record looked up by ID via executeSql can be a totally different row than the production call the user means
---
The `executeSql` callback available in planning/code-execution queries the **development** database. Production runs on a **separate** database (Railway/Postgres), and call/row IDs are NOT shared — the same `calls.id` (e.g. 945) can be an entirely different call in dev vs prod.

**Why:** Once burned — analyzed call #945 via executeSql (got a webcall on agent 127, qwen, 2026-06-17) when the user meant the production call #945 (Live outbound, agent 47, sarvam-30b, 2026-06-29). Wrong root cause.

**How to apply:** When the user references a specific production call/record by ID, trust their attached logs / prod data, NOT executeSql. If you must query, confirm the row matches the user's described provider/date/channel before basing analysis on it. Use the `database` skill with `environment: "production"` for real prod reads.
