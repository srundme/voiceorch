/**
 * Curated public API surface for /docs/api-reference.
 * Campaigns, admin, CRM, onboarding, etc. are intentionally excluded.
 */

export const PUBLIC_TAG_ORDER = [
  "agents",
  "calls",
  "agent-variables",
  "webhook-endpoints",
  "phone-numbers",
  "wallet",
  "knowledge",
] as const;

/** Docs UI tag overrides (raw OpenAPI tag → display group). */
export const OP_TAG_OVERRIDE: Record<string, string> = {
  listAgentVariables: "agent-variables",
  createAgentVariable: "agent-variables",
  updateAgentVariable: "agent-variables",
  deleteAgentVariable: "agent-variables",
};

/** Only these operationIds appear in the API Reference. */
export const PUBLIC_OPERATION_IDS = new Set<string>([
  // Agents
  "listAgents",
  "createAgent",
  "getAgent",
  "updateAgent",
  "toggleAgent",
  "deleteAgent",

  // Calls — transcript / summary / disposition on getCall
  "initiateOutboundCall",
  "listCalls",
  "getCall",
  "endCall",
  "updateCallDisposition",
  "transferCall",

  // Variables
  "listAgentVariables",
  "createAgentVariable",
  "updateAgentVariable",
  "deleteAgentVariable",

  // Webhooks
  "listWebhookEndpoints",
  "createWebhookEndpoint",
  "updateWebhookEndpoint",
  "deleteWebhookEndpoint",

  // Phone numbers (assign for dialer apps)
  "listPhoneNumbers",
  "assignPhoneNumber",

  // Wallet (balance for metering)
  "getWallet",
  "listTransactions",

  // Knowledge
  "listKnowledgeSources",
  "attachKnowledgeSourceToAgent",
  "searchKnowledge",
]);

export const TAG_LABELS: Record<string, string> = {
  agents: "Agents",
  calls: "Calls",
  "agent-variables": "Variables",
  "webhook-endpoints": "Webhooks",
  "phone-numbers": "Phone Numbers",
  wallet: "Wallet",
  knowledge: "Knowledge Base",
};
