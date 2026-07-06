---
name: Meta Pixel CompleteRegistration new-account signal
description: How to fire CompleteRegistration only for brand-new accounts (not logins) across Google OAuth and email/password flows
---

Client-side "just signed in" is NOT the same signal as "just created a new
account" — a returning user's Google sign-in looks identical client-side to a
first-time signup (both deliver a fresh session token via the same redirect
path). Firing a signup pixel event off "token just arrived" alone fires it on
every login too.

**Why:** Only the backend knows whether it inserted a new `users` row or found
an existing one, so the "new account" signal must be threaded from server to
client explicitly — it cannot be inferred from the token/session alone.

**How to apply:** For OAuth-style flows, have the server append an explicit
one-shot flag to the post-auth redirect (e.g. `&new_user=1`) set only in the
code path that just did the INSERT; the client gates the conversion-tracking
call on that flag. For a dedicated register endpoint that 409s on existing
email, success (200) IS inherently new-account-only — no extra flag needed
there, just don't call the same tracker from the login endpoint's success path.
