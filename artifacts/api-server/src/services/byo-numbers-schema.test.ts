import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, phoneNumbersTable: {}, providersTable: {}, platformSettingsTable: {} }));

import { ListPhoneNumbersResponseItem } from "@workspace/api-zod";
import { BYO_VOBIZ_PROVIDER } from "./byo-numbers.js";

// The Numbers list validates every row against this schema. A provider value
// missing from the enum makes the whole list fail with a 500.
describe("phone number response schema", () => {
  it("accepts every provider the BYO sync writes", () => {
    for (const provider of ["vobiz", "plivo", BYO_VOBIZ_PROVIDER]) {
      expect(ListPhoneNumbersResponseItem.shape.provider.safeParse(provider).success, provider).toBe(true);
    }
  });
});
