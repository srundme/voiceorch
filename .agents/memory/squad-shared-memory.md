---
name: Squad-shared memory owner
description: How squad members share one caller memory + voiceprint record
---
All caller-memory and voiceprint reads/writes for a squad member key off a canonical owner agentId from `resolveSquadMemoryOwnerAgentId(agentId, userId, knownSquadId?)` (squad-teamwork.ts): entry member's agent ?? supervisorAgentId ?? min member agentId; solo agents = self.
**Why:** per-agent keying meant squad teammates never recognized a caller another member knew; end-of-call saves were already pinned to memoryOwnerAgentId, but loads/latches/voiceprints used raw agentId.
**How to apply:** any NEW code touching caller_memories/caller_facts/voice_prints must use session.memoryOwnerAgentId / config.memoryOwnerAgentId, never the raw pipeline agent id. Real-time latches (latchCallerName/latchCallerFact) included. personaHash-based persona-swap invalidation must be DISABLED when owner≠answering agent (member prompts differ → false wipes). Prefer the call's known squadId (params.squadId) over membership lookup — multi-squad agents can otherwise bind to the wrong squad. Legacy per-member memories are NOT migrated (cold start under the owner key, accepted).
