---
name: Client-side JWT trust vs server-side account revocation
description: Why an already-signed-in tab can look "logged in" after a user is suspended/deleted, and the fix pattern (global 401 handler forces sign-out)
---

A JWT-based SPA that derives `isSignedIn` purely by decoding the locally
stored token (checking only `exp`) has no way to learn the server revoked
that account (suspended/deleted) until a live API call fails. If nothing
reacts to that failure, the app shell keeps rendering as "signed in" and
individual data calls just show per-component error toasts — it looks like
the suspended user still has access even though every fresh login/session
check on the server is already correctly blocking new sign-ins.

**Why:** the server-side status check (session middleware, login route) is
necessary but not sufficient — it only stops *new* logins. It never touches
tabs/sessions that authenticated before the suspension.

**How to apply:** for any app with client-side-cached auth tokens, add a
global "on 401 → force sign-out + redirect to sign-in" hook in the shared
API client (not per-component `onError` handlers), so server-side
revocation propagates to already-open sessions within one API round trip.
Verify server-side blocking (login/session middleware) and this client-side
hook as two separate, both-required layers — fixing only one leaves the gap.
