/**
 * Curated public API surface for the docs API Reference (Bolna-style).
 * Everything else in OpenAPI stays in the yaml for the product, but is hidden
 * from /docs/api-reference so builders only see useful endpoints.
 */

export const PUBLIC_TAG_ORDER = [
  "agents",
  "calls",
  "agent-variables",
  "webhook-endpoints",
  "phone-numbers",
  "wallet",
  "knowledge",
  "scheduling",
  "account",
] as const;

/** Prefer grouping some ops under a friendlier tag in the docs UI. */
export const OP_TAG_OVERRIDE: Record<string, string> = {
  listAgentVariables: "agent-variables",
  createAgentVariable: "agent-variables",
  updateAgentVariable: "agent-variables",
  deleteAgentVariable: "agent-variables",
  getAccount: "account",
  regenerateApiKey: "account",
};

export const PUBLIC_OPERATION_IDS = new Set<string>([
  // Agents
  "listAgents",
  "createAgent",
  "getAgent",
  "updateAgent",
  "toggleAgent",
  "deleteAgent",
  "listAgentTemplates",
  "publishAgentVersion",
  "listAgentVersions",
  "getAgentVersion",

  // Agent variables
  "listAgentVariables",
  "createAgentVariable",
  "updateAgentVariable",
  "deleteAgentVariable",

  // Calls (transcript / summary live on getCall)
  "initiateOutboundCall",
  "listCalls",
  "getCall",
  "endCall",
  "updateCallDisposition",
  "transferCall",
  "getRecentCalls",

  // Webhooks
  "listWebhookEndpoints",
  "createWebhookEndpoint",
  "updateWebhookEndpoint",
  "deleteWebhookEndpoint",

  // Phone numbers
  "listPhoneNumbers",
  "listAvailablePhoneNumbers",
  "initiatePhoneNumberPurchase",
  "confirmPhoneNumberPurchase",
  "assignPhoneNumber",
  "releasePhoneNumber",
  "getKycStatus",

  // Wallet
  "getWallet",
  "listTransactions",
  "createTopup",
  "verifyPayment",
  "updateAutopay",

  // Knowledge
  "listKnowledgeSources",
  "createKnowledgeSource",
  "uploadKnowledgeSource",
  "getKnowledgeSource",
  "updateKnowledgeSource",
  "deleteKnowledgeSource",
  "attachKnowledgeSourceToAgent",
  "searchKnowledge",

  // Scheduling / calendars
  "listCalendars",
  "createCalendar",
  "getCalendar",
  "updateCalendar",
  "deleteCalendar",
  "listEventTypes",
  "createEventType",
  "getEventType",
  "updateEventType",
  "deleteEventType",
  "listAvailability",
  "createAvailability",
  "updateAvailability",
  "deleteAvailability",
  "getAvailableSlots",
  "listBookings",
  "createBooking",
  "getBooking",
  "updateBooking",

  // Account
  "getAccount",
  "regenerateApiKey",
]);

export const TAG_LABELS: Record<string, string> = {
  agents: "Agents",
  calls: "Calls",
  "agent-variables": "Variables",
  "webhook-endpoints": "Webhooks",
  "phone-numbers": "Phone Numbers",
  wallet: "Wallet",
  knowledge: "Knowledge Base",
  scheduling: "Scheduling",
  account: "Account",
};
