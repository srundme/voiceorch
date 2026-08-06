import { describe, expect, it } from "vitest";
import {
  categoriesToTaxonomy,
  slugDispositionKey,
  toStoredDomainField,
  taxonomyToCategories,
} from "./disposition-fields";

describe("disposition-fields", () => {
  it("slugifies and maps phone fields", () => {
    expect(slugDispositionKey("WhatsApp number")).toBe("whatsapp_number");
    expect(
      toStoredDomainField({
        id: "1",
        label: "WhatsApp number",
        key: "whatsapp_number",
        uiType: "phone",
      }),
    ).toEqual({
      key: "whatsapp_number",
      type: "string",
      label: "WhatsApp number",
    });
  });

  it("round-trips taxonomy categories", () => {
    const taxonomy = { outcome: ["interested", "callback"] };
    const cats = taxonomyToCategories(taxonomy);
    expect(categoriesToTaxonomy(cats)).toEqual(taxonomy);
  });
});
