---
name: Soft-deleted account re-signup reactivation
description: How re-signup with a soft-deleted account's email should behave (register + Google OAuth)
---

Soft-delete (`users.status = "deleted"`) never removes the row, so any signup
path that looks up an existing user by `clerkId`/email will find it and can
wrongly treat the email as permanently taken.

**Rule:** on signup flows only (email/password register, Google OAuth
callback's "existing user" branch) — NOT on login — a row with
`status === "deleted"` should be reactivated in place (reset `status` to
`"active"`, clear `suspendedAt`/`suspendedReason`, update name/password as
supplied) instead of blocking with a 409 / `?google_error=account_deleted`.
`suspended` status must NOT get this treatment — suspension is an admin/support
decision and re-signup must keep blocking it.

**Why:** product expectation is "a deleted account's email should be free to
sign up again." Since the row is soft-deleted (not removed), the only way to
honor that without a schema change is to resurrect the same row — which also
avoids unique-constraint conflicts (`clerkId`, `email`, `apiKey`, `orgKey` are
all already taken by the deleted row).

**How to apply:** any new signup entrypoint (email/password, OAuth, magic
link, etc.) that does an existing-user-by-identity lookup must branch on
`status`: `deleted` → reactivate; anything else non-active → block. Login
routes should keep blocking both `deleted` and `suspended` unconditionally.

**Welcome email variant:** a reactivation must send `welcomeBackEmail`
(`services/email-templates.ts`), not the first-time `welcomeEmail` — no
credit-grant mention, and it must NOT set `isNewUser`/fire the "new signup" ad
pixel, since reactivation is not a first-time conversion event.
