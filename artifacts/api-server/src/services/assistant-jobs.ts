import { randomUUID } from "node:crypto";
import { callEngineInsertDefaults, db, agentsTable, campaignsTable, phoneNumbersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { attachVoiceNumberToAgent, PhoneAlreadyAssignedError } from "./voice-number-assign.js";
import { logger } from "../lib/logger.js";
import { isCartesiaVoiceId, type JarvisVoice } from "./assistant-voice.js";
import { buildCreatedAgentCopy, normalizeAgentLanguage } from "./assistant-copy.js";

export type AssistantJobType =
  | "navigate"
  | "set_agent_status"
  | "create_campaign"
  | "assign_phone"
  | "create_agent";

export interface AssistantJob {
  type: AssistantJobType;
  label: string;
  href?: string;
  agentId?: number;
  status?: "draft" | "active";
  campaignName?: string;
  phoneNumberId?: number;
  agentName?: string;
  useCase?: string;
  language?: string;
  companyName?: string;
  direction?: "inbound" | "outbound";
  gender?: "male" | "female";
}

export type JobResult = {
  success: boolean;
  message: string;
  navigate?: string;
  agentId?: number;
  campaignId?: number;
};

export const JOB_TYPES = new Set<AssistantJobType>([
  "navigate",
  "set_agent_status",
  "create_campaign",
  "assign_phone",
  "create_agent",
]);

export function sanitizeJobs(raw: unknown): AssistantJob[] {
  if (!Array.isArray(raw)) return [];
  const out: AssistantJob[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const j = item as Record<string, unknown>;
    if (typeof j.type !== "string" || !JOB_TYPES.has(j.type as AssistantJobType)) continue;
    if (typeof j.label !== "string" || !j.label.trim()) continue;
    out.push({
      type: j.type as AssistantJobType,
      label: j.label.trim().slice(0, 80),
      href: typeof j.href === "string" ? j.href : undefined,
      agentId: typeof j.agentId === "number" ? j.agentId : undefined,
      status: j.status === "active" || j.status === "draft" ? j.status : undefined,
      campaignName: typeof j.campaignName === "string" ? j.campaignName.slice(0, 80) : undefined,
      phoneNumberId: typeof j.phoneNumberId === "number" ? j.phoneNumberId : undefined,
      agentName: typeof j.agentName === "string" ? j.agentName.slice(0, 60) : undefined,
      useCase: typeof j.useCase === "string" ? j.useCase.slice(0, 160) : undefined,
      language: typeof j.language === "string" ? j.language : undefined,
      companyName: typeof j.companyName === "string" ? j.companyName.slice(0, 80) : undefined,
      direction: j.direction === "inbound" || j.direction === "outbound" ? j.direction : undefined,
      gender: j.gender === "male" || j.gender === "female" ? j.gender : undefined,
    });
    if (out.length >= 4) break;
  }
  return out;
}

export async function runAssistantJob(
  clerkUserId: string,
  job: AssistantJob,
  jarvisVoice: JarvisVoice,
  ctx: { lastAgentId?: number } = {},
): Promise<JobResult> {
  if (job.type === "navigate") {
    if (!job.href || !job.href.startsWith("/app/")) {
      return { success: false, message: "That page path is not allowed." };
    }
    return { success: true, navigate: job.href, message: "Opening that page." };
  }

  if (job.type === "create_agent") {
    const agentName = (job.agentName ?? "New Agent").trim() || "New Agent";
    const useCase = (job.useCase ?? "general support").trim();
    const companyName = (job.companyName ?? "your business").trim();
    const language = normalizeAgentLanguage(job.language);
    const direction = job.direction === "inbound" ? "inbound" : "outbound";
    const { systemPrompt, greetingMessage } = buildCreatedAgentCopy({
      agentName, useCase, companyName, language,
    });
    const female = job.gender === "female";
    const useJarvisVoice = !female && isCartesiaVoiceId(jarvisVoice.voiceId);
    const ttsVoice = female ? "priya" : (useJarvisVoice ? jarvisVoice.voiceId : "shubh");
    const ttsVoiceName = female ? "Priya" : (useJarvisVoice ? jarvisVoice.voiceName : "Shubh");
    const ttsProvider = isCartesiaVoiceId(ttsVoice) ? "cartesia" : "sarvam";
    const ttsModel = ttsProvider === "cartesia" ? "sonic-3.6" : "bulbul:v3";

    const [row] = await db.insert(agentsTable).values({
      userId: clerkUserId,
      name: agentName,
      description: useCase,
      useCase,
      status: "active",
      asrProvider: "sarvam",
      asrModel: "saaras:v3",
      asrLanguage: language,
      language,
      llmProvider: "sarvam",
      llmModel: "sarvam-105b-conversations",
      ttsProvider,
      ttsModel,
      ttsVoice,
      ttsVoiceName,
      telephonyProvider: "vobiz",
      systemPrompt,
      greetingMessage,
      firstSpeaker: "assistant",
      temperature: 0.4,
      maxDuration: 480,
      silenceTimeoutSeconds: 30,
      backchannelingEnabled: true,
      noiseCancellationEnabled: true,
      agentConfig: {
        ...callEngineInsertDefaults(),
        recordingEnabled: true,
        summarizationEnabled: true,
        languageAutoDetect: true,
        isMultilingual: language.startsWith("ta"),
        direction,
        timezone: "Asia/Kolkata",
        autoRedial: { enabled: direction === "outbound", maxAttempts: 3 },
      } as any,
      tools: [{ type: "end_call", name: "end_call", description: "End the call when the conversation is complete." }],
    } as any).returning({ id: agentsTable.id, name: agentsTable.name });

    logger.info({ agentId: row?.id, name: agentName }, "assistant: created agent");
    return {
      success: true,
      agentId: row?.id,
      navigate: row ? `/app/agents/${row.id}` : "/app/agents",
      message: tamilDone(agentName, language),
    };
  }

  if (job.type === "set_agent_status") {
    if (!job.agentId || (job.status !== "active" && job.status !== "draft")) {
      return { success: false, message: "Agent and status needed." };
    }
    const [agent] = await db
      .select({ id: agentsTable.id, name: agentsTable.name })
      .from(agentsTable)
      .where(and(eq(agentsTable.id, job.agentId), eq(agentsTable.userId, clerkUserId)));
    if (!agent) return { success: false, message: "That agent is not in this workspace." };
    await db.update(agentsTable).set({ status: job.status, updatedAt: new Date() }).where(eq(agentsTable.id, agent.id));
    return {
      success: true,
      agentId: agent.id,
      navigate: `/app/agents/${agent.id}`,
      message: job.status === "active"
        ? `${agent.name || "Agent"} live da. Next call use pannum.`
        : `${agent.name || "Agent"} draft ku shift panniten.`,
    };
  }

  if (job.type === "create_campaign") {
    const name = (job.campaignName ?? "").trim();
    const agentId = job.agentId ?? ctx.lastAgentId;
    if (!agentId || !name) return { success: false, message: "Campaign name and agent needed." };
    const [agent] = await db
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, clerkUserId)));
    if (!agent) return { success: false, message: "That agent is not in this workspace." };
    const [campaign] = await db.insert(campaignsTable).values({
      userId: clerkUserId,
      name,
      agentId: agent.id,
      fieldMappings: { phone: "phone" },
      webhookToken: randomUUID(),
      status: "draft",
      isActive: false,
    }).returning({ id: campaignsTable.id, name: campaignsTable.name });
    return {
      success: true,
      agentId: agent.id,
      campaignId: campaign?.id,
      navigate: campaign ? `/app/campaigns/${campaign.id}` : "/app/campaigns",
      message: `${name} campaign draft ready. Leads import panna open pannu.`,
    };
  }

  if (job.type === "assign_phone") {
    const agentId = job.agentId ?? ctx.lastAgentId;
    if (!agentId || !job.phoneNumberId) return { success: false, message: "Number and agent needed." };
    const [[agent], [phone]] = await Promise.all([
      db.select({ id: agentsTable.id, name: agentsTable.name })
        .from(agentsTable)
        .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, clerkUserId))),
      db.select({
        id: phoneNumbersTable.id,
        number: phoneNumbersTable.number,
        service: phoneNumbersTable.service,
      })
        .from(phoneNumbersTable)
        .where(and(
          eq(phoneNumbersTable.id, job.phoneNumberId),
          eq(phoneNumbersTable.userId, clerkUserId),
          eq(phoneNumbersTable.status, "active"),
        )),
    ]);
    if (!agent) return { success: false, message: "That agent is not in this workspace." };
    if (!phone) return { success: false, message: "That number is not in this workspace." };
    if (phone.service === "whatsapp") {
      return { success: false, message: "Adhu WhatsApp number da — voice DID venum." };
    }
    try {
      await attachVoiceNumberToAgent({
        phoneNumberId: phone.id,
        agentId: agent.id,
        numberOwnerUserId: clerkUserId,
        allowReassign: false,
      });
    } catch (err) {
      if (err instanceof PhoneAlreadyAssignedError) {
        return {
          success: false,
          message: `${phone.number} is already on another agent. Unassign it from Phone Numbers first.`,
        };
      }
      throw err;
    }
    return {
      success: true,
      agentId: agent.id,
      navigate: `/app/agents/${agent.id}`,
      message: `${phone.number} ippo ${agent.name || "agent"} ku ring aagum.`,
    };
  }

  return { success: false, message: "I cannot do that job." };
}

export async function runAssistantJobs(
  clerkUserId: string,
  jobs: AssistantJob[],
  jarvisVoice: JarvisVoice,
): Promise<{ results: JobResult[]; navigate: string | null }> {
  const order = ["create_agent", "assign_phone", "create_campaign", "set_agent_status", "navigate"] as const;
  const sorted = [...jobs].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  const results: JobResult[] = [];
  let lastAgentId: number | undefined;
  let navigate: string | null = null;
  for (const job of sorted) {
    const result = await runAssistantJob(clerkUserId, job, jarvisVoice, { lastAgentId });
    results.push(result);
    if (result.agentId) lastAgentId = result.agentId;
    if (result.success && result.navigate) navigate = result.navigate;
  }
  return { results, navigate };
}

function tamilDone(name: string, language: string): string {
  return language.startsWith("ta")
    ? `${name} ready da. Live vechuten — test call panna sollu.`
    : `${name} is live. Tell me if you want a campaign or a test call.`;
}
