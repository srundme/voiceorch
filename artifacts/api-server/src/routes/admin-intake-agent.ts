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
  callsTable,
  executionLogsTable,
  platformListedVoicesTable,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { logger } from "../lib/logger.js";
import { forgetIntakeCaller, intakeFormUrl } from "../lib/intake-service.js";
import { missingIntakeFields } from "../lib/candidate-intake-fields.js";
import { parseIntakeExtra } from "../lib/intake-dispositions.js";
import { normalizePhone } from "../lib/phone-normalize.js";
import { getSelfBaseUrl } from "../lib/app-domain.js";
import { dialOutboundAgent, OutboundDialError } from "../services/outbound-agent-dial.js";
import {
  INTAKE_AGENT_TYPE,
  INTAKE_GREETING,
  INTAKE_LLM_CATALOG,
  INTAKE_LOCKED_AGENT_CONFIG,
  INTAKE_LOCKED_STACK,
  IRFAN_POD_ASR_MODEL,
  IRFAN_POD_LLM_MODEL,
  IRFAN_POD_PROVIDER,
  IRFAN_POD_TTS_MODEL,
  IRFAN_POD_VOICE,
  intakeUsesPod,
  INTAKE_SPEED,
  INTAKE_SYSTEM_PROMPT,
  INTAKE_TTS_CATALOG,
  applyListedCartesiaVoices,
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

async function listedCartesiaVoices(): Promise<{ value: string; label: string }[]> {
  const rows = await db
    .select({
      voiceId: platformListedVoicesTable.voiceId,
      voiceName: platformListedVoicesTable.voiceName,
    })
    .from(platformListedVoicesTable)
    .where(eq(platformListedVoicesTable.isListed, true))
    .orderBy(platformListedVoicesTable.voiceName);
  return rows.map((r) => ({ value: r.voiceId, label: r.voiceName }));
}

/** Row values that are re-derived from the controls on every create and save. */
function stackFor(
  controls: IntakeAgentControls,
  listedCartesia: { value: string; label: string }[] = [],
) {
  const tts = intakeTtsSpec(controls.ttsProvider)!;
  return {
    name: controls.name,
    llmProvider: controls.llmProvider,
    llmModel: controls.llmModel,
    ttsProvider: controls.ttsProvider,
    ttsVoice: controls.ttsVoice,
    ttsVoiceName: intakeVoiceLabel(controls.ttsProvider, controls.ttsVoice, listedCartesia),
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
    llmProvider: intakeUsesPod() ? IRFAN_POD_PROVIDER : agent.llmProvider,
    llmModel: intakeUsesPod() ? IRFAN_POD_LLM_MODEL : agent.llmModel,
    ttsProvider: intakeUsesPod() ? IRFAN_POD_PROVIDER : agent.ttsProvider,
    ttsVoice: intakeUsesPod() ? IRFAN_POD_VOICE : agent.ttsVoice,
    ttsVoiceLabel: intakeUsesPod()
      ? "Ryan (emotion control)"
      : (agent.ttsVoiceName || intakeVoiceLabel(agent.ttsProvider, agent.ttsVoice ?? "")),
    ttsModel: intakeUsesPod() ? IRFAN_POD_TTS_MODEL : agent.ttsModel,
    ttsSpeed: config.ttsSpeed ?? INTAKE_SPEED.default,
    asrProvider: intakeUsesPod() ? IRFAN_POD_PROVIDER : agent.asrProvider,
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

    const listedCartesia = await listedCartesiaVoices();
    const ownerEmails = new Map<string, string | null>();
    const ownerRows = await db
      .select({ clerkId: usersTable.clerkId, email: usersTable.email })
      .from(usersTable);
    for (const r of ownerRows) ownerEmails.set(r.clerkId, r.email ?? null);

    res.json({
      llm: INTAKE_LLM_CATALOG,
      tts: applyListedCartesiaVoices(INTAKE_TTS_CATALOG, listedCartesia),
      speed: INTAKE_SPEED,
      defaults: defaultIntakeControls(),
      locked: {
        asrProvider: intakeUsesPod() ? IRFAN_POD_PROVIDER : INTAKE_LOCKED_STACK.asrProvider,
        asrModel: intakeUsesPod() ? IRFAN_POD_ASR_MODEL : INTAKE_LOCKED_STACK.asrModel,
        language: INTAKE_LOCKED_STACK.asrLanguage,
        telephonyProvider: INTAKE_LOCKED_STACK.telephonyProvider,
        wordsForInterruption: INTAKE_LOCKED_AGENT_CONFIG.wordsForInterruption,
        callFeel: "balanced",
        backchannel: INTAKE_LOCKED_STACK.backchannelPhrases,
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
        ...stackFor(controls, await listedCartesiaVoices()),
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
        ...stackFor(controls, await listedCartesiaVoices()),
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

const ForgetBody = z.object({
  phone: z.string().min(7).max(32),
});

const OutboundBody = z.object({
  toNumber: z.string().min(7).max(32),
});

function intakeWebhookBase(): string {
  const pinned = (process.env["WEBHOOK_BASE_URL"] ?? "").trim();
  if (pinned) return pinned.replace(/\/+$/, "");
  return getSelfBaseUrl().replace(/\/+$/, "");
}

router.post("/admin/intake-agents/:id/forget-caller", requireAdmin, async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  const parsed = ForgetBody.safeParse(req.body ?? {});
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Need a caller phone number." });
    return;
  }
  try {
    const [agent] = await db
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(and(eq(agentsTable.id, params.data.id), eq(agentsTable.agentType, INTAKE_AGENT_TYPE)))
      .limit(1);
    if (!agent) {
      res.status(404).json({ error: "Intake agent not found" });
      return;
    }
    const result = await forgetIntakeCaller({ agentId: agent.id, phone: parsed.data.phone });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "intake agent forget caller failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
  }
});

router.post("/admin/intake-agents/:id/outbound", requireAdmin, async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  const parsed = OutboundBody.safeParse(req.body ?? {});
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Need a destination phone number." });
    return;
  }
  try {
    const [agent] = await db
      .select({ id: agentsTable.id, userId: agentsTable.userId, name: agentsTable.name })
      .from(agentsTable)
      .where(and(eq(agentsTable.id, params.data.id), eq(agentsTable.agentType, INTAKE_AGENT_TYPE)))
      .limit(1);
    if (!agent) {
      res.status(404).json({ error: "Intake agent not found" });
      return;
    }
    if (!agent.userId) {
      res.status(400).json({ error: "This intake agent has no owner account, so it cannot dial out." });
      return;
    }
    const toNumber = normalizePhone(parsed.data.toNumber);
    if (toNumber.replace(/\D/g, "").length < 10) {
      res.status(400).json({ error: "Enter a full mobile number with country code, e.g. +919876543210." });
      return;
    }
    const result = await dialOutboundAgent({
      userId: agent.userId,
      agentId: agent.id,
      toNumber,
      webhookBaseUrl: intakeWebhookBase(),
      skipDestinationOtp: true,
      metadata: { source: "admin_intake_outbound" },
    });
    res.json({ ...result, toNumber, agentName: agent.name });
  } catch (err) {
    if (err instanceof OutboundDialError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    logger.error({ err }, "intake agent outbound failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
  }
});

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
        dispositionIds: extra.dispositionIds,
        englishRating: extra.english?.rating ?? null,
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

/** Recent voice calls for this intake agent — same records as dashboard Call logs. */
router.get("/admin/intake-agents/:id/calls", requireAdmin, async (req, res): Promise<void> => {
  const params = IdParam.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const [agent] = await db
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(and(eq(agentsTable.id, params.data.id), eq(agentsTable.agentType, INTAKE_AGENT_TYPE)))
      .limit(1);
    if (!agent) {
      res.status(404).json({ error: "Intake agent not found" });
      return;
    }
    const rows = await db
      .select({
        id: callsTable.id,
        status: callsTable.status,
        fromNumber: callsTable.fromNumber,
        toNumber: callsTable.toNumber,
        durationSeconds: callsTable.durationSeconds,
        executionId: callsTable.executionId,
        createdAt: callsTable.createdAt,
      })
      .from(callsTable)
      .where(eq(callsTable.agentId, agent.id))
      .orderBy(desc(callsTable.id))
      .limit(25);
    res.json(rows.map((row) => ({
      ...row,
      createdAt: row.createdAt?.toISOString() ?? null,
    })));
  } catch (err) {
    logger.error({ err }, "intake agent calls failed");
    res.status(500).json({ error: "Server error" });
  }
});

/** Same JSON the dashboard Call log downloads as `call-{id}-logs.json`. */
router.get("/admin/intake-agents/calls/:callId/logs", requireAdmin, async (req, res): Promise<void> => {
  const callId = Number(req.params["callId"]);
  if (!Number.isInteger(callId) || callId <= 0) {
    res.status(400).json({ error: "Invalid call id" });
    return;
  }
  try {
    const [call] = await db
      .select({ id: callsTable.id, agentId: callsTable.agentId })
      .from(callsTable)
      .where(eq(callsTable.id, callId))
      .limit(1);
    if (!call) {
      res.status(404).json({ error: "Call not found" });
      return;
    }
    const [agent] = await db
      .select({ agentType: agentsTable.agentType })
      .from(agentsTable)
      .where(eq(agentsTable.id, call.agentId))
      .limit(1);
    if (agent?.agentType !== INTAKE_AGENT_TYPE) {
      res.status(404).json({ error: "Call not found" });
      return;
    }
    const events = await db
      .select()
      .from(executionLogsTable)
      .where(eq(executionLogsTable.callId, callId))
      .orderBy(executionLogsTable.ts);
    res.json(events);
  } catch (err) {
    logger.error({ err, callId }, "intake agent call logs failed");
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
