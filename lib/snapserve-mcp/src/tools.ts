import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SnapServeApiError, SnapServeClient } from "./client.js";

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
  };
}

function fail(err: unknown) {
  if (err instanceof SnapServeApiError) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ error: err.message, status: err.status, body: err.body }, null, 2),
      }],
      isError: true as const,
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: message }], isError: true as const };
}

const Id = z.union([z.number().int(), z.string()]).transform((v) => Number(v));

export function registerTools(server: McpServer, client: SnapServeClient) {
  // ── Meta / escape hatch ───────────────────────────────────────────────────

  server.tool(
    "snapserve_help",
    "Explain SnapServe product areas and recommended tool workflows (agents, campaigns, website intake, journeys, WhatsApp, Sheets, squads).",
    {},
    async () => ok(HELP_TEXT),
  );

  server.tool(
    "snapserve_api",
    "Call any SnapServe REST endpoint. Use when a dedicated tool is missing. Paths are relative to /api (e.g. /agents, /campaigns).",
    {
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
      path: z.string().describe("API path starting with /, e.g. /agents/415"),
      body: z.record(z.unknown()).optional(),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
    },
    async ({ method, path, body, query }) => {
      try {
        return ok(await client.request(method, path, { body, query }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ── Agents ────────────────────────────────────────────────────────────────

  server.tool("list_agents", "List all SnapServe voice agents in the account.", {}, async () => {
    try { return ok(await client.request("GET", "/agents")); } catch (e) { return fail(e); }
  });

  server.tool("get_agent", "Get one agent with full config.", { id: Id }, async ({ id }) => {
    try { return ok(await client.request("GET", `/agents/${id}`)); } catch (e) { return fail(e); }
  });

  server.tool(
    "create_agent",
    "Create a voice agent. Minimum: name + providers + systemPrompt. Prefer Sarvam ASR for Indic calls.",
    {
      name: z.string(),
      systemPrompt: z.string().optional(),
      language: z.string().optional().describe("e.g. en-IN, ta-IN, hi-IN"),
      asrProvider: z.string().optional().default("sarvam"),
      llmProvider: z.string().optional().default("google"),
      ttsProvider: z.string().optional().default("cartesia"),
      telephonyProvider: z.string().optional().default("vobiz"),
      asrModel: z.string().optional(),
      llmModel: z.string().optional(),
      ttsVoice: z.string().optional(),
      greetingMessage: z.string().optional(),
      extra: z.record(z.unknown()).optional().describe("Any additional AgentInput fields"),
    },
    async (args) => {
      try {
        const { extra, ...rest } = args;
        return ok(await client.request("POST", "/agents", { body: { ...rest, ...(extra ?? {}) } }));
      } catch (e) { return fail(e); }
    },
  );

  server.tool(
    "update_agent",
    "Patch an agent (prompt, voice, tools, webhookUrl, engine settings, etc.).",
    { id: Id, patch: z.record(z.unknown()) },
    async ({ id, patch }) => {
      try { return ok(await client.request("PATCH", `/agents/${id}`, { body: patch })); } catch (e) { return fail(e); }
    },
  );

  server.tool("toggle_agent", "Toggle agent active/inactive.", { id: Id }, async ({ id }) => {
    try { return ok(await client.request("PATCH", `/agents/${id}/toggle`)); } catch (e) { return fail(e); }
  });

  server.tool(
    "delete_agent",
    "Permanently delete an agent. Confirm with the user first.",
    { id: Id, confirm: z.literal(true) },
    async ({ id }) => {
      try { return ok(await client.request("DELETE", `/agents/${id}`)); } catch (e) { return fail(e); }
    },
  );

  server.tool("list_agent_versions", "List published/draft versions for an agent.", { id: Id }, async ({ id }) => {
    try { return ok(await client.request("GET", `/agents/${id}/versions`)); } catch (e) { return fail(e); }
  });

  server.tool(
    "publish_agent_version",
    "Publish a new agent version snapshot.",
    { id: Id, label: z.string().optional(), notes: z.string().optional() },
    async ({ id, label, notes }) => {
      try { return ok(await client.request("POST", `/agents/${id}/versions`, { body: { label, notes } })); }
      catch (e) { return fail(e); }
    },
  );

  // ── Calls ─────────────────────────────────────────────────────────────────

  server.tool(
    "list_calls",
    "List calls, optionally filtered by agentId or status.",
    { agentId: Id.optional(), status: z.string().optional() },
    async ({ agentId, status }) => {
      try { return ok(await client.request("GET", "/calls", { query: { agentId, status } })); }
      catch (e) { return fail(e); }
    },
  );

  server.tool("get_call", "Get call detail including transcript, summary, disposition.", { id: Id }, async ({ id }) => {
    try { return ok(await client.request("GET", `/calls/${id}`)); } catch (e) { return fail(e); }
  });

  server.tool("get_call_logs", "Get execution logs for a call (STT/LLM/TTS timeline).", { id: Id }, async ({ id }) => {
    try { return ok(await client.request("GET", `/calls/${id}/logs`)); } catch (e) { return fail(e); }
  });

  server.tool(
    "outbound_call",
    "Place an outbound phone call. toNumber should be E.164 (e.g. +918637416033).",
    { agentId: Id, toNumber: z.string() },
    async ({ agentId, toNumber }) => {
      try { return ok(await client.request("POST", "/calls/outbound", { body: { agentId, toNumber } })); }
      catch (e) { return fail(e); }
    },
  );

  server.tool("end_call", "End a live call.", { id: Id }, async ({ id }) => {
    try { return ok(await client.request("PATCH", `/calls/${id}/end`, { body: {} })); } catch (e) { return fail(e); }
  });

  server.tool(
    "transfer_call",
    "Transfer a live call to another number or agent.",
    { id: Id, to: z.string().optional(), body: z.record(z.unknown()).optional() },
    async ({ id, to, body }) => {
      try { return ok(await client.request("POST", `/calls/${id}/transfer`, { body: body ?? { to } })); }
      catch (e) { return fail(e); }
    },
  );

  // ── Campaigns + website linking ───────────────────────────────────────────

  server.tool("list_campaigns", "List outbound / inbound campaigns.", {}, async () => {
    try { return ok(await client.request("GET", "/campaigns")); } catch (e) { return fail(e); }
  });

  server.tool("get_campaign", "Get campaign detail (includes webhookToken for website intake).", { id: Id }, async ({ id }) => {
    try {
      const campaign = await client.request<Record<string, unknown>>("GET", `/campaigns/${id}`);
      const token = typeof campaign.webhookToken === "string" ? campaign.webhookToken : null;
      return ok({
        ...campaign,
        websiteLeadUrl: token ? client.websiteLeadUrl(token) : null,
        websiteLeadInstructions: token
          ? "POST JSON { phone, name?, ... } to websiteLeadUrl from your form/Sheet/Zap. Optional HMAC if configured."
          : null,
      });
    } catch (e) { return fail(e); }
  });

  server.tool(
    "create_campaign",
    "Create a campaign. For website forms set leadSource/trigger for webhook intake, then use get_campaign for the intake URL.",
    {
      name: z.string(),
      agentId: Id.optional(),
      body: z.record(z.unknown()).optional().describe("Full campaign create payload fields"),
    },
    async ({ name, agentId, body }) => {
      try {
        const created = await client.request<Record<string, unknown>>("POST", "/campaigns", {
          body: { name, agentId, ...(body ?? {}) },
        });
        const token = typeof created.webhookToken === "string" ? created.webhookToken : null;
        return ok({
          ...created,
          websiteLeadUrl: token ? client.websiteLeadUrl(token) : null,
        });
      } catch (e) { return fail(e); }
    },
  );

  server.tool(
    "update_campaign",
    "Update campaign settings (agent, schedule, concurrency, field mappings).",
    { id: Id, patch: z.record(z.unknown()) },
    async ({ id, patch }) => {
      try { return ok(await client.request("PATCH", `/campaigns/${id}`, { body: patch })); }
      catch (e) { return fail(e); }
    },
  );

  server.tool(
    "delete_campaign",
    "Delete a campaign. Confirm with the user first.",
    { id: Id, confirm: z.literal(true) },
    async ({ id }) => {
      try { return ok(await client.request("DELETE", `/campaigns/${id}`)); } catch (e) { return fail(e); }
    },
  );

  server.tool(
    "import_campaign_leads",
    "Import leads into a campaign (CSV rows or lead objects — pass the API body as-is).",
    { campaignId: Id, body: z.record(z.unknown()) },
    async ({ campaignId, body }) => {
      try { return ok(await client.request("POST", `/campaigns/${campaignId}/import-leads`, { body })); }
      catch (e) { return fail(e); }
    },
  );

  server.tool(
    "list_campaign_leads",
    "List leads for a campaign.",
    { campaignId: Id, status: z.string().optional() },
    async ({ campaignId, status }) => {
      try { return ok(await client.request("GET", `/campaigns/${campaignId}/leads`, { query: { status } })); }
      catch (e) { return fail(e); }
    },
  );

  server.tool(
    "get_website_webhook",
    "Return the website lead intake URL (+ token) for a campaign so the user can paste it into a form/Sheet/Zap.",
    { campaignId: Id },
    async ({ campaignId }) => {
      try {
        const campaign = await client.request<Record<string, unknown>>("GET", `/campaigns/${campaignId}`);
        const token = typeof campaign.webhookToken === "string" ? campaign.webhookToken : null;
        if (!token) return fail(new Error("Campaign has no webhookToken"));
        return ok({
          campaignId,
          campaignName: campaign.name,
          webhookToken: token,
          websiteLeadUrl: client.websiteLeadUrl(token),
          exampleCurl: `curl -X POST '${client.websiteLeadUrl(token)}' -H 'Content-Type: application/json' -d '{"phone":"+919876543210","name":"Test Lead"}'`,
        });
      } catch (e) { return fail(e); }
    },
  );

  server.tool("list_campaign_batches", "List batches for a campaign.", { campaignId: Id }, async ({ campaignId }) => {
    try { return ok(await client.request("GET", `/campaigns/${campaignId}/batches`)); } catch (e) { return fail(e); }
  });

  server.tool(
    "start_campaign_batch",
    "Start a campaign batch immediately.",
    { campaignId: Id, batchId: Id },
    async ({ campaignId, batchId }) => {
      try { return ok(await client.request("POST", `/campaigns/${campaignId}/batches/${batchId}/start`)); }
      catch (e) { return fail(e); }
    },
  );

  server.tool("list_lead_sources", "List reusable lead sources / connections.", {}, async () => {
    try { return ok(await client.request("GET", "/lead-sources")); } catch (e) { return fail(e); }
  });

  server.tool("list_connections", "Inbound connections hub overview (webhooks, Meta, etc.).", {}, async () => {
    try { return ok(await client.request("GET", "/connections")); } catch (e) { return fail(e); }
  });

  // ── Journeys ──────────────────────────────────────────────────────────────

  server.tool("list_journey_presets", "List journey preset templates (e.g. Event Outreach).", {}, async () => {
    try { return ok(await client.request("GET", "/journeys/presets")); } catch (e) { return fail(e); }
  });

  server.tool("list_journeys", "List journeys.", {}, async () => {
    try { return ok(await client.request("GET", "/journeys")); } catch (e) { return fail(e); }
  });

  server.tool("get_journey", "Get a journey.", { id: Id }, async ({ id }) => {
    try { return ok(await client.request("GET", `/journeys/${id}`)); } catch (e) { return fail(e); }
  });

  server.tool(
    "create_journey",
    "Create a journey. Prefer apply_journey_preset after create for Event Outreach style flows.",
    { body: z.record(z.unknown()) },
    async ({ body }) => {
      try { return ok(await client.request("POST", "/journeys", { body })); } catch (e) { return fail(e); }
    },
  );

  server.tool(
    "apply_journey_preset",
    "Apply a preset to a journey (e.g. Event Outreach).",
    { id: Id, body: z.record(z.unknown()).optional() },
    async ({ id, body }) => {
      try { return ok(await client.request("POST", `/journeys/${id}/apply-preset`, { body: body ?? {} })); }
      catch (e) { return fail(e); }
    },
  );

  server.tool("activate_journey", "Activate (go live) a journey.", { id: Id }, async ({ id }) => {
    try { return ok(await client.request("POST", `/journeys/${id}/activate`)); } catch (e) { return fail(e); }
  });

  server.tool("pause_journey", "Pause a journey.", { id: Id }, async ({ id }) => {
    try { return ok(await client.request("POST", `/journeys/${id}/pause`)); } catch (e) { return fail(e); }
  });

  // ── Channels: WhatsApp / Email ────────────────────────────────────────────

  server.tool("get_whatsapp_channel", "Get native WhatsApp channel status (Instant / Business).", {}, async () => {
    try { return ok(await client.request("GET", "/whatsapp/channel")); } catch (e) { return fail(e); }
  });

  server.tool(
    "update_whatsapp_channel",
    "Update WhatsApp channel settings.",
    { patch: z.record(z.unknown()) },
    async ({ patch }) => {
      try { return ok(await client.request("PATCH", "/whatsapp/channel", { body: patch })); }
      catch (e) { return fail(e); }
    },
  );

  server.tool("list_whatsapp_connections", "List BYO / Request-a-Call WhatsApp connections.", {}, async () => {
    try { return ok(await client.request("GET", "/whatsapp/connections")); } catch (e) { return fail(e); }
  });

  server.tool(
    "create_whatsapp_connection",
    "Create a WhatsApp connection (e.g. Bring-your-BSP webhook).",
    { body: z.record(z.unknown()) },
    async ({ body }) => {
      try { return ok(await client.request("POST", "/whatsapp/connections", { body })); }
      catch (e) { return fail(e); }
    },
  );

  server.tool("get_email_channel", "Get Brevo / email channel config for the account.", {}, async () => {
    try { return ok(await client.request("GET", "/email/channel")); } catch (e) { return fail(e); }
  });

  server.tool(
    "upsert_email_channel",
    "Create or update email channel (Brevo BYO).",
    { body: z.record(z.unknown()) },
    async ({ body }) => {
      try { return ok(await client.request("PUT", "/email/channel", { body })); } catch (e) { return fail(e); }
    },
  );

  // ── Phone numbers ─────────────────────────────────────────────────────────

  server.tool("list_phone_numbers", "List owned phone numbers.", {}, async () => {
    try { return ok(await client.request("GET", "/phone-numbers")); } catch (e) { return fail(e); }
  });

  server.tool(
    "search_available_numbers",
    "Search numbers available to purchase.",
    { countryCode: z.string().optional().default("IN") },
    async ({ countryCode }) => {
      try { return ok(await client.request("GET", "/phone-numbers/available", { query: { countryCode } })); }
      catch (e) { return fail(e); }
    },
  );

  server.tool(
    "assign_phone_number",
    "Assign a phone number to an agent (or null to unassign).",
    { id: Id, agentId: Id.nullable() },
    async ({ id, agentId }) => {
      try { return ok(await client.request("PATCH", `/phone-numbers/${id}/assign`, { body: { agentId } })); }
      catch (e) { return fail(e); }
    },
  );

  // ── Knowledge ─────────────────────────────────────────────────────────────

  server.tool("list_knowledge_sources", "List knowledge sources.", {}, async () => {
    try { return ok(await client.request("GET", "/knowledge-sources")); } catch (e) { return fail(e); }
  });

  server.tool(
    "attach_knowledge",
    "Attach a knowledge source to an agent.",
    { sourceId: Id, agentId: Id },
    async ({ sourceId, agentId }) => {
      try { return ok(await client.request("POST", `/knowledge-sources/${sourceId}/attach-agent/${agentId}`)); }
      catch (e) { return fail(e); }
    },
  );

  server.tool(
    "search_knowledge",
    "Search a knowledge source (RAG test).",
    { sourceId: Id, query: z.string() },
    async ({ sourceId, query }) => {
      try { return ok(await client.request("POST", `/knowledge-sources/${sourceId}/search`, { body: { query } })); }
      catch (e) { return fail(e); }
    },
  );

  // ── Sheets auto-calls ─────────────────────────────────────────────────────

  server.tool("list_automatic_calls", "List Google Sheets Automatic Calls jobs.", {}, async () => {
    try { return ok(await client.request("GET", "/automatic-calls")); } catch (e) { return fail(e); }
  });

  server.tool(
    "create_automatic_call",
    "Create a Sheets automatic-calls job. Body depends on connected sheet binding.",
    { body: z.record(z.unknown()) },
    async ({ body }) => {
      try { return ok(await client.request("POST", "/automatic-calls", { body })); } catch (e) { return fail(e); }
    },
  );

  server.tool("start_automatic_call", "Start an automatic-calls job.", { id: Id }, async ({ id }) => {
    try { return ok(await client.request("POST", `/automatic-calls/${id}/start`)); } catch (e) { return fail(e); }
  });

  server.tool("pause_automatic_call", "Pause an automatic-calls job.", { id: Id }, async ({ id }) => {
    try { return ok(await client.request("POST", `/automatic-calls/${id}/pause`)); } catch (e) { return fail(e); }
  });

  // ── Dispositions ──────────────────────────────────────────────────────────

  server.tool("get_disposition_config", "Get disposition taxonomy for an agent.", { agentId: Id }, async ({ agentId }) => {
    try { return ok(await client.request("GET", `/disposition/config/${agentId}`)); } catch (e) { return fail(e); }
  });

  server.tool(
    "set_disposition_config",
    "Set disposition taxonomy. Body: { taxonomy: { intent: ['interested','callback'], ... } }",
    { agentId: Id, taxonomy: z.record(z.array(z.string())) },
    async ({ agentId, taxonomy }) => {
      try { return ok(await client.request("PUT", `/disposition/config/${agentId}`, { body: { taxonomy } })); }
      catch (e) { return fail(e); }
    },
  );

  // ── Squads ────────────────────────────────────────────────────────────────

  server.tool("list_squads", "List multi-agent squads.", {}, async () => {
    try { return ok(await client.request("GET", "/squads")); } catch (e) { return fail(e); }
  });

  server.tool("list_squad_templates", "List squad templates.", {}, async () => {
    try { return ok(await client.request("GET", "/squads/templates")); } catch (e) { return fail(e); }
  });

  server.tool(
    "create_squad",
    "Create a squad.",
    { body: z.record(z.unknown()) },
    async ({ body }) => {
      try { return ok(await client.request("POST", "/squads", { body })); } catch (e) { return fail(e); }
    },
  );

  server.tool(
    "start_squad_run",
    "Start a squad run.",
    { id: Id, body: z.record(z.unknown()).optional() },
    async ({ id, body }) => {
      try { return ok(await client.request("POST", `/squads/${id}/runs`, { body: body ?? {} })); }
      catch (e) { return fail(e); }
    },
  );

  // ── Webcall links ─────────────────────────────────────────────────────────

  server.tool("list_webcall_links", "List browser webcall links for an agent.", { agentId: Id }, async ({ agentId }) => {
    try { return ok(await client.request("GET", `/agents/${agentId}/webcall-links`)); } catch (e) { return fail(e); }
  });

  server.tool(
    "create_webcall_link",
    "Create a shareable webcall link for an agent.",
    { agentId: Id, body: z.record(z.unknown()).optional() },
    async ({ agentId, body }) => {
      try { return ok(await client.request("POST", `/agents/${agentId}/webcall-links`, { body: body ?? {} })); }
      catch (e) { return fail(e); }
    },
  );

  // ── Providers / webhooks / wallet / analytics ──────────────────────────────

  server.tool("list_providers", "List BYO provider keys (ASR/LLM/TTS/telephony).", {}, async () => {
    try { return ok(await client.request("GET", "/providers")); } catch (e) { return fail(e); }
  });

  server.tool(
    "create_provider",
    "Add a provider API key. type: asr | llm | tts | telephony.",
    {
      type: z.enum(["asr", "llm", "tts", "telephony"]),
      provider: z.string(),
      apiKey: z.string(),
      extra: z.record(z.unknown()).optional(),
    },
    async ({ type, provider, apiKey, extra }) => {
      try {
        return ok(await client.request("POST", "/providers", {
          body: { type, provider, apiKey, ...(extra ?? {}) },
        }));
      } catch (e) { return fail(e); }
    },
  );

  server.tool("list_webhook_endpoints", "List account outbound webhook endpoints.", {}, async () => {
    try { return ok(await client.request("GET", "/webhook-endpoints")); } catch (e) { return fail(e); }
  });

  server.tool(
    "create_webhook_endpoint",
    "Create an outbound webhook endpoint for call events.",
    { url: z.string().url(), events: z.array(z.string()).optional(), secret: z.string().optional() },
    async ({ url, events, secret }) => {
      try { return ok(await client.request("POST", "/webhook-endpoints", { body: { url, events, secret } })); }
      catch (e) { return fail(e); }
    },
  );

  server.tool("get_wallet", "Get wallet balance and settings.", {}, async () => {
    try { return ok(await client.request("GET", "/wallet")); } catch (e) { return fail(e); }
  });

  server.tool(
    "list_transactions",
    "List wallet transactions.",
    { limit: z.number().optional(), offset: z.number().optional() },
    async ({ limit, offset }) => {
      try { return ok(await client.request("GET", "/wallet/transactions", { query: { limit, offset } })); }
      catch (e) { return fail(e); }
    },
  );

  server.tool("get_analytics_dashboard", "Account analytics overview.", {}, async () => {
    try { return ok(await client.request("GET", "/analytics/dashboard")); } catch (e) { return fail(e); }
  });

  server.tool("get_agent_analytics", "Per-agent analytics.", { agentId: Id }, async ({ agentId }) => {
    try { return ok(await client.request("GET", `/analytics/agents/${agentId}`)); } catch (e) { return fail(e); }
  });

  // silence unused Json type if needed
  void (0 as unknown as Json);
}

const HELP_TEXT = `# SnapServe MCP — workflows (app.snapserve.ai)

Auth: SNAPSERVE_API_KEY=sk_live_...  Base: https://app.snapserve.ai/api

## A→Z product map
1. Agents — create/update/toggle/publish (list_agents, create_agent, update_agent)
2. Phone numbers — list/assign (list_phone_numbers, assign_phone_number)
3. Knowledge — attach KB to agent (attach_knowledge)
4. Outbound call — outbound_call then get_call / get_call_logs
5. Website linking — create_campaign → get_website_webhook → paste URL into form
6. Campaign dialing — import_campaign_leads → start_campaign_batch
7. Journeys — list_journey_presets → create_journey → apply_journey_preset → activate_journey
8. WhatsApp — get_whatsapp_channel / create_whatsapp_connection (BYO BSP)
9. Email — get_email_channel / upsert_email_channel (Brevo)
10. Sheets auto-calls — list_automatic_calls / create_automatic_call / start_automatic_call
11. Dispositions — set_disposition_config
12. Squads — create_squad / start_squad_run
13. Webcall — create_webcall_link
14. CRM webhooks — create_webhook_endpoint or agent.webhookUrl via update_agent
15. Wallet / analytics — get_wallet, get_analytics_dashboard

## Website lead intake
POST https://app.snapserve.ai/api/webhooks/lead/{webhookToken}
Body example: { "phone": "+91...", "name": "Lead" }

## Escape hatch
Use snapserve_api for any path not wrapped above.

## Guardrails
- Confirm before delete_agent / delete_campaign
- Never print full API keys
- Do not invent transcripts — fetch get_call / get_call_logs
`;
