import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Hoisted mock state shared between vi.mock() factories and test code.
 * vi.hoisted() ensures these values are initialised before any mock factory runs.
 */
const mockState = vi.hoisted(() => {
  const sendMail = vi.fn().mockResolvedValue({});
  const createTransport = vi.fn().mockReturnValue({ sendMail });
  return {
    email: null as string | null,
    slackWebhook: null as string | null,
    minSeverity: "warning" as string,
    cooldownMinutes: 10 as number,
    dbCallIdx: 0,
    createTransport,
    sendMail,
  };
});

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          const order: Array<keyof typeof mockState> = [
            "email",
            "slackWebhook",
            "minSeverity",
            "cooldownMinutes",
          ];
          const key = order[mockState.dbCallIdx++] as keyof typeof mockState;
          const val = mockState[key];
          if (val === null || val === undefined) return Promise.resolve([]);
          return Promise.resolve([{ value: String(val) }]);
        }),
      })),
    })),
  },
  platformSettingsTable: { key: "key", value: "value" },
  eq: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: mockState.createTransport },
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { dispatchAlertNotification, __resetCooldownState } from "./alert-notifications.js";

const BASE_OPTS = {
  type: "low_balance" as const,
  title: "Test Alert",
  message: "Test message",
};

function setupSettings(settings: {
  email?: string | null;
  slackWebhook?: string | null;
  minSeverity?: string;
  cooldownMinutes?: number;
}) {
  mockState.email = settings.email ?? null;
  mockState.slackWebhook = settings.slackWebhook ?? null;
  mockState.minSeverity = settings.minSeverity ?? "warning";
  mockState.cooldownMinutes = settings.cooldownMinutes ?? 10;
  mockState.dbCallIdx = 0;
}

beforeEach(() => {
  __resetCooldownState();
  vi.useFakeTimers();

  process.env["GMAIL_USER"] = "test@example.com";
  process.env["GMAIL_APP_PASSWORD"] = "secret";

  mockState.sendMail.mockClear();
  mockState.createTransport.mockClear();

  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200 }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env["GMAIL_USER"];
  delete process.env["GMAIL_APP_PASSWORD"];
});

describe("dispatchAlertNotification — cooldown and escalation logic", () => {
  describe("first notification (no prior state)", () => {
    it("dispatches when no prior notification has been sent", async () => {
      setupSettings({ email: "admin@example.com", cooldownMinutes: 10 });

      await dispatchAlertNotification({ ...BASE_OPTS, severity: "warning" });

      expect(mockState.sendMail).toHaveBeenCalledOnce();
    });
  });

  describe("within cooldown window — same severity", () => {
    it("suppresses a second notification at the same severity", async () => {
      setupSettings({ email: "admin@example.com", cooldownMinutes: 10 });

      await dispatchAlertNotification({ ...BASE_OPTS, severity: "warning" });
      setupSettings({ email: "admin@example.com", cooldownMinutes: 10 });

      vi.advanceTimersByTime(5 * 60 * 1000);

      await dispatchAlertNotification({ ...BASE_OPTS, severity: "warning" });

      expect(mockState.sendMail).toHaveBeenCalledOnce();
    });

    it("suppresses a repeated 'critical' notification within cooldown", async () => {
      setupSettings({ email: "admin@example.com", cooldownMinutes: 10 });

      await dispatchAlertNotification({ ...BASE_OPTS, severity: "critical" });
      setupSettings({ email: "admin@example.com", cooldownMinutes: 10 });

      vi.advanceTimersByTime(3 * 60 * 1000);

      await dispatchAlertNotification({ ...BASE_OPTS, severity: "critical" });

      expect(mockState.sendMail).toHaveBeenCalledOnce();
    });
  });

  describe("within cooldown window — lower severity", () => {
    it("suppresses a lower-severity follow-up (critical → warning within cooldown)", async () => {
      setupSettings({ email: "admin@example.com", cooldownMinutes: 10 });

      await dispatchAlertNotification({ ...BASE_OPTS, severity: "critical" });
      setupSettings({ email: "admin@example.com", cooldownMinutes: 10 });

      vi.advanceTimersByTime(2 * 60 * 1000);

      await dispatchAlertNotification({ ...BASE_OPTS, severity: "warning" });

      expect(mockState.sendMail).toHaveBeenCalledOnce();
    });

    it("suppresses a lower-severity follow-up (warning → info within cooldown)", async () => {
      setupSettings({ email: "admin@example.com", cooldownMinutes: 10 });

      await dispatchAlertNotification({ ...BASE_OPTS, severity: "warning" });
      setupSettings({ email: "admin@example.com", cooldownMinutes: 10 });

      vi.advanceTimersByTime(4 * 60 * 1000);

      await dispatchAlertNotification({ ...BASE_OPTS, severity: "info" });

      expect(mockState.sendMail).toHaveBeenCalledOnce();
    });
  });

  describe("within cooldown window — higher severity (escalation bypass)", () => {
    it("dispatches immediately when severity escalates from warning to critical", async () => {
      setupSettings({ email: "admin@example.com", cooldownMinutes: 10 });

      await dispatchAlertNotification({ ...BASE_OPTS, severity: "warning" });
      setupSettings({ email: "admin@example.com", cooldownMinutes: 10 });

      vi.advanceTimersByTime(2 * 60 * 1000);

      await dispatchAlertNotification({ ...BASE_OPTS, severity: "critical" });

      expect(mockState.sendMail).toHaveBeenCalledTimes(2);
    });

    it("dispatches immediately when severity escalates from info to warning", async () => {
      setupSettings({
        email: "admin@example.com",
        cooldownMinutes: 10,
        minSeverity: "info",
      });

      await dispatchAlertNotification({ ...BASE_OPTS, severity: "info" });
      setupSettings({
        email: "admin@example.com",
        cooldownMinutes: 10,
        minSeverity: "info",
      });

      vi.advanceTimersByTime(1 * 60 * 1000);

      await dispatchAlertNotification({ ...BASE_OPTS, severity: "warning" });

      expect(mockState.sendMail).toHaveBeenCalledTimes(2);
    });

    it("dispatches immediately when severity escalates from info to critical", async () => {
      setupSettings({
        email: "admin@example.com",
        cooldownMinutes: 10,
        minSeverity: "info",
      });

      await dispatchAlertNotification({ ...BASE_OPTS, severity: "info" });
      setupSettings({
        email: "admin@example.com",
        cooldownMinutes: 10,
        minSeverity: "info",
      });

      vi.advanceTimersByTime(30 * 1000);

      await dispatchAlertNotification({ ...BASE_OPTS, severity: "critical" });

      expect(mockState.sendMail).toHaveBeenCalledTimes(2);
    });
  });

  describe("after cooldown window expires", () => {
    it("dispatches any severity once the cooldown window has elapsed", async () => {
      setupSettings({ email: "admin@example.com", cooldownMinutes: 10 });

      await dispatchAlertNotification({ ...BASE_OPTS, severity: "warning" });
      setupSettings({ email: "admin@example.com", cooldownMinutes: 10 });

      vi.advanceTimersByTime(11 * 60 * 1000);

      await dispatchAlertNotification({ ...BASE_OPTS, severity: "warning" });

      expect(mockState.sendMail).toHaveBeenCalledTimes(2);
    });

    it("dispatches lower severity after the cooldown window has elapsed", async () => {
      setupSettings({ email: "admin@example.com", minSeverity: "info", cooldownMinutes: 10 });

      await dispatchAlertNotification({ ...BASE_OPTS, severity: "critical" });
      setupSettings({ email: "admin@example.com", minSeverity: "info", cooldownMinutes: 10 });

      vi.advanceTimersByTime(10 * 60 * 1000 + 1);

      await dispatchAlertNotification({ ...BASE_OPTS, severity: "info" });

      expect(mockState.sendMail).toHaveBeenCalledTimes(2);
    });
  });

  describe("Slack webhook channel", () => {
    it("dispatches via Slack when configured and not suppressed", async () => {
      setupSettings({ slackWebhook: "https://hooks.slack.com/test", cooldownMinutes: 10 });

      await dispatchAlertNotification({ ...BASE_OPTS, severity: "warning" });

      expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
    });

    it("suppresses Slack notification for same severity within cooldown", async () => {
      setupSettings({ slackWebhook: "https://hooks.slack.com/test", cooldownMinutes: 10 });

      await dispatchAlertNotification({ ...BASE_OPTS, severity: "warning" });
      setupSettings({ slackWebhook: "https://hooks.slack.com/test", cooldownMinutes: 10 });

      vi.advanceTimersByTime(5 * 60 * 1000);

      await dispatchAlertNotification({ ...BASE_OPTS, severity: "warning" });

      expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
    });

    it("bypasses cooldown for Slack when severity escalates", async () => {
      setupSettings({ slackWebhook: "https://hooks.slack.com/test", cooldownMinutes: 10 });

      await dispatchAlertNotification({ ...BASE_OPTS, severity: "warning" });
      setupSettings({ slackWebhook: "https://hooks.slack.com/test", cooldownMinutes: 10 });

      vi.advanceTimersByTime(3 * 60 * 1000);

      await dispatchAlertNotification({ ...BASE_OPTS, severity: "critical" });

      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    });
  });

  describe("minimum severity filter", () => {
    it("does not dispatch when alert severity is below the configured minimum", async () => {
      setupSettings({ email: "admin@example.com", minSeverity: "critical", cooldownMinutes: 10 });

      await dispatchAlertNotification({ ...BASE_OPTS, severity: "warning" });

      expect(mockState.sendMail).not.toHaveBeenCalled();
    });

    it("dispatches when alert severity meets the configured minimum", async () => {
      setupSettings({ email: "admin@example.com", minSeverity: "warning", cooldownMinutes: 10 });

      await dispatchAlertNotification({ ...BASE_OPTS, severity: "warning" });

      expect(mockState.sendMail).toHaveBeenCalledOnce();
    });
  });

  describe("zero cooldown", () => {
    it("dispatches every notification when cooldown is set to 0", async () => {
      setupSettings({ email: "admin@example.com", minSeverity: "info", cooldownMinutes: 0 });

      await dispatchAlertNotification({ ...BASE_OPTS, severity: "warning" });
      setupSettings({ email: "admin@example.com", minSeverity: "info", cooldownMinutes: 0 });

      await dispatchAlertNotification({ ...BASE_OPTS, severity: "info" });

      expect(mockState.sendMail).toHaveBeenCalledTimes(2);
    });
  });
});
