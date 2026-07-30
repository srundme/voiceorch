---
name: providers.apiKey must be decrypted at every read site
description: BYO telephony 401s caused by passing the encrypted stored key straight to the carrier
---

The `providers.apiKey` column is AES-256-GCM encrypted (`enc:v1:` prefix, lib/crypto.ts). `decryptKey()` passes plaintext through unchanged, so legacy plaintext keys keep working — which HIDES missing-decrypt bugs until a user with a newly-saved (encrypted) key hits a provider 401.

**Why:** BYO-Plivo outbound dials 401'd with correct credentials — the dial paths (outbound-agent-dial, calls routes dial + transfer, session memory-LLM key) passed `providerRow.apiKey` raw while webhook validation decrypted correctly. Old plaintext rows masked the gap.

**How to apply:** any new code that reads `providersTable.apiKey` (or forwards it to an external API) must wrap it in `decryptKey()`. When a user reports "correct credentials but 401", check for a raw `.apiKey` usage before blaming their key.
