import { describe, expect, it } from "vitest";
import { collectBookingMailRecipients } from "./booking-mail-recipients.js";

describe("collectBookingMailRecipients", () => {
  it("mails customer, organizer host, additional hosts, and calendar owner", () => {
    const r = collectBookingMailRecipients({
      attendeeEmail: "customer@gmail.com",
      hostEmail: "organizer@company.com",
      additionalHosts: ["host2@company.com", "  host2@company.com  "],
      organizerEmail: "calendar-owner@gmail.com",
    });
    expect(r.customer).toBe("customer@gmail.com");
    expect(r.hosts).toEqual([
      "organizer@company.com",
      "host2@company.com",
      "calendar-owner@gmail.com",
    ]);
    expect(r.all).toEqual([
      "customer@gmail.com",
      "organizer@company.com",
      "host2@company.com",
      "calendar-owner@gmail.com",
    ]);
  });

  it("still notifies the Google calendar owner when hostEmail is empty", () => {
    const r = collectBookingMailRecipients({
      attendeeEmail: "customer@gmail.com",
      hostEmail: null,
      additionalHosts: null,
      organizerEmail: "calendar-owner@gmail.com",
    });
    expect(r.customer).toBe("customer@gmail.com");
    expect(r.hosts).toEqual(["calendar-owner@gmail.com"]);
  });

  it("does not double-mail when customer equals organizer", () => {
    const r = collectBookingMailRecipients({
      attendeeEmail: "same@gmail.com",
      hostEmail: "same@gmail.com",
      additionalHosts: ["extra@gmail.com"],
      organizerEmail: "same@gmail.com",
    });
    expect(r.customer).toBe("same@gmail.com");
    expect(r.hosts).toEqual(["extra@gmail.com"]);
    expect(r.all).toEqual(["same@gmail.com", "extra@gmail.com"]);
  });
});
