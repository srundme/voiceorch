import { SnapServeHttp, type SnapServeClientOptions, SnapServeApiError } from "./client.js";
import {
  AccountResource,
  AgentsResource,
  AnalyticsResource,
  CallsResource,
  PhoneNumbersResource,
  ProvidersResource,
  SchedulingResource,
  WalletResource,
  WebhookEndpointsResource,
} from "./resources.js";

export * from "./types.js";
export { SnapServeApiError };
export type { SnapServeClientOptions };

/**
 * SnapServe SDK client.
 *
 * ```ts
 * import { SnapServe } from "@snapserve/sdk";
 *
 * const snapserve = new SnapServe({ apiKey: process.env.SNAPSERVE_API_KEY! });
 * const agents = await snapserve.agents.list();
 * const call = await snapserve.calls.createOutbound({ agentId: agents[0].id, toNumber: "+15551234567" });
 * ```
 *
 * Any endpoint without a typed helper is reachable via `snapserve.request(method, path, options)`.
 */
export class SnapServe {
  private readonly http: SnapServeHttp;

  readonly agents: AgentsResource;
  readonly calls: CallsResource;
  readonly providers: ProvidersResource;
  readonly phoneNumbers: PhoneNumbersResource;
  readonly analytics: AnalyticsResource;
  readonly webhookEndpoints: WebhookEndpointsResource;
  readonly wallet: WalletResource;
  readonly account: AccountResource;
  readonly scheduling: SchedulingResource;

  constructor(options: SnapServeClientOptions) {
    this.http = new SnapServeHttp(options);

    this.agents = new AgentsResource(this.http);
    this.calls = new CallsResource(this.http);
    this.providers = new ProvidersResource(this.http);
    this.phoneNumbers = new PhoneNumbersResource(this.http);
    this.analytics = new AnalyticsResource(this.http);
    this.webhookEndpoints = new WebhookEndpointsResource(this.http);
    this.wallet = new WalletResource(this.http);
    this.account = new AccountResource(this.http);
    this.scheduling = new SchedulingResource(this.http);
  }

  /** Escape hatch for any endpoint this SDK doesn't wrap yet. */
  request<T = unknown>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    options?: { body?: unknown; query?: Record<string, string | number | boolean | undefined | null> },
  ): Promise<T> {
    return this.http.request<T>(method, path, options);
  }
}

export default SnapServe;
