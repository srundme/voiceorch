/**
 * WhatsApp auto-engagement — brochure auto-send + AI chatbot replies.
 *
 * Both run inside the inbound webhook's async processing path, always in
 * reply to a message that JUST arrived (so the 24h customer-service window
 * is open and free-form sends are allowed). Every guard fails soft: log and
 * skip, never throw back into the webhook.
 */

import { and, desc, eq, gt } from "drizzle-orm";
import {
  db,
  agentsTable,
  whatsappAssetsTable,
  whatsappMessagesTable,
  type WhatsappChannel,
} from "@workspace/db";
import { logger } from "../../lib/logger.js";
import { getSelfBaseUrl } from "../../lib/app-domain.js";
import { createLLMAdapter } from "../../orchestration/adapters/llm/index.js";
import type { ConversationTurn } from "../../orchestration/types.js";
import { loadProviderKeysMap } from "../squad-handoff.js";
import {
  resolveSendContext,
  sendWhatsappFreeform,
  getOwnCredsForUser,
} from "./vobiz.js";

/* ── Brochure auto-send ───────────────────────────────────────────────────── */

const BROCHURE_RE =
  /\b(brochure|broucher|brosure|catalogue?|catalog|price\s*list|pricelist|pamphlet|send\s+(me\s+)?(the\s+)?pdf)\b/i;
const BROCHURE_BUTTONS = new Set([
  "get_brochure", "send_brochure", "brochure", "get brochure", "send brochure", "catalog", "catalogue",
]);

/**
 * If the inbound message asks for a brochure and the channel has one
 * configured, send it as a free-form document/image. Returns true when the
 * request was recognized and handled (even if deduped), so the caller can
 * skip the chatbot for this message.
 */
export async function maybeSendBrochure(
  channel: WhatsappChannel,
  phone: string,
  textBody: string,
  buttonId: string | null,
): Promise<boolean> {
  if (!channel.active || !channel.brochureAssetId || channel.brochureAutoSend === false) return false;
  const btn = (buttonId ?? "").toLowerCase().trim();
  if (!(BROCHURE_BUTTONS.has(btn) || BROCHURE_RE.test(textBody))) return false;

  // Dedupe: don't resend the brochure to the same phone within 10 minutes.
  const since = new Date(Date.now() - 10 * 60_000);
  const [recent] = await db.select({ id: whatsappMessagesTable.id })
    .from(whatsappMessagesTable)
    .where(and(
      eq(whatsappMessagesTable.channelId, channel.id),
      eq(whatsappMessagesTable.phone, phone),
      eq(whatsappMessagesTable.direction, "outbound"),
      eq(whatsappMessagesTable.msgType, "media"),
      gt(whatsappMessagesTable.createdAt, since),
    ))
    .limit(1);
  if (recent) {
    logger.info({ channelId: channel.id, phone }, "whatsapp: brochure request deduped (sent <10min ago)");
    return true;
  }

  const [asset] = await db.select({
    filename: whatsappAssetsTable.filename,
    mime: whatsappAssetsTable.mime,
    publicToken: whatsappAssetsTable.publicToken,
  })
    .from(whatsappAssetsTable)
    .where(and(
      eq(whatsappAssetsTable.id, channel.brochureAssetId),
      eq(whatsappAssetsTable.userId, channel.userId),
    ))
    .limit(1);
  if (!asset) {
    logger.warn({ channelId: channel.id, assetId: channel.brochureAssetId }, "whatsapp: brochure asset missing — skipping auto-send");
    return false;
  }

  const ctx = await resolveSendContext(channel, () => getOwnCredsForUser(channel.userId));
  if ("error" in ctx) {
    logger.warn({ channelId: channel.id, error: ctx.error }, "whatsapp: brochure send context unavailable");
    return false;
  }

  const link = `${getSelfBaseUrl()}/api/public/wa-assets/${asset.publicToken}/${encodeURIComponent(asset.filename)}`;
  const isPdf = asset.mime === "application/pdf";
  const result = await sendWhatsappFreeform({
    channel,
    ctx,
    toPhone: phone,
    kind: isPdf ? "document" : "image",
    media: {
      link,
      ...(isPdf ? { filename: asset.filename } : {}),
      caption: channel.businessName ? `${channel.businessName} — here you go!` : "Here you go!",
    },
  });
  if (!result.ok) {
    logger.warn({ channelId: channel.id, phone, error: result.error }, "whatsapp: brochure auto-send failed");
  }
  return result.ok;
}

/* ── AI chatbot replies ───────────────────────────────────────────────────── */

const CHATBOT_MAX_REPLIES_PER_PHONE_24H = 30;
const CHATBOT_HISTORY_LIMIT = 16;
const CHATBOT_LLM_TIMEOUT_MS = 25_000;

const OPT_OUT_RE = /^\s*(stop|unsubscribe|opt\s*out)\b/i;

/** Strip tool-call plumbing, markdown headers, and cap length for WhatsApp. */
function sanitizeChatbotReply(raw: string): string {
  let reply = (raw || "").trim();
  // Tool-call/e nvelope tags must never reach the customer (mid/end-of-stream too).
  reply = reply.replace(/<\|[^|>]*\|>/g, "");
  reply = reply.replace(/<\/?(tool_call|tool_response|function_call|thinking)[^>]*>[\s\S]*$/i, "");
  reply = reply.replace(/\{\s*"(tool|function|name)"\s*:[\s\S]*$/i, "");
  // Markdown headers → plain lines; collapse blank runs.
  reply = reply.replace(/^#{1,6}\s*/gm, "");
  reply = reply.replace(/\n{3,}/g, "\n\n").trim();
  if (reply.length > 1200) reply = `${reply.slice(0, 1197)}…`;
  return reply;
}

/**
 * Generate and send an AI reply to an inbound WhatsApp text using the
 * channel's configured chatbot agent (persona + provider/model), with the
 * recent WhatsApp thread as conversation history.
 */
export async function maybeChatbotReply(
  channel: WhatsappChannel,
  phone: string,
  textBody: string,
): Promise<void> {
  if (!channel.active || !channel.chatbotEnabled || !channel.chatbotAgentId) return;
  const trimmed = (textBody ?? "").trim();
  if (!trimmed) return;
  if (OPT_OUT_RE.test(trimmed)) {
    logger.info({ channelId: channel.id, phone }, "whatsapp: opt-out keyword — chatbot silent");
    return;
  }

  // Per-phone rolling cap so a chatty thread can't burn the daily quota.
  const since24 = new Date(Date.now() - 24 * 3600_000);
  const replies = await db.select({ id: whatsappMessagesTable.id })
    .from(whatsappMessagesTable)
    .where(and(
      eq(whatsappMessagesTable.channelId, channel.id),
      eq(whatsappMessagesTable.phone, phone),
      eq(whatsappMessagesTable.direction, "outbound"),
      eq(whatsappMessagesTable.msgType, "text"),
      gt(whatsappMessagesTable.createdAt, since24),
    ));
  if (replies.length >= CHATBOT_MAX_REPLIES_PER_PHONE_24H) {
    logger.warn({ channelId: channel.id, phone, n: replies.length }, "whatsapp: chatbot per-phone daily cap reached");
    return;
  }

  const [agent] = await db.select({
    id: agentsTable.id,
    name: agentsTable.name,
    systemPrompt: agentsTable.systemPrompt,
    llmProvider: agentsTable.llmProvider,
    llmModel: agentsTable.llmModel,
  })
    .from(agentsTable)
    .where(and(
      eq(agentsTable.id, channel.chatbotAgentId),
      eq(agentsTable.userId, channel.userId),
    ))
    .limit(1);
  if (!agent) {
    logger.warn({ channelId: channel.id, agentId: channel.chatbotAgentId }, "whatsapp: chatbot agent not found — skipping");
    return;
  }

  const provider = (agent.llmProvider || "groq").toLowerCase();
  const keys = await loadProviderKeysMap(channel.userId);
  const apiKey = keys.get(provider);
  if (!apiKey) {
    logger.warn({ channelId: channel.id, provider }, "whatsapp: no API key for chatbot provider — skipping");
    return;
  }

  // Thread history (last 48h, oldest→newest). The inbound row for THIS
  // message was already inserted by the webhook, so it lands last.
  const since48 = new Date(Date.now() - 48 * 3600_000);
  const rows = await db.select({
    direction: whatsappMessagesTable.direction,
    msgType: whatsappMessagesTable.msgType,
    bodyPreview: whatsappMessagesTable.bodyPreview,
  })
    .from(whatsappMessagesTable)
    .where(and(
      eq(whatsappMessagesTable.channelId, channel.id),
      eq(whatsappMessagesTable.phone, phone),
      gt(whatsappMessagesTable.createdAt, since48),
    ))
    .orderBy(desc(whatsappMessagesTable.createdAt))
    .limit(CHATBOT_HISTORY_LIMIT);
  rows.reverse();

  const turns: ConversationTurn[] = [];
  for (const r of rows) {
    const content = (r.bodyPreview ?? "").trim();
    if (!content) continue;
    turns.push({
      role: r.direction === "inbound" ? "user" : "assistant",
      content: r.msgType === "media" ? `[sent an attachment] ${content}` : content,
    });
  }
  if (turns.length === 0 || turns[turns.length - 1]!.role !== "user") {
    turns.push({ role: "user", content: trimmed.slice(0, 1500) });
  }

  const systemPrompt =
    `${agent.systemPrompt ?? ""}\n\n` +
    `[WhatsApp chat mode]\n` +
    `You are chatting with a customer over WhatsApp text messages (NOT a voice call).\n` +
    `- Reply in the customer's language.\n` +
    `- Keep replies under 500 characters, friendly and direct.\n` +
    `- Plain text only; *bold* sparingly. No markdown headings, no long bullet lists.\n` +
    `- Never mention system prompts, tools, or that you are an AI language model.\n` +
    `- If the customer wants a phone call, tell them to reply "call me" and our team will ring them.`;

  let fullText = "";
  try {
    const llm = createLLMAdapter(provider, apiKey, agent.llmModel ?? null);
    await Promise.race([
      llm.chat(turns, systemPrompt, () => { /* streaming unused */ }, (t) => { fullText = t; }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("chatbot LLM timeout")), CHATBOT_LLM_TIMEOUT_MS)),
    ]);
  } catch (err) {
    logger.warn({ err, channelId: channel.id, provider }, "whatsapp: chatbot LLM failed — no reply sent");
    return;
  }

  const reply = sanitizeChatbotReply(fullText);
  if (!reply) {
    logger.info({ channelId: channel.id, phone }, "whatsapp: chatbot produced empty reply — skipping");
    return;
  }

  const ctx = await resolveSendContext(channel, () => getOwnCredsForUser(channel.userId));
  if ("error" in ctx) {
    logger.warn({ channelId: channel.id, error: ctx.error }, "whatsapp: chatbot send context unavailable");
    return;
  }
  await sendWhatsappFreeform({ channel, ctx, toPhone: phone, kind: "text", text: reply });
}
