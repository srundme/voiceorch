import { describe, expect, it } from "vitest";
import { encodeGmailRawMessage, GMAIL_SEND_SCOPE, hasGmailSendScope } from "./gmail-raw.js";

describe("encodeGmailRawMessage", () => {
  it("puts the connected Google email in From, not a platform mailbox", () => {
    const raw = encodeGmailRawMessage({
      from: "beniciaalwin2005@gmail.com",
      to: "guest@example.com",
      subject: "Booking Rescheduled: Murali — consultants",
      html: "<p>Meet</p>",
    });
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toContain("From: beniciaalwin2005@gmail.com");
    expect(decoded).toContain("To: guest@example.com");
    expect(decoded).not.toContain("gopinwrk@gmail.com");
  });
});

describe("GMAIL_SEND_SCOPE", () => {
  it("is the Gmail send scope so booking mail can leave the linked inbox", () => {
    expect(GMAIL_SEND_SCOPE).toBe("https://www.googleapis.com/auth/gmail.send");
  });
});

describe("hasGmailSendScope", () => {
  it("accepts a grant that includes the send scope", () => {
    expect(hasGmailSendScope(
      `https://www.googleapis.com/auth/calendar ${GMAIL_SEND_SCOPE}`,
    )).toBe(true);
    expect(hasGmailSendScope(`https://www.googleapis.com/auth/calendar,${GMAIL_SEND_SCOPE}`)).toBe(true);
  });

  it("rejects older grants so we do not try a send that must 403", () => {
    expect(hasGmailSendScope("https://www.googleapis.com/auth/calendar")).toBe(false);
    expect(hasGmailSendScope("")).toBe(false);
    expect(hasGmailSendScope(null)).toBe(false);
  });

  it("does not match a broader gmail scope string by accident", () => {
    expect(hasGmailSendScope("https://www.googleapis.com/auth/gmail.sendasomething")).toBe(false);
  });
});
