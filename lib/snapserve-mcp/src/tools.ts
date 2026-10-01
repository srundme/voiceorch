import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SnapServeClient } from "./client.js";
import { asArray, maskSecret, page, pick, run, truncateText } from "./format.js";

const Id = z.coerce.number().int().positive();
const Uuid = z.string().uuid();
const E164 = z.string().regex(/^\+[1-9]\d{6,14}$/, "Use E.164 format, e.g. +919876543210");
const Limit = (def: number, max: number) => z.number().int().min(1).max(max).default(def);

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const UPDATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;
/** Reaches real people (phone calls, dialing batches) and spends wallet balance. */
const REAL_WORLD = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } as const;

const AGENT_SUMMARY_KEYS = [
  "id", "name", "status", "agentType", "language", "asrProvider", "llmProvider", "llmModel",
  "ttsProvider", "ttsVoice", "telephonyProvider", "inboundPhoneNumberId", "outboundPhoneNumberId",
  "totalCalls", "successfulCalls", "updatedAt",
] as const;

const CALL_SUMMARY_KEYS = [
  "id", "agentId", "agentName", "status", "direction", "toNumber", "fromNumber", "durationSeconds",
  "costCents", "campaignId", "errorMessage", "createdAt", "endedAt",
] as const;

const LOG_KEYS = ["ts", "component", "provider", "direction", "status", "latencyMs"] as const;

function agentSummary(a: Record<string, unknown>) {
  const cfg = (a["agentConfig"] ?? {}) as Record<string, unknown>;
  return { ...pick(a, AGENT_SUMMARY_KEYS), voiceStack: cfg["voiceStack"] ?? "classic" };
}

function callSummary(c: Record<string, unknown>) {
  return {
    ...pick(c, CALL_SUMMARY_KEYS),
    ...(c["callSummary"] ? { summary: truncateText(c["callSummary"], 300) } : {}),
    ...(c["dispositionResult"] ? { disposition: c["dispositionResult"] } : {}),
  };
}

function stringifyLeads(leads: Array<Record<string, unknown>>): Array<Record<string, string>> {
  return leads.map((row) =>
    Object.fromEntries(
      Object.entries(row)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => [k, typeof v === "string" ? v : String(v)]),
    ),
  );
}

const LeadRows = z
  .array(z.record(z.union([z.string(), z.number(), z.boolean()])))
  .min(1)
  .describe('Lead rows, e.g. [{"phone":"+919876543210","name":"Asha","city":"Chennai"}]. Every key is stored on the lead and can be used as a prompt variable.');

export function registerTools(server: McpServer, client: SnapServeClient): void {
  const api = client.request.bind(client);

  // ── Meta ────────────────────────────────────────────────────────────────────

  server.registerTool("snapserve_help", {
    title: "SnapServe workflows",
    description: "Read this first. Explains SnapServe concepts and which tools to chain for common jobs (create an agent, place a test call, dial a lead list, debug a failed call, website lead intake).",
    annotations: READ,
  }, async () => run(async () => HELP_TEXT));

  server.registerTool("snapserve_api", {
    title: "Raw SnapServe API request",
    description: "Escape hatch: call any SnapServe REST endpoint under /api when no dedicated tool exists. Prefer dedicated tools — they validate inputs and trim large responses.",
    inputSchema: {
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
      path: z.string().startsWith("/").describe("Path under /api, e.g. /agents/415"),
      body: z.record(z.unknown()).optional(),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
    },
    annotations: { ...WRITE, destructiveHint: true },
  }, async ({ method, path, body, query }) => run(() => api(method, path, { body, query })));

  // ── Account / wallet ────────────────────────────────────────────────────────

  server.registerTool("get_account", {
    title: "Account info",
    description: "Account limits for the connected API key (concurrent call limit, wallet id). Legacy keys in the response are masked.",
    annotations: READ,
  }, async () => run(async () => {
    const acct = await api<Record<string, unknown>>("GET", "/account");
    for (const k of ["apiKey", "orgKey"]) {
      if (typeof acct[k] === "string") acct[k] = maskSecret(acct[k] as string);
    }
    return acct;
  }));

  server.registerTool("get_wallet", {
    title: "Wallet balance",
    description: "Current wallet balance and billing settings.",
    annotations: READ,
  }, async () => run(() => api("GET", "/wallet")));

  server.registerTool("list_transactions", {
    title: "Wallet transactions",
    description: "Recent wallet transactions (call debits, top-ups), newest first.",
    inputSchema: { limit: Limit(20, 100), offset: z.number().int().min(0).default(0) },
    annotations: READ,
  }, async ({ limit, offset }) => run(() => api("GET", "/wallet/transactions", { query: { limit, offset } })));

  // ── Agents ──────────────────────────────────────────────────────────────────

  server.registerTool("list_agents", {
    title: "List agents",
    description: "Compact list of voice agents (id, name, status, language, providers, voice stack, call counts). Use get_agent for the full prompt and config.",
    inputSchema: {
      search: z.string().optional().describe("Case-insensitive name filter"),
      status: z.enum(["active", "inactive", "draft"]).optional(),
      limit: Limit(50, 200),
    },
    annotations: READ,
  }, async ({ search, status, limit }) => run(async () => {
    const q = search?.trim().toLowerCase();
    const rows = asArray(await api("GET", "/agents"))
      .filter((a) => !status || a["status"] === status)
      .filter((a) => !q || String(a["name"] ?? "").toLowerCase().includes(q));
    return page(rows.map(agentSummary), limit);
  }));

  server.registerTool("get_agent", {
    title: "Get agent",
    description: "Full agent: system prompt, greeting, providers, tools, agentConfig (voiceStack, geminiLive, openaiRealtime …). Credentials inside tools are masked.",
    inputSchema: { id: Id },
    annotations: READ,
  }, async ({ id }) => run(() => api("GET", `/agents/${id}`)));

  server.registerTool("create_agent", {
    title: "Create agent",
    description:
      "Create a voice agent. Only name and systemPrompt are needed; providers default to the standard SnapServe stack " +
      "(Sarvam ASR + LLM, Cartesia TTS, Vobiz telephony). Set voiceStack to use a native speech-to-speech model instead of ASR→LLM→TTS.",
    inputSchema: {
      name: z.string().min(1),
      systemPrompt: z.string().min(1).describe("Full agent instructions / persona"),
      greetingMessage: z.string().optional().describe("First line the agent says"),
      firstSpeaker: z.enum(["assistant", "user"]).optional(),
      language: z.string().optional().describe("BCP-47, e.g. en-IN, hi-IN, ta-IN"),
      asrProvider: z.string().default("sarvam"),
      llmProvider: z.string().default("sarvam"),
      llmModel: z.string().optional().describe("Defaults to gemma4 when llmProvider is sarvam"),
      ttsProvider: z.string().default("cartesia"),
      ttsVoice: z.string().optional().describe("Provider voice id; Cartesia defaults to the standard Indian female voice"),
      telephonyProvider: z.string().default("vobiz"),
      voiceStack: z.enum(["classic", "gemini_live", "openai_realtime"]).optional(),
      maxDuration: z.number().int().positive().optional().describe("Max call length in seconds (default 480)"),
      webhookUrl: z.string().url().startsWith("https://").optional().describe("Post-call webhook (https only)"),
      extra: z.record(z.unknown()).optional().describe("Any other agent fields, passed through as-is"),
    },
    annotations: WRITE,
  }, async ({ voiceStack, extra, llmModel, ...fields }) => run(() => {
    const body: Record<string, unknown> = { ...fields, ...(extra ?? {}) };
    body["llmModel"] = llmModel ?? (fields.llmProvider === "sarvam" ? "gemma4" : undefined);
    if (voiceStack) {
      body["agentConfig"] = { ...((extra?.["agentConfig"] as Record<string, unknown>) ?? {}), voiceStack };
    }
    return api("POST", "/agents", { body });
  }));

  server.registerTool("update_agent", {
    title: "Update agent",
    description: "Change agent fields. Only the fields you pass are changed; agentConfig is merged with the existing config, not replaced.",
    inputSchema: {
      id: Id,
      name: z.string().min(1).optional(),
      systemPrompt: z.string().min(1).optional(),
      greetingMessage: z.string().optional(),
      firstSpeaker: z.enum(["assistant", "user"]).optional(),
      language: z.string().optional(),
      llmProvider: z.string().optional(),
      llmModel: z.string().optional(),
      ttsProvider: z.string().optional(),
      ttsVoice: z.string().optional(),
      voiceStack: z.enum(["classic", "gemini_live", "openai_realtime"]).optional(),
      knowledgeSourceIds: z.array(Id).optional().describe("Replaces the attached knowledge sources"),
      webhookUrl: z.string().url().startsWith("https://").optional(),
      maxDuration: z.number().int().positive().optional(),
      patch: z.record(z.unknown()).optional().describe("Any other agent fields"),
    },
    annotations: UPDATE,
  }, async ({ id, voiceStack, patch, ...fields }) => run(() => {
    const body: Record<string, unknown> = { ...(patch ?? {}) };
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) body[k] = v;
    if (voiceStack) {
      body["agentConfig"] = { ...((patch?.["agentConfig"] as Record<string, unknown>) ?? {}), voiceStack };
    }
    if (Object.keys(body).length === 0) throw new Error("Nothing to update — pass at least one field");
    return api("PATCH", `/agents/${id}`, { body });
  }));

  server.registerTool("toggle_agent", {
    title: "Toggle agent active",
    description: "Flip an agent between active and inactive. Inactive agents reject calls.",
    inputSchema: { id: Id },
    annotations: WRITE,
  }, async ({ id }) => run(() => api("PATCH", `/agents/${id}/toggle`)));

  server.registerTool("delete_agent", {
    title: "Delete agent",
    description: "Permanently delete an agent. Ask the user to confirm first, then pass confirm: true.",
    inputSchema: { id: Id, confirm: z.literal(true) },
    annotations: DESTRUCTIVE,
  }, async ({ id }) => run(async () => {
    await api("DELETE", `/agents/${id}`);
    return { deleted: true, id };
  }));

  server.registerTool("list_agent_versions", {
    title: "List agent versions",
    description: "Published version snapshots of an agent.",
    inputSchema: { id: Id },
    annotations: READ,
  }, async ({ id }) => run(() => api("GET", `/agents/${id}/versions`)));

  server.registerTool("publish_agent_version", {
    title: "Publish agent version",
    description: "Snapshot the agent's current config as a named version (max 10 per agent).",
    inputSchema: {
      id: Id,
      versionName: z.string().min(1).describe('e.g. "v3 — Tamil greeting"'),
      commitDescription: z.string().min(1).describe("What changed"),
      releaseNotes: z.string().optional(),
    },
    annotations: WRITE,
  }, async ({ id, ...body }) => run(() => api("POST", `/agents/${id}/versions`, { body })));

  // ── Calls ───────────────────────────────────────────────────────────────────

  server.registerTool("list_calls", {
    title: "List calls",
    description: "Recent calls, newest first, without transcripts (use get_call for one call's transcript).",
    inputSchema: {
      agentId: Id.optional(),
      status: z.enum([
        "pending", "ringing", "in_progress", "connected", "completed", "failed", "cancelled", "transferred",
        "no_pickup", "voicemail", "busy", "booked", "callback_scheduled",
      ]).optional(),
      campaignId: Id.optional(),
      limit: Limit(20, 100),
      offset: z.number().int().min(0).default(0),
    },
    annotations: READ,
  }, async ({ agentId, status, campaignId, limit, offset }) => run(async () => {
    const rows = asArray(await api("GET", "/calls", { query: { agentId, status } }))
      .filter((c) => !campaignId || c["campaignId"] === campaignId);
    return page(rows.map(callSummary), limit, offset);
  }));

  server.registerTool("get_call", {
    title: "Get call",
    description: "One call: status, numbers, duration, cost, summary, disposition, recording URL and transcript.",
    inputSchema: {
      id: Id,
      transcriptChars: z.number().int().min(0).max(50_000).default(12_000).describe("Max transcript characters to return (0 = omit)"),
    },
    annotations: READ,
  }, async ({ id, transcriptChars }) => run(async () => {
    const call = await api<Record<string, unknown>>("GET", `/calls/${id}`);
    const { transcript, metadata, ...rest } = call;
    return {
      ...rest,
      ...(transcriptChars > 0 && transcript ? { transcript: truncateText(transcript, transcriptChars) } : {}),
      ...(metadata ? { metadata: truncateText(metadata, 2_000) } : {}),
    };
  }));

  server.registerTool("get_call_logs", {
    title: "Get call execution logs",
    description: "Step-by-step timeline of a call (STT, LLM, TTS, Tool, Webhook …) with latency and errors. Use to debug why a call failed or was slow.",
    inputSchema: {
      id: Id,
      component: z.enum(["Agent", "STT", "LLM", "TTS", "Tool", "Memory", "Knowledge", "VariableResolver", "Webhook"]).optional(),
      errorsOnly: z.boolean().default(false),
      limit: Limit(80, 400),
    },
    annotations: READ,
  }, async ({ id, component, errorsOnly, limit }) => run(async () => {
    const rows = asArray(await api("GET", `/calls/${id}/logs`))
      .filter((r) => !component || r["component"] === component)
      .filter((r) => !errorsOnly || r["status"] === "error");
    return page(rows.map((r) => ({
      ...pick(r, LOG_KEYS),
      ...(r["metadata"] ? { metadata: truncateText(JSON.stringify(r["metadata"]), 400) } : {}),
      ...(r["status"] === "error" && r["responsePayload"]
        ? { response: truncateText(JSON.stringify(r["responsePayload"]), 600) }
        : {}),
    })), limit);
  }));

  server.registerTool("outbound_call", {
    title: "Place outbound call",
    description:
      "Dial a real phone number with an agent. Costs wallet balance and rings a real person — confirm the number and agent with the user first. " +
      "The caller ID is the agent's outbound number. variables are injected into the prompt for this call only (e.g. {\"name\":\"Asha\"}).",
    inputSchema: {
      agentId: Id,
      toNumber: E164,
      variables: z.record(z.unknown()).optional(),
    },
    annotations: REAL_WORLD,
  }, async ({ agentId, toNumber, variables }) => run(() =>
    api("POST", "/calls/outbound", { body: { agentId, toNumber, ...(variables ? { variables } : {}) } })));

  server.registerTool("end_call", {
    title: "End live call",
    description: "Hang up a call that is in progress.",
    inputSchema: { id: Id },
    annotations: DESTRUCTIVE,
  }, async ({ id }) => run(() => api("PATCH", `/calls/${id}/end`, { body: {} })));

  server.registerTool("transfer_call", {
    title: "Transfer live call",
    description: "Transfer an in-progress call to a human (Vobiz agents only). warm = agent speaks a handoff line first; cold = immediate.",
    inputSchema: {
      id: Id,
      type: z.enum(["warm", "cold"]),
      target: z.string().min(3).describe("E.164 number or SIP URI"),
      warmMessage: z.string().optional(),
    },
    annotations: REAL_WORLD,
  }, async ({ id, ...body }) => run(() => api("POST", `/calls/${id}/transfer`, { body })));

  // ── Campaigns ───────────────────────────────────────────────────────────────

  server.registerTool("list_campaigns", {
    title: "List campaigns",
    description: "Outbound/inbound campaigns with status and counts.",
    annotations: READ,
  }, async () => run(async () => asArray(await api("GET", "/campaigns")).map((c) =>
    pick(c, ["id", "name", "status", "isActive", "agentId", "leadSource", "triggerMode", "totalLeads", "calledLeads", "createdAt"]))));

  server.registerTool("get_campaign", {
    title: "Get campaign",
    description: "Campaign settings plus websiteLeadUrl — the URL a website form / Sheet / Zapier POSTs leads to.",
    inputSchema: { id: Id },
    annotations: READ,
  }, async ({ id }) => run(async () => {
    const c = await api<Record<string, unknown>>("GET", `/campaigns/${id}`);
    const token = typeof c["webhookToken"] === "string" ? c["webhookToken"] : null;
    return {
      ...c,
      websiteLeadUrl: token ? client.websiteLeadUrl(token) : null,
      ...(token ? {
        websiteLeadExample: `curl -X POST '${client.websiteLeadUrl(token)}' -H 'Content-Type: application/json' -d '{"phone":"+919876543210","name":"Test Lead"}'`,
      } : {}),
    };
  }));

  server.registerTool("create_campaign", {
    title: "Create campaign",
    description:
      "Create a campaign for an agent. leadSource csv = you upload leads (batch dialing); webhook = leads arrive from a website form and are called instantly " +
      "(get_campaign returns the intake URL).",
    inputSchema: {
      name: z.string().min(1),
      agentId: Id,
      description: z.string().optional(),
      leadSource: z.enum(["csv", "webhook", "meta_ads", "crm"]).default("csv"),
      concurrentCallLimit: z.number().int().min(1).max(10).optional(),
      maxAttempts: z.number().int().min(1).optional(),
      retryDelayMinutes: z.number().int().min(1).optional(),
      fieldMappings: z.record(z.string()).optional().describe('Lead column → field, e.g. {"phone":"Mobile","name":"Full Name"}'),
      extra: z.record(z.unknown()).optional().describe("Other campaign fields (consentBasis, leadTransfer, afterCallBranches …)"),
    },
    annotations: WRITE,
  }, async ({ extra, ...fields }) => run(async () => {
    const created = await api<Record<string, unknown>>("POST", "/campaigns", { body: { ...fields, ...(extra ?? {}) } });
    const token = typeof created["webhookToken"] === "string" ? created["webhookToken"] : null;
    return { ...created, websiteLeadUrl: token ? client.websiteLeadUrl(token) : null };
  }));

  server.registerTool("update_campaign", {
    title: "Update campaign",
    description: "Change campaign settings: pause/resume (isActive), calling hours, retries, agent.",
    inputSchema: {
      id: Id,
      name: z.string().min(1).optional(),
      agentId: Id.optional(),
      isActive: z.boolean().optional().describe("true = active, false = paused"),
      concurrentCallLimit: z.number().int().min(1).max(10).optional(),
      maxAttempts: z.number().int().min(1).optional(),
      retryDelayMinutes: z.number().int().min(1).optional(),
      isCallingHoursEnabled: z.boolean().optional(),
      businessHoursStart: z.number().int().min(0).max(23).optional(),
      businessHoursEnd: z.number().int().min(0).max(23).optional(),
      timezone: z.string().optional().describe("IANA, e.g. Asia/Kolkata"),
      patch: z.record(z.unknown()).optional(),
    },
    annotations: UPDATE,
  }, async ({ id, patch, ...fields }) => run(() => {
    const body: Record<string, unknown> = { ...(patch ?? {}) };
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) body[k] = v;
    return api("PATCH", `/campaigns/${id}`, { body });
  }));

  server.registerTool("delete_campaign", {
    title: "Delete campaign",
    description: "Permanently delete a campaign and its leads. Ask the user to confirm first, then pass confirm: true.",
    inputSchema: { id: Id, confirm: z.literal(true) },
    annotations: DESTRUCTIVE,
  }, async ({ id }) => run(async () => {
    await api("DELETE", `/campaigns/${id}`);
    return { deleted: true, id };
  }));

  server.registerTool("create_campaign_batch", {
    title: "Create dialing batch",
    description:
      "Upload leads as a batch and (by default) start dialing them right away. Rings real people and spends wallet — confirm with the user. " +
      "Set autoStart false or scheduledStartAt to dial later.",
    inputSchema: {
      campaignId: Id,
      name: z.string().min(1),
      leads: LeadRows,
      autoStart: z.boolean().default(true),
      scheduledStartAt: z.string().datetime().optional().describe("ISO time to start dialing"),
      countryCode: z.string().optional().describe("Default country for numbers without +, e.g. IN"),
      duplicatePolicy: z.enum(["ignore", "skip", "reject_with_report"]).optional(),
      extra: z.record(z.unknown()).optional().describe("Other batch fields (maxAttempts, businessHoursStart, timezone …)"),
    },
    annotations: REAL_WORLD,
  }, async ({ campaignId, leads, extra, ...fields }) => run(() =>
    api("POST", `/campaigns/${campaignId}/batches`, {
      body: { ...fields, ...(extra ?? {}), leadSource: "csv", leads: stringifyLeads(leads) },
    })));

  server.registerTool("list_campaign_batches", {
    title: "List batches",
    description: "Batches for a campaign with status and progress.",
    inputSchema: { campaignId: Id },
    annotations: READ,
  }, async ({ campaignId }) => run(() => api("GET", `/campaigns/${campaignId}/batches`)));

  server.registerTool("start_campaign_batch", {
    title: "Start batch",
    description: "Start dialing a scheduled or paused batch now. Rings real people — confirm first.",
    inputSchema: { campaignId: Id, batchId: Id },
    annotations: REAL_WORLD,
  }, async ({ campaignId, batchId }) => run(() => api("POST", `/campaigns/${campaignId}/batches/${batchId}/start`)));

  server.registerTool("import_campaign_leads", {
    title: "Import leads (no batch)",
    description: "Add leads to a campaign without creating a batch (they are not dialed until a batch includes them). To dial, prefer create_campaign_batch.",
    inputSchema: { campaignId: Id, leads: LeadRows },
    annotations: WRITE,
  }, async ({ campaignId, leads }) => run(() =>
    api("POST", `/campaigns/${campaignId}/import-leads`, { body: { leads: stringifyLeads(leads) } })));

  server.registerTool("list_campaign_leads", {
    title: "List campaign leads",
    description: "Leads in a campaign with call status.",
    inputSchema: {
      campaignId: Id,
      status: z.string().optional(),
      limit: Limit(50, 200),
      offset: z.number().int().min(0).default(0),
    },
    annotations: READ,
  }, async ({ campaignId, status, limit, offset }) => run(() =>
    api("GET", `/campaigns/${campaignId}/leads`, { query: { status, limit, offset } })));

  // ── Journeys ────────────────────────────────────────────────────────────────

  server.registerTool("list_journey_presets", {
    title: "Journey presets",
    description: "Ready-made multi-step journeys (event_outreach, inbound_booking, lead_qualification, collections_reminder).",
    annotations: READ,
  }, async () => run(() => api("GET", "/journeys/presets")));

  server.registerTool("list_journeys", {
    title: "List journeys",
    description: "Journeys (multi-step call + WhatsApp + email follow-up flows).",
    annotations: READ,
  }, async () => run(async () => asArray(await api("GET", "/journeys")).map((j) =>
    pick(j, ["id", "name", "status", "agentId", "presetId", "createdAt", "updatedAt"]))));

  server.registerTool("get_journey", {
    title: "Get journey",
    description: "Full journey with trigger, steps and settings.",
    inputSchema: { id: Id },
    annotations: READ,
  }, async ({ id }) => run(() => api("GET", `/journeys/${id}`)));

  server.registerTool("create_journey", {
    title: "Create journey",
    description: "Create a journey for an agent. Pass presetId to start from a preset (name becomes optional). Created as draft — activate_journey to go live.",
    inputSchema: {
      agentId: Id,
      presetId: z.enum(["event_outreach", "inbound_booking", "lead_qualification", "collections_reminder", "custom"]).optional(),
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      settings: z.record(z.unknown()).optional(),
      trigger: z.object({ type: z.enum(["form_lead", "instagram_lead", "manual"]), fieldMap: z.record(z.string()).optional() }).optional(),
      steps: z.array(z.record(z.unknown())).optional(),
    },
    annotations: WRITE,
  }, async (body) => run(() => {
    if (!body.name && (!body.presetId || body.presetId === "custom")) {
      throw new Error("name is required unless a presetId is given");
    }
    return api("POST", "/journeys", { body });
  }));

  server.registerTool("apply_journey_preset", {
    title: "Apply journey preset",
    description: "Replace a journey's trigger/steps/settings with a preset.",
    inputSchema: {
      id: Id,
      presetId: z.enum(["event_outreach", "inbound_booking", "lead_qualification", "collections_reminder"]),
      settings: z.record(z.unknown()).optional(),
    },
    annotations: UPDATE,
  }, async ({ id, ...body }) => run(() => api("POST", `/journeys/${id}/apply-preset`, { body })));

  server.registerTool("activate_journey", {
    title: "Activate journey",
    description: "Put a journey live. It will start calling/messaging people as leads arrive — confirm first.",
    inputSchema: { id: Id },
    annotations: REAL_WORLD,
  }, async ({ id }) => run(() => api("POST", `/journeys/${id}/activate`)));

  server.registerTool("pause_journey", {
    title: "Pause journey",
    description: "Stop a live journey.",
    inputSchema: { id: Id },
    annotations: UPDATE,
  }, async ({ id }) => run(() => api("POST", `/journeys/${id}/pause`)));

  // ── Knowledge ───────────────────────────────────────────────────────────────

  server.registerTool("list_knowledge_sources", {
    title: "List knowledge sources",
    description: "Knowledge bases (FAQ, text, website) that agents can look up during calls.",
    annotations: READ,
  }, async () => run(() => api("GET", "/knowledge-sources")));

  server.registerTool("create_knowledge_source", {
    title: "Create knowledge source",
    description: "Create a knowledge base from text/FAQ entries or a website URL. Attach it to an agent with attach_knowledge.",
    inputSchema: {
      name: z.string().min(1),
      type: z.enum(["text", "faq", "website"]),
      url: z.string().url().optional().describe("Required for type website"),
      entries: z.array(z.object({
        title: z.string().optional(),
        content: z.string().min(1),
        keywords: z.array(z.string()).optional(),
      })).optional().describe("Required for text / faq"),
    },
    annotations: WRITE,
  }, async (body) => run(() => {
    if (body.type === "website" && !body.url) throw new Error("url is required for type website");
    if (body.type !== "website" && !body.entries?.length) throw new Error("entries are required for text / faq");
    return api("POST", "/knowledge-sources", { body });
  }));

  server.registerTool("attach_knowledge", {
    title: "Attach knowledge to agent",
    description: "Let an agent use a knowledge source during calls.",
    inputSchema: { sourceId: Id, agentId: Id },
    annotations: UPDATE,
  }, async ({ sourceId, agentId }) => run(() => api("POST", `/knowledge-sources/${sourceId}/attach-agent/${agentId}`)));

  server.registerTool("search_knowledge", {
    title: "Search knowledge",
    description: "Test what an agent would retrieve from a knowledge source for a question.",
    inputSchema: { sourceId: Id, query: z.string().min(1) },
    annotations: READ,
  }, async ({ sourceId, query }) => run(() => api("POST", `/knowledge-sources/${sourceId}/search`, { body: { query } })));

  // ── Phone numbers ───────────────────────────────────────────────────────────

  server.registerTool("list_phone_numbers", {
    title: "List phone numbers",
    description: "Phone numbers on the account and which agent each is assigned to.",
    annotations: READ,
  }, async () => run(() => api("GET", "/phone-numbers")));

  server.registerTool("search_available_numbers", {
    title: "Search numbers to buy",
    description: "Numbers available to purchase in a country. An empty list can also mean the carrier lookup failed.",
    inputSchema: { countryCode: z.string().length(2).default("IN"), pattern: z.string().optional() },
    annotations: READ,
  }, async ({ countryCode, pattern }) => run(() => api("GET", "/phone-numbers/available", { query: { countryCode, pattern } })));

  server.registerTool("assign_phone_number", {
    title: "Assign phone number",
    description: "Assign a number to an agent (inbound calls to it reach that agent). agentId null unassigns.",
    inputSchema: { id: Id, agentId: Id.nullable() },
    annotations: UPDATE,
  }, async ({ id, agentId }) => run(() => api("PATCH", `/phone-numbers/${id}/assign`, { body: { agentId } })));

  // ── WhatsApp / email ────────────────────────────────────────────────────────

  server.registerTool("get_whatsapp_channel", {
    title: "WhatsApp channel",
    description: "Native WhatsApp channel status and which agents handle chat/calls.",
    annotations: READ,
  }, async () => run(() => api("GET", "/whatsapp/channel")));

  server.registerTool("update_whatsapp_channel", {
    title: "Update WhatsApp channel",
    description: "Change WhatsApp channel settings (notifications, chatbot, assigned agents).",
    inputSchema: {
      active: z.boolean().optional(),
      businessName: z.string().optional(),
      notifyBookingConfirmed: z.boolean().optional(),
      notifyCallSummary: z.boolean().optional(),
      notifyCallbackScheduled: z.boolean().optional(),
      chatbotEnabled: z.boolean().optional(),
      chatbotAgentId: Id.nullable().optional(),
      inboundAgentId: Id.nullable().optional(),
      callingEnabled: z.boolean().optional(),
      callingAgentId: Id.nullable().optional(),
    },
    annotations: UPDATE,
  }, async (fields) => run(() => {
    const body = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    return api("PATCH", "/whatsapp/channel", { body });
  }));

  server.registerTool("list_whatsapp_connections", {
    title: "List WhatsApp connections",
    description: "Bring-your-own WhatsApp (Meta / BSP) connections and Request-a-Call setups.",
    annotations: READ,
  }, async () => run(() => api("GET", "/whatsapp/connections")));

  server.registerTool("create_whatsapp_connection", {
    title: "Create WhatsApp connection",
    description: "Connect a WhatsApp number (own Meta credentials or BSP webhook) to an agent.",
    inputSchema: {
      agentId: Id,
      name: z.string().optional(),
      campaignId: Id.optional(),
      outboundWebhookUrl: z.string().url().optional(),
      requestCallEnabled: z.boolean().optional(),
      postCallEnabled: z.boolean().optional(),
      metaAccessToken: z.string().optional(),
      metaPhoneNumberId: z.string().optional(),
      metaWabaId: z.string().optional(),
      extra: z.record(z.unknown()).optional(),
    },
    annotations: WRITE,
  }, async ({ extra, ...fields }) => run(() => api("POST", "/whatsapp/connections", { body: { ...fields, ...(extra ?? {}) } })));

  server.registerTool("get_email_channel", {
    title: "Email channel",
    description: "Post-call email settings (managed sender or Brevo).",
    annotations: READ,
  }, async () => run(async () => {
    const ch = await api<Record<string, unknown>>("GET", "/email/channel");
    const { defaultDesign: _design, ...rest } = ch;
    return rest;
  }));

  server.registerTool("update_email_channel", {
    title: "Update email channel",
    description: "Configure post-call email: managed sender, or your own Brevo account.",
    inputSchema: {
      mode: z.enum(["managed", "brevo_byo"]).optional(),
      brevoApiKey: z.string().optional(),
      fromName: z.string().optional(),
      fromEmail: z.string().email().optional(),
      defaultTemplate: z.object({ subject: z.string(), body: z.string() }).optional(),
      active: z.boolean().optional(),
    },
    annotations: UPDATE,
  }, async (fields) => run(() => {
    const body = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    return api("PUT", "/email/channel", { body });
  }));

  // ── Google Sheets automatic calls ───────────────────────────────────────────

  server.registerTool("list_automatic_calls", {
    title: "List Sheets auto-call jobs",
    description: "Google Sheets jobs that call each new row automatically.",
    annotations: READ,
  }, async () => run(() => api("GET", "/automatic-calls")));

  server.registerTool("create_automatic_call", {
    title: "Create Sheets auto-call job",
    description:
      "Call rows of a Google Sheet automatically. Needs a Google connection (connectionId) already linked in the dashboard. " +
      "startMode new_only = only rows added from now; backfill_then_watch = existing rows too (rings real people).",
    inputSchema: {
      name: z.string().min(1).max(200),
      connectionId: Uuid,
      agentId: Id,
      spreadsheetId: z.string().min(1),
      sheetName: z.string().min(1),
      columnMap: z.object({ phone: z.string().min(1), name: z.string().optional(), email: z.string().optional() })
        .passthrough()
        .describe("Sheet column header for each field"),
      startMode: z.enum(["new_only", "backfill_then_watch"]),
      writebackMode: z.enum(["same_sheet", "call_log", "both"]),
      concurrentCallLimit: z.number().int().min(1).max(20).optional(),
      fromNumber: z.string().nullable().optional(),
    },
    annotations: REAL_WORLD,
  }, async (body) => run(() => api("POST", "/automatic-calls", { body })));

  server.registerTool("start_automatic_call", {
    title: "Start Sheets auto-call job",
    description: "Resume calling sheet rows. Rings real people — confirm first.",
    inputSchema: { id: Uuid },
    annotations: REAL_WORLD,
  }, async ({ id }) => run(() => api("POST", `/automatic-calls/${id}/start`)));

  server.registerTool("pause_automatic_call", {
    title: "Pause Sheets auto-call job",
    description: "Stop calling sheet rows.",
    inputSchema: { id: Uuid },
    annotations: UPDATE,
  }, async ({ id }) => run(() => api("POST", `/automatic-calls/${id}/pause`)));

  // ── Dispositions ────────────────────────────────────────────────────────────

  server.registerTool("get_disposition_config", {
    title: "Get call outcomes config",
    description: "How an agent's calls are classified after hang-up (taxonomy of outcomes, meanings, guides).",
    inputSchema: { agentId: Id },
    annotations: READ,
  }, async ({ agentId }) => run(() => api("GET", `/disposition/config/${agentId}`)));

  server.registerTool("set_disposition_config", {
    title: "Set call outcomes config",
    description:
      "Set the outcome taxonomy for an agent's calls. Fields you omit (domain fields, rules, after-call messages) are kept as they are.",
    inputSchema: {
      agentId: Id,
      taxonomy: z.record(z.array(z.string())).describe('e.g. {"interested":["demo_booked","pricing"],"not_interested":["no_budget"]}'),
      meaningMap: z.object({
        interested: z.array(z.string()).default([]),
        callback: z.array(z.string()).default([]),
        dnc: z.array(z.string()).default([]),
      }).optional().describe("Which outcomes mean interested / callback / do-not-call"),
      outcomeGuides: z.record(z.string()).optional().describe("Business definition per outcome"),
    },
    annotations: UPDATE,
  }, async ({ agentId, ...body }) => run(() => api("PUT", `/disposition/config/${agentId}`, { body })));

  // ── Squads ──────────────────────────────────────────────────────────────────

  server.registerTool("list_squads", {
    title: "List squads",
    description: "Multi-agent squads (agents that hand calls to each other).",
    annotations: READ,
  }, async () => run(() => api("GET", "/squads")));

  server.registerTool("list_squad_templates", {
    title: "Squad templates",
    description: "Ready-made squad layouts.",
    annotations: READ,
  }, async () => run(() => api("GET", "/squads/templates")));

  server.registerTool("create_squad", {
    title: "Create squad",
    description: "Create a squad of agents that can hand off to each other during a call.",
    inputSchema: {
      name: z.string().min(1),
      description: z.string().optional(),
      members: z.array(z.object({
        agentId: Id,
        roleName: z.string().min(1),
        roleType: z.enum(["supervisor", "specialist"]).optional(),
        instructions: z.string().optional(),
        handoffEnabled: z.boolean().optional(),
      })).optional(),
      handoffMessage: z.string().optional(),
      status: z.enum(["active", "draft"]).optional(),
      extra: z.record(z.unknown()).optional(),
    },
    annotations: WRITE,
  }, async ({ extra, ...fields }) => run(() => api("POST", "/squads", { body: { ...fields, ...(extra ?? {}) } })));

  server.registerTool("start_squad_run", {
    title: "Start squad task run",
    description: "Run a squad on a text task (kind task, needs goal).",
    inputSchema: {
      id: Id,
      goal: z.string().min(1),
      context: z.record(z.unknown()).optional(),
    },
    annotations: WRITE,
  }, async ({ id, goal, context }) => run(() =>
    api("POST", `/squads/${id}/runs`, { body: { kind: "task", goal, ...(context ? { context } : {}) } })));

  // ── Browser test calls ──────────────────────────────────────────────────────

  server.registerTool("create_webcall_link", {
    title: "Create browser call link",
    description: "Make a shareable link to talk to an agent in the browser (no phone needed). Good for testing an agent. Calls are billed to the agent owner.",
    inputSchema: {
      agentId: Id,
      label: z.string().max(120).optional(),
      maxUses: z.number().int().positive().optional(),
      expiresAt: z.string().datetime().optional(),
    },
    annotations: WRITE,
  }, async ({ agentId, ...body }) => run(async () => {
    const link = await api<Record<string, unknown>>("POST", `/agents/${agentId}/webcall-links`, { body });
    const token = typeof link["token"] === "string" ? link["token"] : null;
    return { ...link, joinUrl: token ? client.webcallJoinUrl(token) : null };
  }));

  server.registerTool("list_webcall_links", {
    title: "List browser call links",
    description: "Existing browser call links for an agent.",
    inputSchema: { agentId: Id },
    annotations: READ,
  }, async ({ agentId }) => run(async () => asArray(await api("GET", `/agents/${agentId}/webcall-links`)).map((l) => ({
    ...pick(l, ["id", "label", "active", "useCount", "maxUses", "expiresAt", "createdAt"]),
    joinUrl: typeof l["token"] === "string" ? client.webcallJoinUrl(l["token"]) : null,
  }))));

  // ── Providers / webhooks ────────────────────────────────────────────────────

  server.registerTool("list_providers", {
    title: "List provider keys",
    description: "Bring-your-own provider keys (ASR / LLM / TTS / telephony). Keys are masked.",
    annotations: READ,
  }, async () => run(() => api("GET", "/providers")));

  server.registerTool("create_provider", {
    title: "Add provider key",
    description: "Store your own provider API key, e.g. openai for llm, vobiz for telephony (extraConfig {authId, fromNumber}).",
    inputSchema: {
      providerType: z.enum(["orchestration", "asr", "llm", "tts", "telephony"]),
      providerName: z.string().min(1).describe("e.g. openai, sarvam, cartesia, vobiz"),
      apiKey: z.string().min(1),
      extraConfig: z.record(z.unknown()).optional(),
    },
    annotations: WRITE,
  }, async ({ extraConfig, ...fields }) => run(() =>
    api("POST", "/providers", { body: { ...fields, ...(extraConfig ? { extraConfig: JSON.stringify(extraConfig) } : {}) } })));

  server.registerTool("list_webhook_endpoints", {
    title: "List webhook endpoints",
    description: "Account-level webhooks that receive call events.",
    annotations: READ,
  }, async () => run(() => api("GET", "/webhook-endpoints")));

  server.registerTool("create_webhook_endpoint", {
    title: "Create webhook endpoint",
    description: "Send call events to your URL (e.g. a CRM). The signing secret is masked here — the user can copy it from Dashboard → Webhooks.",
    inputSchema: {
      url: z.string().url(),
      events: z.array(z.enum(["call.started", "call.completed", "call.failed"])).min(1).default(["call.completed"]),
      description: z.string().optional(),
      secret: z.string().optional().describe("Signing secret; generated if omitted"),
    },
    annotations: WRITE,
  }, async (body) => run(() => api("POST", "/webhook-endpoints", { body })));

  // ── Analytics ───────────────────────────────────────────────────────────────

  server.registerTool("get_analytics_dashboard", {
    title: "Account analytics",
    description: "Today and last-7-days call volume, success rate, minutes and spend.",
    annotations: READ,
  }, async () => run(() => api("GET", "/analytics/dashboard")));

  server.registerTool("get_agent_analytics", {
    title: "Agent analytics",
    description: "One agent's success rate, latency, spend, and 30-day daily volume.",
    inputSchema: { agentId: Id },
    annotations: READ,
  }, async ({ agentId }) => run(() => api("GET", `/analytics/agents/${agentId}`)));

  server.registerTool("get_calls_by_status", {
    title: "Calls by status",
    description: "Call counts grouped by status.",
    annotations: READ,
  }, async () => run(() => api("GET", "/analytics/calls/by-status")));

  server.registerTool("get_daily_call_volume", {
    title: "Daily call volume",
    description: "Calls per day time series.",
    annotations: READ,
  }, async () => run(() => api("GET", "/analytics/calls/daily")));
}

const HELP_TEXT = `# SnapServe MCP

SnapServe runs AI voice agents that make and answer phone calls (Indian languages first).

## Concepts
- Agent: prompt + voice + providers. voiceStack "classic" = ASR→LLM→TTS; "gemini_live" / "openai_realtime" = native speech-to-speech.
- Call: one phone or browser conversation. get_call has transcript + summary + disposition; get_call_logs has the step timeline.
- Campaign: an agent + a lead list. Batches dial uploaded leads; webhook campaigns call website leads instantly.
- Journey: multi-step flow (call → WhatsApp/email follow-ups).
- Disposition: post-call outcome classification.

## Common jobs
- Build an agent: create_agent → create_webcall_link (test in browser) → update_agent to refine → publish_agent_version.
- Test call to a phone: outbound_call (confirm number first) → get_call for the result.
- Dial a list: create_campaign (leadSource csv) → create_campaign_batch with leads → list_campaign_batches for progress.
- Website form leads: create_campaign (leadSource webhook) → get_campaign → give the user websiteLeadUrl.
- Why did a call fail? get_call (status, errorMessage) → get_call_logs with errorsOnly.
- Answer from documents: create_knowledge_source → attach_knowledge → search_knowledge to verify.
- Sheets: create_automatic_call (Google connection must exist in the dashboard).

## Rules
- Confirm with the user before anything that rings real people or spends money (outbound_call, batches, journeys, auto-calls) and before deletes.
- Phone numbers must be E.164 (+91…).
- Never invent transcripts or results — fetch them.
- List tools return compact rows; fetch one item by id for full detail.
`;
