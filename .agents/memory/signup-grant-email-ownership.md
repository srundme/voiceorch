---
name: Signup-time grants must prove email ownership
description: Any auto-granted privilege keyed by email (pending partner promotions, invites, role pre-assignment) must be gated on a verified-email signup path.
---

**Rule:** an admin-pre-created privilege keyed only by an email string (e.g. `partner_pending_promotions`) must NOT be auto-applied on signup unless the signup path proves the user owns that email. Google Sign-In / Google-session provisioning = proven. Email+password register = NOT proven (this app has no register-time email verification; OTP exists only for password reset) — anyone who knows the email could register it and take the privilege.

**Why:** architect review flagged privilege escalation: attacker registers a pending partner email via password signup → becomes partner (sees base rates, onboards clients).

**How to apply:**
- `applyPendingPartnerPromotion(user, { emailVerified })` — pass `true` only from Google paths; password register passes `false`, leaving the row pending; admin approves via `POST /admin/partners/pending/:id/apply` (UI shows "Approve" when the email now has an account).
- There are THREE user-creation sites that must all call the hook: `middlewares/userProvisioning.ts` (Google session first-touch), `routes/auth.ts` register (new + reactivated-deleted branches), `routes/auth.ts` Google Sign-In. Any new signup-time side effect must cover all of them.
- Consume-the-pending-row must be an atomic claim (`DELETE .. RETURNING` inside the transaction that inserts the grant) — of N racers exactly one wins.
- `users.email` has NO unique constraint and admin edits can store mixed case → email lookups for grants must be `lower(users.email) = <lowercased>`.
