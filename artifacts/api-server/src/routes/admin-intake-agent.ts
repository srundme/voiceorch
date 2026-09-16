/**
 * Admin control panel for the candidate intake inbound agent.
 *
 * Deliberately narrow: the only things an operator can change are the agent
 * name, the LLM, the TTS provider/voice/speed, and which purchased number
 * rings it. The prompt, the tools and the Sarvam English STT stack are fixed
 * in `lib/intake-agent.ts` and re-applied on every save, so an agent created
 * last week behaves exactly like one created today.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  agentsTable,
  phoneNumbersTable,
  usersTable,
  candidateIntakesTable,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { logger } from "../lib/logger.js";
import { intakeFormUrl } from "../lib/intake-service.js";
import { missingIntakeFields } from "../lib/candidate-intake-fields.js";
import { parseIntakeExtra } from "../lib/intake-dispositions.js";
import {
  INTAKE_AGENT_TYPE,
  INTAKE_GREETING,
  INTAKE_LLM_CATALOG,
  INTAKE_LOCKED_AGENT_CONFIG,
  INTAKE_LOCKED_STACK,
  INTAKE_SPEED,
  INTAKE_SYSTEM_PROMPT,
  INTAKE_TTS_CATALOG,
  defaultIntakeControls,
  intakeAgentTools,
  intakeTtsSpec,
  intakeVoiceLabel,
  validateIntakeControls,
  type IntakeAgentControls,
} from "../lib/intake-agent.js";

const router: IRouter = Router();

const ControlsBody = z.object({
  name: z.string().min(1).max(60).optional(),
  llmProvider: z.string().max(40).optional(),
  llmModel: z.string().max(80).optional(),
  ttsProvider: z.string().max(40).optional(),
  ttsVoice: z.string().max(120).optional(),
  ttsSpeed: z.coerce.number().optional(),
});

const CreateBody = ControlsBody.extend({
  /** Clerk id of the account that will own the agent and its intake forms. */
  userId: z.string().min(1).max(120),
  phoneNumberId: z.number().int().positive().nullish(),
});

const AssignBody = z.object({
  phoneNumberId: z.number().int().positive().nullable(),
});

const IdParam = z.object({ id: z.coerce.number().int().positive() });

interface IntakeAgentRow {
  id: number;
  name: string;
  userId: string | null;
  ownerEmail: string | null;
  llmProvider: string;
  llmModel: string | null;
  ttsProvider: string;
  ttsVoice: string | null;
  ttsVoiceLabel: string;
  ttsModel: string | null;
  ttsSpeed: number;
  asrProvider: string;
  asrLanguage: string | null;
  inboundNumber: { id: number; number: string } | null;
  createdAt: string;
}

/** Row values that are re-derived from the controls on every create and save. */
function stackFor(controls: IntakeAgentControls) {
  const tts = intakeTtsSpec(controls.ttsProvider)!;
  return {
    name: controls.name,
    llmProvider: controls.llmProvider,
    llmModel: controls.llmModel,
    ttsProvider: controls.ttsProvider,
    ttsVoice: controls.ttsVoice,
    ttsVoiceName: intakeVoiceLabel(controls.ttsProvider, controls.ttsVoice),
    ttsModel: tts.model,
    systemPrompt: INTAKE_SYSTEM_PROMPT,
    greetingMessage: INTAKE_GREETING,
    tools: intakeAgentTools() as unknown as Record<string, unknown>[],
    ...INTAKE_LOCKED_STACK,
  };
}

async function inboundNumbersFor(agentIds: number[]) {
  if (agentIds.length === 0) return new Map<number, { id: number; number: string }>();
  const rows = await db
    .select({ id: phoneNumbersTable.id, number: phoneNumbersTable.number, agentId: phoneNumbersTable.agentId })
    .from(phoneNumbersTable)
    .where(eq(phoneNumbersTable.service, "voice"));
  const map = new Map<number, { id: number; number: string }>();
  for (const row of rows) {
    if (row.agentId && agentIds.includes(row.agentId)) map.set(row.agentId, { id: row.id, number: row.number });
  }
  return map;
}

function toRow(
  agent: typeof agentsTable.$inferSelect,
  ownerEmail: string | null,
  inbound: { id: number; number: string } | null,
): IntakeAgentRow {
  const config = (agent.agentConfig ?? {}) as { ttsSpeed?: number };
  return {
    id: agent.id,
    name: agent.name,
    userId: agent.userId,
    ownerEmail,
    llmProvider: agent.llmProvider,
    llmModel: agent.llmModel,
    ttsProvider: agent.ttsProvider,
    ttsVoice: agent.ttsVoice,
    ttsVoiceLabel: intakeVoiceLabel(agent.ttsProvider, agent.ttsVoice ?? ""),
    ttsModel: agent.ttsModel,
    ttsSpeed: config.ttsSpeed ?? INTAKE_SPEED.default,
    asrProvider: agent.asrProvider,
    asrLanguage: agent.asrLanguage,
    inboundNumber: inbound,
    createdAt: agent.createdAt?.toISOString() ?? new Date().toISOString(),
  };
}

// ── Options ──────────────────────────────────────────────────────────────────

/** Everything the control panel needs to render, in one round trip. */
router.get("/admin/intake-agents/options", requireAdmin, async (_req, res): Promise<void> => {
  try {
    const numbers = await db
      .select({
        id: phoneNumbersTable.id,
        number: phoneNumbersTable.number,
        userId: phoneNumbersTable.userId,
        agentId: phoneNumbersTable.agentId,
        provider: phoneNumbersTable.provider,
      })
      .from(phoneNumbersTable)
      .where(and(eq(phoneNumbersTable.service, "voice"), eq(phoneNumbersTable.status, "active")))
      .orderBy(desc(phoneNumbersTable.id));

    const assignedTo = new Map<number, string>();
    const agentIds = [...new Set(numbers.map((n) => n.agentId).filter((v): v is number => v != null))];
    if (agentIds.length > 0) {
      const agents = await db
        .select({ id: agentsTable.id, name: agentsTable.name })
        .from(agentsTable);
      for (const a of agents) assignedTo.set(a.id, a.name);
    }

    const ownerEmails = new Map<string, string | null>();
    const ownerRows = await db
      .select({ clerkId: usersTable.clerkId, email: usersTable.email })
      .from(usersTable);
    for (const r of ownerRows) ownerEmails.set(r.clerkId, r.email ?? null);

    res.json({
      llm: INTAKE_LLM_CATALOG,
      tts: INTAKE_TTS_CATALOG,
      speed: INTAKE_SPEED,
      defaults: defaultIntakeControls(),
      locked: {
        asrProvider: INTAKE_LOCKED_STACK.asrProvider,
        asrModel: INTAKE_LOCKED_STACK.asrModel,
        language: INTAKE_LOCKED_STACK.asrLanguage,
        telephonyProvider: INTAKE_LOCKED_STACK.telephonyProvider,
        wordsForInterruption: INTAKE_LOCKED_AGENT_CONFIG.wordsForInterruption,
      },
      phoneNumbers: numbers.map((n) => ({
        id: n.id,
        number: n.number,
        userId: n.userId,
        ownerEmail: ownerEmails.get(n.userId) ?? n.userId,
        provider: n.provider,
        assignedAgentId: n.agentId,
        assignedAgentName: n.agentId ? assignedTo.get(n.agentId) ?? null : null,
      })),
    });
  } catch (err) {
    logger.error({ err }, "intake agent options failed");
    res.status(500).json({ error: "Server error" });
  }
});

// ── List ─────────────────────────────────────────────────────────────────────

router.get("/admin/intake-agents", requireAdmin, async (_req, res): Promise<void> => {
  try {
    const agents = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.agentType, INTAKE_AGENT_TYPE))
      .orderBy(desc(agentsTable.id));

    const inbound = await inboundNumbersFor(agents.map((a) => a.id));
    const ownerIds = [...new Set(agents.map((a) => a.userId).filter((v): v is string => Boolean(v)))];
    const owners = new Map<string, string | null>();
    if (ownerIds.length > 0) {
      const rows = await db
        .select({ clerkId: usersTable.clerkId, email: usersTable.email })
        .from(usersTable);
      for (const r of rows) owners.set(r.clerkId, r.email ?? null);
    }

    res.json(agents.map((a) => toRow(a, a.userId ? owners.get(a.userId) ?? null : null, inbound.get(a.id) ?? null)));
  } catch (err) {
    logger.error({ err }, "intake agent list failed");
    res.status(500).json({ error: "Server error" });
  }
});

// ── Create ───────────────────────────────────────────────────────────────────

router.post("/admin/intake-agents", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", issues: parsed.error.flatten() });
    return;
  }
  const { controls, errors } = validateIntakeControls(parsed.data);
  if (!controls) {
    res.status(400).json({ error: errors.join(" ") });
    return;
  }

  try {
    const [owner] = await db
      .select({ clerkId: usersTable.clerkId })
      .from(usersTable)
      .where(eq(usersTable.clerkId, parsed.data.userId))
      .limit(1);
    if (!owner) {
      res.status(404).json({ error: "Owner account not found" });
      return;
    }

    const [agent] = await db
      .insert(agentsTable)
      .values({
        userId: parsed.data.userId,
        ...stackFor(controls),
        agentConfig: { ...INTAKE_LOCKED_AGENT_CONFIG, ttsSpeed: controls.ttsSpeed },
      })
      .returning();
    if (!agent) {
      res.status(500).json({ error: "Could not create agent" });
      return;
    }

    if (parsed.data.phoneNumberId) {
      const assigned = await assignNumber(agent.id, parsed.data.userId, parsed.data.phoneNumberId);
      if (assigned.error) {
        res.status(201).json({ ...toRow(agent, null, null), warning: assigned.error });
        return;
      }
    }

    const inbound = await inboundNumbersFor([agent.id]);
    res.status(201).json(toRow(agent, null, inbound.get(agent.id) ?? null));
  } catch (err) {
    logger.error({ err }, "intake agent create failed");
    res.status(500).json({ error: "Server error" });
  }
});

// ── Update ───────────────────────────────────────────────────────────────────

router.patch("/admin/intake-agents/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  const parsed = ControlsBody.safeParse(req.body ?? {});
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  try {
    const [existing] = await db
      .select()
      .from(agentsTable)
      .where(and(eq(agentsTable.id, params.data.id), eq(agentsTable.agentType, INTAKE_AGENT_TYPE)))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Intake agent not found" });
      return;
    }

    const currentConfig = (existing.agentConfig ?? {}) as { ttsSpeed?: number };
    // Merge onto what is stored so a partial save cannot silently reset a
    // control the operator did not touch.
    const { controls, errors } = validateIntakeControls({
      name: parsed.data.name ?? existing.name,
      llmProvider: parsed.data.llmProvider ?? existing.llmProvider,
      llmModel: parsed.data.llmModel ?? existing.llmModel ?? undefined,
      ttsProvider: parsed.data.ttsProvider ?? existing.ttsProvider,
      // Switching provider without naming a voice must not keep the old
      // provider's voice — fall back to that provider's first voice instead.
      ttsVoice: parsed.data.ttsVoice
        ?? (parsed.data.ttsProvider && parsed.data.ttsProvider !== existing.ttsProvider
          ? undefined
          : existing.ttsVoice ?? undefined),
      ttsSpeed: parsed.data.ttsSpeed ?? currentConfig.ttsSpeed,
    });
    if (!controls) {
      res.status(400).json({ error: errors.join(" ") });
      return;
    }

    const [agent] = await db
      .update(agentsTable)
      .set({
        ...stackFor(controls),
        agentConfig: {
          ...(existing.agentConfig ?? {}),
          ...INTAKE_LOCKED_AGENT_CONFIG,
          ttsSpeed: controls.ttsSpeed,
        },
      })
      .where(eq(agentsTable.id, params.data.id))
      .returning();
    if (!agent) {
      res.status(404).json({ error: "Intake agent not found" });
      return;
    }

    const inbound = await inboundNumbersFor([agent.id]);
    res.json(toRow(agent, null, inbound.get(agent.id) ?? null));
  } catch (err) {
    logger.error({ err }, "intake agent update failed");
    res.status(500).json({ error: "Server error" });
  }
});

// ── Inbound number ───────────────────────────────────────────────────────────

/**
 * Points a purchased DID at this agent. `phone_numbers.agent_id` is what the
 * inbound webhook looks up, so this one column is the whole binding.
 *
 * Admin may attach any active voice DID — inbound routing does not care who
 * paid for the number, and the demo panel is how we pick a DID the operator
 * already has in hand.
 */
async function assignNumber(
  agentId: number,
  _agentOwnerId: string | null,
  phoneNumberId: number | null,
): Promise<{ error?: string }> {
  await db
    .update(phoneNumbersTable)
    .set({ agentId: null })
    .where(eq(phoneNumbersTable.agentId, agentId));

  if (phoneNumberId == null) return {};

  const [number] = await db
    .select({
      id: phoneNumbersTable.id,
      userId: phoneNumbersTable.userId,
      service: phoneNumbersTable.service,
      status: phoneNumbersTable.status,
    })
    .from(phoneNumbersTable)
    .where(eq(phoneNumbersTable.id, phoneNumberId))
    .limit(1);

  if (!number) return { error: "Phone number not found." };
  if (number.service !== "voice") return { error: "That is a WhatsApp number — it cannot take voice calls." };
  if (number.status !== "active") return { error: "That number is not active." };

  await db
    .update(phoneNumbersTable)
    .set({ agentId })
    .where(eq(phoneNumbersTable.id, phoneNumberId));
  return {};
}

router.post("/admin/intake-agents/:id/phone", requireAdmin, async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  const parsed = AssignBody.safeParse(req.body ?? {});
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const [agent] = await db
      .select({ id: agentsTable.id, userId: agentsTable.userId })
      .from(agentsTable)
      .where(and(eq(agentsTable.id, params.data.id), eq(agentsTable.agentType, INTAKE_AGENT_TYPE)))
      .limit(1);
    if (!agent) {
      res.status(404).json({ error: "Intake agent not found" });
      return;
    }
    const result = await assignNumber(agent.id, agent.userId, parsed.data.phoneNumberId);
    if (result.error) {
      res.status(400).json({ error: result.error });
      return;
    }
    const inbound = await inboundNumbersFor([agent.id]);
    res.json({ inboundNumber: inbound.get(agent.id) ?? null });
  } catch (err) {
    logger.error({ err }, "intake agent phone assign failed");
    res.status(500).json({ error: "Server error" });
  }
});

// ── Live sessions ────────────────────────────────────────────────────────────

/** Recent intake forms for this agent — the demo's "watch it fill" list. */
router.get("/admin/intake-agents/:id/sessions", requireAdmin, async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const rows = await db
      .select()
      .from(candidateIntakesTable)
      .where(eq(candidateIntakesTable.agentId, params.data.id))
      .orderBy(desc(candidateIntakesTable.id))
      .limit(25);

    res.json(rows.map((row) => {
      const extra = parseIntakeExtra(row.extra);
      const name = [row.firstName, row.lastName].filter(Boolean).join(" ");
      return {
        token: row.publicToken,
        formUrl: intakeFormUrl(row.publicToken),
        status: row.status,
        callId: row.callId,
        candidateName: name || null,
        phone: row.phone,
        dispositionId: extra.dispositionId,
        missingCount: missingIntakeFields(row).length,
        proposedCompany: extra.match && typeof extra.match["proposed"] === "object" && extra.match["proposed"]
          ? String((extra.match["proposed"] as Record<string, unknown>)["company"] ?? "")
          : null,
        revision: row.revision,
        updatedAt: row.updatedAt.toISOString(),
      };
    }));
  } catch (err) {
    logger.error({ err }, "intake agent sessions failed");
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
