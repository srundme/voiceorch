import { describe, expect, it } from "vitest";
import {
  canCommitDispositionSave,
  categoriesToTaxonomy,
  hasIncompleteDispositionDrafts,
  isDispositionCommitKey,
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

  it("does not persist a new category or field before the user types", () => {
    expect(
      hasIncompleteDispositionDrafts(
        [{ id: "c1", name: "", values: "" }],
        [],
      ),
    ).toBe(true);
    expect(
      hasIncompleteDispositionDrafts(
        [],
        [{ id: "f1", label: "", key: "", uiType: "text" }],
      ),
    ).toBe(true);
    expect(toStoredDomainField({ id: "f1", label: "", key: "", uiType: "text" })).toBeNull();
    expect(
      hasIncompleteDispositionDrafts(
        [{ id: "c1", name: "outcome", values: "interested" }],
        [{ id: "f1", label: "City", key: "city", uiType: "text" }],
      ),
    ).toBe(false);
    expect(
      canCommitDispositionSave(
        true,
        [{ id: "c1", name: "outcome", values: "interested" }],
        [],
      ),
    ).toBe(true);
    expect(
      canCommitDispositionSave(true, [{ id: "c1", name: "", values: "" }], []),
    ).toBe(false);
    expect(isDispositionCommitKey("Enter")).toBe(true);
    expect(isDispositionCommitKey("Enter", true)).toBe(false);
    expect(isDispositionCommitKey("Tab")).toBe(false);
  });
});
