/**
 * Loose, forward-compatible types for the SnapServe API.
 *
 * These intentionally use an index signature so the SDK does not break
 * when the server adds new fields. Treat them as "at least this shape".
 */

export type Loose<T extends Record<string, unknown>> = T & { [key: string]: unknown };

export type Agent = Loose<{
  id: number;
  name: string;
  status: "active" | "inactive" | string;
  asrProvider?: string | null;
  llmProvider?: string | null;
  ttsProvider?: string | null;
  telephonyProvider?: string | null;
  language?: string | null;
  createdAt?: string;
  updatedAt?: string;
}>;

export type AgentInput = Loose<Record<string, unknown>>;
export type AgentUpdate = Loose<Record<string, unknown>>;

export type Call = Loose<{
  id: number;
  agentId: number;
  status: string;
  direction?: "inbound" | "outbound" | string;
  fromNumber?: string | null;
  toNumber?: string | null;
  durationSeconds?: number | null;
  transcript?: string | null;
  summary?: string | null;
  createdAt?: string;
  endedAt?: string | null;
}>;

export type CallInput = Loose<Record<string, unknown>>;
export type CallUpdate = Loose<Record<string, unknown>>;
export type OutboundCallInput = Loose<{ agentId: number; toNumber: string }>;
export type TransferCallInput = Loose<{ to: string }>;
export type CallEndPayload = Loose<Record<string, unknown>>;

export type ProviderConfig = Loose<{
  id: number;
  type: "asr" | "llm" | "tts" | "telephony" | string;
  provider: string;
  keyHint?: string | null;
  createdAt?: string;
}>;

export type ProviderInput = Loose<{ type: string; provider: string; apiKey: string }>;
export type ProviderUpdate = Loose<Record<string, unknown>>;

export type PhoneNumber = Loose<{
  id: number;
  phoneNumber: string;
  agentId?: number | null;
  countryCode?: string;
  monthlyRateCents?: number;
}>;

export type WebhookEndpoint = Loose<{
  id: number;
  url: string;
  events: string[];
  active?: boolean;
}>;

export type WebhookEndpointInput = Loose<{ url: string; events: string[] }>;
export type WebhookEndpointUpdate = Loose<Record<string, unknown>>;

export type WalletInfo = Loose<{ balanceCents: number; autoPayEnabled?: boolean }>;
export type AccountInfo = Loose<{ apiKey?: string; concurrentCallLimit?: number }>;

export type DashboardStats = Loose<Record<string, unknown>>;
export type CallStatusCount = Loose<{ status: string; count: number }>;
export type DailyCallVolume = Loose<{ date: string; count: number }>;

export type SchedulingCalendar = Loose<{ id: number; name: string }>;
export type SchedulingEventType = Loose<{ id: number; slug: string; title: string; durationMinutes: number }>;
export type SchedulingBooking = Loose<{ id: number; eventTypeId: number; startTime: string; endTime: string }>;
export type SchedulingSlot = Loose<{ start: string; end: string }>;
