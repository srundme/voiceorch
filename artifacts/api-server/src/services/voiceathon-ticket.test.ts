import { describe, expect, it } from "vitest";
import {
  renderVoiceathonTicketPdf,
  voiceathonTicketEmailHtml,
} from "./voiceathon-ticket.js";

const details = {
  ticketCode: "VA-ABCDEF1234",
  eventTitle: "SnapServe Voice-a-thon",
  teamName: "Runtime Rebels",
  leaderName: "Ada Lovelace",
  leaderEmail: "ada@example.com",
  venue: "SnapServe HQ, Bengaluru",
  eventStartsAt: new Date("2026-08-01T04:30:00.000Z"),
  teamSize: 4,
};

describe("voiceathon approval ticket", () => {
  it("renders a valid PDF attachment", async () => {
    const pdf = await renderVoiceathonTicketPdf(details);
    expect(pdf.subarray(0, 4).toString("ascii")).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1_000);
  });

  it("renders tech-style email details and escapes untrusted fields", () => {
    const html = voiceathonTicketEmailHtml({
      ...details,
      teamName: "<script>alert(1)</script>",
    });
    expect(html).toContain("ACCESS GRANTED");
    expect(html).toContain("VA-ABCDEF1234");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
