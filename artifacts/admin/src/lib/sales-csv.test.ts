import { describe, expect, it } from "vitest";
import { applyMapping, guessMapping, parseCsv } from "./sales-csv";
import { mapsLink, phoneDigits, telLink, whatsappIntro, whatsappLink } from "./sales-links";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, CRLF, BOM and blank lines", () => {
    const text = '\uFEFFCompany,Phone,Notes\r\n"Acme, HR",98450 12345,"Said ""call later"""\r\n\r\nBeta Loans,,\n';
    const csv = parseCsv(text);
    expect(csv.headers).toEqual(["Company", "Phone", "Notes"]);
    expect(csv.rows).toEqual([
      ["Acme, HR", "98450 12345", 'Said "call later"'],
      ["Beta Loans", "", ""],
    ]);
  });

  it("keeps newlines inside quoted fields", () => {
    const csv = parseCsv('a,b\n"line 1\nline 2",x');
    expect(csv.rows).toEqual([["line 1\nline 2", "x"]]);
  });
});

describe("column mapping", () => {
  const fields = [
    { key: "name", aliases: ["company", "business name"] },
    { key: "phone", aliases: ["mobile"] },
    { key: "email" },
  ];

  it("guesses columns by key or alias, ignoring case and punctuation", () => {
    expect(guessMapping(["Business Name", "Mobile", "E-mail"], fields)).toEqual({ name: 0, phone: 1, email: 2 });
    expect(guessMapping(["company", "Notes"], fields)).toEqual({ name: 0, phone: -1, email: -1 });
  });

  it("applies a mapping and skips unmapped fields", () => {
    expect(applyMapping([[" Acme ", "9845012345", "x"]], { name: 0, phone: 1, email: -1 })).toEqual([{ name: "Acme", phone: "9845012345" }]);
  });
});

describe("contact links", () => {
  it("normalises Indian numbers", () => {
    expect(phoneDigits("98450 12345")).toBe("919845012345");
    expect(phoneDigits("098450-12345")).toBe("919845012345");
    expect(phoneDigits("+91 98450 12345")).toBe("919845012345");
    expect(phoneDigits("123")).toBeNull();
    expect(telLink("9845012345")).toBe("tel:+919845012345");
  });

  it("builds a wa.me draft link without sending anything", () => {
    const link = whatsappLink("9845012345", whatsappIntro("Priya Kumar", "Arun"));
    expect(link).toMatch(/^https:\/\/wa\.me\/919845012345\?text=/);
    expect(decodeURIComponent(link!.split("text=")[1]!)).toBe("Hi Priya, this is Arun from SnapServe. Following up on our conversation about AI calling for your team.");
    expect(whatsappLink(null)).toBeNull();
  });

  it("prefers a saved map link, else searches Google Maps", () => {
    expect(mapsLink({ mapLink: "https://maps.app.goo.gl/x" })).toBe("https://maps.app.goo.gl/x");
    expect(mapsLink({ name: "Acme", area: "Koramangala", city: "Bengaluru" })).toBe("https://www.google.com/maps/search/?api=1&query=Acme%2C%20Koramangala%2C%20Bengaluru");
    expect(mapsLink({})).toBeNull();
  });
});
