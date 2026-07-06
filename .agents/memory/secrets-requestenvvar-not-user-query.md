---
name: Secrets must go through requestEnvVar, not user_query
description: A user pasted a live API key as the answer to a user_query text_query; it landed in plain chat/context instead of the secure secret form.
---

When asking the user to provide an API key, token, or other secret, always call
`requestEnvVar({ requestType: "secret", keys: [...] })` directly — never use
`user_query`/`text_query` to ask for the value.

**Why:** `user_query` answers are plain conversation text and land in the model's
context/chat history. `requestEnvVar` opens a dedicated secure form outside the
chat, so the value never appears in transcripts or context. A user once pasted a
live Gemini API key as the answer to a `text_query`, exposing it in chat before
the mistake was caught and corrected by re-requesting via `requestEnvVar`.

**How to apply:** Any time a task involves "give me your key/token/password",
open with `requestEnvVar` up front. If a secret does end up pasted in plain
chat by mistake, don't echo it back, immediately re-request it via
`requestEnvVar` for secure storage, and suggest the user rotate/revoke the
exposed value out of caution.
