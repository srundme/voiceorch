/**
 * Normalize inbound WhatsApp / BSP / Zapier payloads into a SnapServe request-call event.
 */

export type WhatsappInboundEvent = {
  phone: string;
  name?: string;
  event: string;
  buttonId?: string;
  waMessageId?: string;
  /** Present when the inbound message is an image (or image document). */
  media?: {
    kind: "image" | "document";
    mimeType?: string;
    mediaId?: string;
    url?: string;
    caption?: string;
    fileName?: string;
  };
  raw: Record<string, unknown>;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function pickString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

function dig(obj: Record<string, unknown>, paths: string[]): unknown {
  for (const path of paths) {
    const parts = path.split(".");
    let cur: unknown = obj;
    for (const p of parts) {
      const rec = asRecord(cur);
      if (!rec) { cur = undefined; break; }
      cur = rec[p];
    }
    if (cur != null && cur !== "") return cur;
  }
  return undefined;
}

/** Flatten common nested BSP shapes into one object for field lookup. */
function flattenInbound(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };
  const data = asRecord(body["data"]);
  if (data) Object.assign(out, data);
  const payload = asRecord(body["payload"]);
  if (payload) Object.assign(out, payload);
  const contact = asRecord(body["contact"]) ?? asRecord(data?.["contact"] ?? null);
  if (contact) {
    if (contact["phone"] != null) out["phone"] = contact["phone"];
    if (contact["wa_id"] != null) out["wa_id"] = contact["wa_id"];
    if (contact["name"] != null) out["name"] = contact["name"];
  }
  const message = asRecord(body["message"]) ?? asRecord(data?.["message"] ?? null);
  if (message) {
    if (message["from"] != null) out["from"] = message["from"];
    if (message["button"] != null) out["button"] = message["button"];
    if (message["interactive"] != null) out["interactive"] = message["interactive"];
    if (message["id"] != null) out["wa_message_id"] = message["id"];
  }
  return out;
}

function extractButtonId(flat: Record<string, unknown>): string | undefined {
  const button = asRecord(flat["button"]);
  const interactive = asRecord(flat["interactive"]);
  const buttonReply = asRecord(interactive?.["button_reply"] ?? null);
  const listReply = asRecord(interactive?.["list_reply"] ?? null);

  return pickString(
    flat["button_id"],
    flat["buttonId"],
    flat["button_payload"],
    flat["payload"],
    flat["id"],
    button?.["payload"],
    button?.["text"],
    button?.["id"],
    buttonReply?.["id"],
    buttonReply?.["title"],
    listReply?.["id"],
    listReply?.["title"],
    dig(flat, ["entry.0.changes.0.value.messages.0.button.payload"]),
  );
}

function extractPhone(flat: Record<string, unknown>): string | undefined {
  return pickString(
    flat["phone"],
    flat["from"],
    flat["wa_id"],
    flat["waId"],
    flat["mobile"],
    flat["customer_phone"],
    flat["customerPhone"],
    dig(flat, ["entry.0.changes.0.value.messages.0.from"]),
    dig(flat, ["entry.0.changes.0.value.contacts.0.wa_id"]),
    // `to` is last — on inbound BSP payloads it is often the business number.
    flat["to"],
  );
}

function extractName(flat: Record<string, unknown>): string | undefined {
  const profile = asRecord(flat["profile"]);
  return pickString(
    flat["name"],
    flat["caller_name"],
    flat["customer_name"],
    flat["contact_name"],
    profile?.["name"],
    dig(flat, ["entry.0.changes.0.value.contacts.0.profile.name"]),
  );
}

function extractEvent(flat: Record<string, unknown>): string {
  const ev = pickString(flat["event"], flat["type"], flat["action"]);
  if (ev) return ev.toLowerCase().replace(/\s+/g, "_");
  if (extractButtonId(flat)) return "request_call";
  return "message";
}

function extractFromMetaCloud(body: Record<string, unknown>): Partial<WhatsappInboundEvent> | null {
  const entry = body["entry"];
  if (!Array.isArray(entry) || entry.length === 0) return null;
  const first = asRecord(entry[0]);
  if (!first) return null;
  const changes = first["changes"];
  if (!Array.isArray(changes) || changes.length === 0) return null;
  const change = asRecord(changes[0]);
  const value = asRecord(change?.["value"] ?? null);
  if (!value) return null;

  const messages = value["messages"];
  const contacts = value["contacts"];
  const msg = Array.isArray(messages) ? asRecord(messages[0]) : null;
  const contact = Array.isArray(contacts) ? asRecord(contacts[0]) : null;
  if (!msg && !contact) return null;

  const interactive = asRecord(msg?.["interactive"] ?? null);
  const buttonReply = asRecord(interactive?.["button_reply"] ?? null);
  const button = asRecord(msg?.["button"] ?? null);
  const profile = asRecord(contact?.["profile"] ?? null);
  const image = asRecord(msg?.["image"] ?? null);
  const document = asRecord(msg?.["document"] ?? null);
  const msgType = pickString(msg?.["type"]);
  const buttonId = pickString(buttonReply?.["id"], buttonReply?.["title"], button?.["payload"], button?.["text"]);

  const phone = pickString(msg?.["from"], contact?.["wa_id"]);
  if (!phone) return null;

  let media: WhatsappInboundEvent["media"] | undefined;
  if (msgType === "image" || image) {
    media = {
      kind: "image",
      mimeType: pickString(image?.["mime_type"], image?.["mimeType"]) ?? "image/jpeg",
      mediaId: pickString(image?.["id"]),
      url: pickString(image?.["url"], image?.["link"]),
      caption: pickString(image?.["caption"]),
      fileName: pickString(image?.["filename"]),
    };
  } else if (msgType === "document" || document) {
    const mime = pickString(document?.["mime_type"], document?.["mimeType"]) ?? "";
    if (mime.startsWith("image/") || /\.(jpe?g|png|webp|gif)$/i.test(pickString(document?.["filename"]) ?? "")) {
      media = {
        kind: "document",
        mimeType: mime || "image/jpeg",
        mediaId: pickString(document?.["id"]),
        url: pickString(document?.["url"], document?.["link"]),
        caption: pickString(document?.["caption"]),
        fileName: pickString(document?.["filename"]),
      };
    }
  }

  return {
    phone,
    name: pickString(profile?.["name"]),
    buttonId,
    waMessageId: pickString(msg?.["id"]),
    event: media ? "image" : "message",
    media,
  };
}

/**
 * Parse an inbound WhatsApp webhook body into a normalized event.
 * Returns null when phone cannot be resolved.
 */
export function normalizeWhatsappInbound(body: unknown): WhatsappInboundEvent | null {
  const root = asRecord(body);
  if (!root) return null;

  const meta = extractFromMetaCloud(root);
  if (meta?.phone) {
    return {
      phone: meta.phone,
      name: meta.name,
      event: meta.event ?? "message",
      buttonId: meta.buttonId,
      waMessageId: meta.waMessageId,
      media: meta.media,
      raw: root,
    };
  }

  const flat = flattenInbound(root);
  const phone = extractPhone(flat);
  if (!phone) return null;

  // Generic BSP image fields
  let media: WhatsappInboundEvent["media"] | undefined;
  const mediaUrl = pickString(flat["media_url"], flat["mediaUrl"], flat["image_url"], flat["imageUrl"]);
  const mediaMime = pickString(flat["mime_type"], flat["mimeType"], flat["content_type"]);
  if (mediaUrl || pickString(flat["type"]) === "image") {
    media = {
      kind: "image",
      mimeType: mediaMime ?? "image/jpeg",
      url: mediaUrl,
      mediaId: pickString(flat["media_id"], flat["mediaId"]),
      caption: pickString(flat["caption"], flat["text"], flat["body"]),
      fileName: pickString(flat["filename"], flat["file_name"]),
    };
  }

  return {
    phone,
    name: extractName(flat),
    event: media ? "image" : extractEvent(flat),
    buttonId: extractButtonId(flat),
    waMessageId: pickString(flat["wa_message_id"], flat["waMessageId"], flat["message_id"], flat["messageId"]),
    media,
    raw: root,
  };
}

/** True if this inbound event should trigger an AI outbound dial. */
export function isRequestCallEvent(
  event: WhatsappInboundEvent,
  allowedButtonIds: string[],
): boolean {
  const ev = event.event.toLowerCase();
  if (
    ev === "request_call"
    || ev === "request_a_call"
    || ev === "call_request"
    || ev === "callback_request"
  ) {
    return true;
  }

  const button = (event.buttonId ?? "").toLowerCase().trim();
  if (!button) {
    // Explicit SnapServe contract without button: event alone is enough
    return false;
  }

  const allowed = allowedButtonIds.map((b) => b.toLowerCase().trim()).filter(Boolean);
  if (allowed.some((b) => b === button || button.includes(b) || b.includes(button))) {
    return true;
  }

  // Fuzzy: button text contains "call"
  if (/\b(request\s*a?\s*call|call\s*me|call\s*back)\b/i.test(button)) return true;

  return false;
}
