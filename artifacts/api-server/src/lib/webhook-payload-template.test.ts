import { describe, expect, it } from "vitest";
import {
  MAX_WEBHOOK_PAYLOAD_TEMPLATE_CHARS,
  WEBHOOK_PAYLOAD_HEADER,
  buildAgentNotifyHeaders,
  readWebhookPayloadTemplate,
  renderWebhookPayloadTemplate,
  serializeAgentWebhookBody,
} from "./webhook-payload-template.js";

const payload = {
  callId: 2920,
  status: "completed",
  transcript: "Agent: Hello",
  callSummary: "Asked about pricing",
  dispositionResult: { outcome: "interested", order_status: "shipped" },
  durationSeconds: 84,
};

describe("renderWebhookPayloadTemplate", () => {
  it("preserves JSON types for quoted whole-token placeholders", () => {
    const result = renderWebhookPayloadTemplate(
      `{
        "id": "{{callId}}",
        "status": "{{status}}",
        "transcript": "{{transcript}}",
        "data": "{{dispositionResult}}"
      }`,
      payload,
    );
    expect(result).toEqual({
      body: {
        id: 2920,
        status: "completed",
        transcript: "Agent: Hello",
        data: { outcome: "interested", order_status: "shipped" },
      },
    });
  });

  it("interpolates scalars inside a larger string", () => {
    const result = renderWebhookPayloadTemplate(
      `{ "note": "Call {{callId}} ended with {{status}}" }`,
      payload,
    );
    expect(result).toEqual({
      body: { note: "Call 2920 ended with completed" },
    });
  });

  it("escapes quotes and newlines inside interpolated strings", () => {
    const result = renderWebhookPayloadTemplate(
      `{ "t": "said: {{transcript}}" }`,
      { transcript: 'He said "hi"\nnext' },
    );
    expect(result).toEqual({ body: { t: 'said: He said "hi"\nnext' } });
  });

  it("maps snake_case aliases to camelCase payload keys", () => {
    const result = renderWebhookPayloadTemplate(
      `{ "id": "{{call_id}}", "nested": "{{disposition_result.outcome}}" }`,
      payload,
    );
    expect(result).toEqual({ body: { id: 2920, nested: "interested" } });
  });

  it("missing paths become null", () => {
    const result = renderWebhookPayloadTemplate(
      `{ "missing": "{{nope}}", "nested": "{{dispositionResult.missing}}" }`,
      payload,
    );
    expect(result).toEqual({ body: { missing: null, nested: null } });
  });

  it("rejects prototype-polluting paths", () => {
    const result = renderWebhookPayloadTemplate(
      `{ "x": "{{__proto__.polluted}}" }`,
      payload,
    );
    expect(result).toEqual({ body: { x: null } });
  });

  it("returns invalid_json when the rendered template is not JSON", () => {
    const result = renderWebhookPayloadTemplate(`{ "id": "{{callId}}", }`, payload);
    expect(result).toEqual({ error: "invalid_json" });
  });

  it("returns template_too_large over the cap", () => {
    const huge = `{ "x": "${"a".repeat(MAX_WEBHOOK_PAYLOAD_TEMPLATE_CHARS)}" }`;
    expect(renderWebhookPayloadTemplate(huge, payload)).toEqual({ error: "template_too_large" });
  });

  it("supports a bare token as a nested JSON value", () => {
    const result = renderWebhookPayloadTemplate(
      `{ "data": {{dispositionResult}} }`,
      payload,
    );
    expect(result).toEqual({
      body: { data: { outcome: "interested", order_status: "shipped" } },
    });
  });
});

describe("serializeAgentWebhookBody", () => {
  it("sends the default payload when the template is blank", () => {
    expect(serializeAgentWebhookBody("  ", payload)).toEqual({
      bodyStr: JSON.stringify(payload),
      mode: "default",
    });
    expect(serializeAgentWebhookBody(null, payload).mode).toBe("default");
  });

  it("falls back to the default payload when the template is invalid JSON", () => {
    const result = serializeAgentWebhookBody(`{ "id": "{{callId}}", }`, payload);
    expect(result.mode).toBe("default");
    expect(result.error).toBe("invalid_json");
    expect(result.bodyStr).toBe(JSON.stringify(payload));
  });

  it("HMAC-relevant body is the custom JSON string", () => {
    const result = serializeAgentWebhookBody(`{ "id": "{{callId}}" }`, payload);
    expect(result).toEqual({ bodyStr: '{"id":2920}', mode: "custom" });
  });
});

describe("readWebhookPayloadTemplate", () => {
  it("reads a non-empty string from agentConfig", () => {
    expect(readWebhookPayloadTemplate({ webhookPayloadTemplate: " { } " })).toBe("{ }");
    expect(readWebhookPayloadTemplate({ webhookPayloadTemplate: "   " })).toBeNull();
    expect(readWebhookPayloadTemplate({})).toBeNull();
    expect(readWebhookPayloadTemplate(null)).toBeNull();
  });
});

describe("buildAgentNotifyHeaders", () => {
  it("marks custom vs default and signs the body actually sent", () => {
    const custom = buildAgentNotifyHeaders('{"id":2920}', "custom", "s3cr3t");
    expect(custom["Content-Type"]).toBe("application/json");
    expect(custom[WEBHOOK_PAYLOAD_HEADER]).toBe("custom");
    expect(custom["X-SnapServe-Signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(custom["X-VoiceOrch-Signature"]).toBe(custom["X-SnapServe-Signature"]);

    const unsigned = buildAgentNotifyHeaders("{}", "default", "  ");
    expect(unsigned[WEBHOOK_PAYLOAD_HEADER]).toBe("default");
    expect(unsigned["X-SnapServe-Signature"]).toBeUndefined();
  });
});
