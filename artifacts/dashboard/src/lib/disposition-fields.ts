/** Builder helpers for disposition taxonomy + domainFields (mirrors api-server domain-field-map). */

export type UiDomainFieldType = "phone" | "text" | "number" | "yes_no" | "choice";

export type UiDomainField = {
  id: string;
  label: string;
  key: string;
  uiType: UiDomainFieldType;
  optionsText?: string;
};

export type StoredDomainField = {
  key: string;
  type: "string" | "number" | "boolean";
  label?: string;
  enum?: string[];
};

export type DispositionCategory = { id: string; name: string; values: string };

export function slugDispositionKey(label: string): string {
  const s = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return s || "field";
}

export function uiTypeFromStored(field: StoredDomainField): UiDomainFieldType {
  if (field.type === "boolean") return "yes_no";
  if (field.type === "number") return "number";
  if (field.enum?.length) return "choice";
  if (
    /whats?\s*app|wa[_\s-]?number|mobile|phone|cell/i.test(field.key) ||
    (field.label && /whats?\s*app|mobile|phone|cell/i.test(field.label))
  ) {
    return "phone";
  }
  return "text";
}

export function toStoredDomainField(ui: UiDomainField): StoredDomainField | null {
  const label = ui.label.trim();
  let key = (ui.key.trim() || slugDispositionKey(label)).replace(/[^a-zA-Z0-9_]/g, "_");
  if (!key) return null;
  if (ui.uiType === "phone" && !/(whats?app|wa_|mobile|phone|cell|contact_?number|^tel$)/i.test(key)) {
    key = `whatsapp_${key}`;
  }
  if (ui.uiType === "yes_no") return { key, type: "boolean", label: label || key };
  if (ui.uiType === "number") return { key, type: "number", label: label || key };
  if (ui.uiType === "choice") {
    const enumVals = (ui.optionsText ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    return { key, type: "string", label: label || key, ...(enumVals.length ? { enum: enumVals } : {}) };
  }
  return { key, type: "string", label: label || key };
}

export function fromStoredDomainField(field: StoredDomainField): UiDomainField {
  return {
    id: crypto.randomUUID(),
    label: field.label?.trim() || field.key,
    key: field.key,
    uiType: uiTypeFromStored(field),
    optionsText: field.enum?.join(", ") ?? "",
  };
}

export const DOMAIN_FIELD_QUICK_ADDS: Array<{ label: string; key: string; uiType: UiDomainFieldType }> = [
  { label: "WhatsApp number", key: "whatsapp_number", uiType: "phone" },
  { label: "Email", key: "email", uiType: "text" },
  { label: "City", key: "city", uiType: "text" },
  { label: "Callback time", key: "callback_time", uiType: "text" },
];

export const OUTCOME_PRESETS: Array<{ id: string; name: string; taxonomy: Record<string, string[]> }> = [
  {
    id: "sales",
    name: "Sales",
    taxonomy: {
      outcome: ["interested", "not_interested", "callback", "wrong_number", "no_answer"],
    },
  },
  {
    id: "support",
    name: "Support",
    taxonomy: {
      outcome: ["resolved", "escalated", "callback", "wrong_number", "no_answer"],
    },
  },
  {
    id: "lead_qual",
    name: "Lead qual",
    taxonomy: {
      outcome: ["qualified", "not_qualified", "callback", "wrong_number", "no_answer"],
    },
  },
];

export function taxonomyToCategories(taxonomy: Record<string, string[]>): DispositionCategory[] {
  return Object.entries(taxonomy).map(([name, vals]) => ({
    id: crypto.randomUUID(),
    name,
    values: vals.join(", "),
  }));
}

export function categoriesToTaxonomy(categories: DispositionCategory[]): Record<string, string[]> {
  const taxonomy: Record<string, string[]> = {};
  for (const cat of categories) {
    const name = cat.name.trim();
    if (!name) continue;
    taxonomy[name] = cat.values
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return taxonomy;
}
