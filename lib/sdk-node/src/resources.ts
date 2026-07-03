import type { SnapServeHttp } from "./client.js";
import type {
  AccountInfo,
  Agent,
  AgentInput,
  AgentUpdate,
  Call,
  CallEndPayload,
  CallInput,
  CallStatusCount,
  CallUpdate,
  DailyCallVolume,
  DashboardStats,
  OutboundCallInput,
  PhoneNumber,
  ProviderConfig,
  ProviderInput,
  ProviderUpdate,
  SchedulingBooking,
  SchedulingCalendar,
  SchedulingEventType,
  SchedulingSlot,
  TransferCallInput,
  WalletInfo,
  WebhookEndpoint,
  WebhookEndpointInput,
  WebhookEndpointUpdate,
} from "./types.js";

export class AgentsResource {
  constructor(private readonly http: SnapServeHttp) {}

  list(): Promise<Agent[]> {
    return this.http.request("GET", "/agents");
  }

  get(id: number): Promise<Agent> {
    return this.http.request("GET", `/agents/${id}`);
  }

  create(input: AgentInput): Promise<Agent> {
    return this.http.request("POST", "/agents", { body: input });
  }

  update(id: number, input: AgentUpdate): Promise<Agent> {
    return this.http.request("PATCH", `/agents/${id}`, { body: input });
  }

  delete(id: number): Promise<void> {
    return this.http.request("DELETE", `/agents/${id}`);
  }

  toggle(id: number): Promise<Agent> {
    return this.http.request("PATCH", `/agents/${id}/toggle`);
  }
}

export class CallsResource {
  constructor(private readonly http: SnapServeHttp) {}

  list(params: { agentId?: number; status?: string } = {}): Promise<Call[]> {
    return this.http.request("GET", "/calls", { query: params });
  }

  get(id: number): Promise<Call> {
    return this.http.request("GET", `/calls/${id}`);
  }

  create(input: CallInput): Promise<Call> {
    return this.http.request("POST", "/calls", { body: input });
  }

  update(id: number, input: CallUpdate): Promise<Call> {
    return this.http.request("PATCH", `/calls/${id}`, { body: input });
  }

  /** Places an outbound phone call using the agent's configured telephony provider. */
  createOutbound(input: OutboundCallInput): Promise<Call> {
    return this.http.request("POST", "/calls/outbound", { body: input });
  }

  transfer(id: number, input: TransferCallInput): Promise<Call> {
    return this.http.request("POST", `/calls/${id}/transfer`, { body: input });
  }

  end(id: number, payload: CallEndPayload = {}): Promise<Call> {
    return this.http.request("PATCH", `/calls/${id}/end`, { body: payload });
  }

  setDisposition(id: number, dispositionResult: Record<string, string | number | boolean>): Promise<Call> {
    return this.http.request("PATCH", `/calls/${id}/disposition`, { body: { dispositionResult } });
  }
}

export class ProvidersResource {
  constructor(private readonly http: SnapServeHttp) {}

  list(): Promise<ProviderConfig[]> {
    return this.http.request("GET", "/providers");
  }

  create(input: ProviderInput): Promise<ProviderConfig> {
    return this.http.request("POST", "/providers", { body: input });
  }

  update(id: number, input: ProviderUpdate): Promise<ProviderConfig> {
    return this.http.request("PATCH", `/providers/${id}`, { body: input });
  }

  delete(id: number): Promise<void> {
    return this.http.request("DELETE", `/providers/${id}`);
  }
}

export class PhoneNumbersResource {
  constructor(private readonly http: SnapServeHttp) {}

  list(): Promise<PhoneNumber[]> {
    return this.http.request("GET", "/phone-numbers");
  }

  assign(id: number, agentId: number | null): Promise<PhoneNumber> {
    return this.http.request("PATCH", `/phone-numbers/${id}/assign`, { body: { agentId } });
  }

  release(id: number): Promise<void> {
    return this.http.request("DELETE", `/phone-numbers/${id}`);
  }
}

export class AnalyticsResource {
  constructor(private readonly http: SnapServeHttp) {}

  dashboard(): Promise<DashboardStats> {
    return this.http.request("GET", "/analytics/dashboard");
  }

  recentCalls(): Promise<Call[]> {
    return this.http.request("GET", "/analytics/calls/recent");
  }

  callsByStatus(): Promise<CallStatusCount[]> {
    return this.http.request("GET", "/analytics/calls/by-status");
  }

  dailyCallVolume(): Promise<DailyCallVolume[]> {
    return this.http.request("GET", "/analytics/calls/daily");
  }

  agentStats(agentId: number): Promise<DashboardStats> {
    return this.http.request("GET", `/analytics/agents/${agentId}`);
  }
}

export class WebhookEndpointsResource {
  constructor(private readonly http: SnapServeHttp) {}

  list(): Promise<WebhookEndpoint[]> {
    return this.http.request("GET", "/webhook-endpoints");
  }

  create(input: WebhookEndpointInput): Promise<WebhookEndpoint> {
    return this.http.request("POST", "/webhook-endpoints", { body: input });
  }

  update(id: number, input: WebhookEndpointUpdate): Promise<WebhookEndpoint> {
    return this.http.request("PATCH", `/webhook-endpoints/${id}`, { body: input });
  }

  delete(id: number): Promise<void> {
    return this.http.request("DELETE", `/webhook-endpoints/${id}`);
  }
}

export class WalletResource {
  constructor(private readonly http: SnapServeHttp) {}

  get(): Promise<WalletInfo> {
    return this.http.request("GET", "/wallet");
  }

  transactions(params: { limit?: number; offset?: number } = {}): Promise<unknown[]> {
    return this.http.request("GET", "/wallet/transactions", { query: params });
  }
}

export class AccountResource {
  constructor(private readonly http: SnapServeHttp) {}

  get(): Promise<AccountInfo> {
    return this.http.request("GET", "/account");
  }
}

export class SchedulingResource {
  constructor(private readonly http: SnapServeHttp) {}

  listCalendars(): Promise<SchedulingCalendar[]> {
    return this.http.request("GET", "/scheduling/calendars");
  }

  listEventTypes(): Promise<SchedulingEventType[]> {
    return this.http.request("GET", "/scheduling/event-types");
  }

  listBookings(): Promise<SchedulingBooking[]> {
    return this.http.request("GET", "/scheduling/bookings");
  }

  /** Public (no-auth) slot lookup by event-type slug — useful for building a custom booking UI. */
  publicSlots(params: { slug: string; timeZone: string; date?: string }): Promise<SchedulingSlot[]> {
    return this.http.request("GET", "/scheduling/public/slots", { query: params });
  }

  /** Public (no-auth) booking creation for an attendee-facing flow. */
  publicCreateBooking(input: Record<string, unknown>): Promise<SchedulingBooking> {
    return this.http.request("POST", "/scheduling/public/bookings", { body: input });
  }
}
