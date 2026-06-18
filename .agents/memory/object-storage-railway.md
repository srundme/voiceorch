---
name: Replit Object Storage unavailable in Railway prod
description: Why recordings moved to Postgres bytea; ambient still broken in prod
---
Replit Object Storage (GCS via the `http://127.0.0.1:1106` sidecar + `DEFAULT_OBJECT_STORAGE_BUCKET_ID`) exists ONLY in the Replit dev container. The Railway/Docker production deployment has neither, so any feature wired to it fails in prod with "Object storage is not configured".

**Decision:** Call recordings are stored as WAV `bytea` in the `call_recordings` Postgres table (separate table so call list/detail queries never load the binary) and served from an authed, Range-capable route. Postgres runs in both dev and prod, so no new services/creds.

**Why:** Postgres was explicitly chosen over external S3/R2 for simplicity.

**Still broken in prod:** the ambient/background-sound feature (`ambient.ts`, `ambient-sounds.ts`) still depends on Replit Object Storage and has the same limitation — out of scope when recordings were migrated, but the same fix pattern applies if it needs prod support.
