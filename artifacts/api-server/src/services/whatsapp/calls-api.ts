/**
 * VoBiz WhatsApp Calling API client.
 * Docs: https://docs.vobiz.ai/whatsapp/api/calls
 */
import { VOBIZ_API_BASE, vobizApiHeaders } from "./vobiz.js";
import { logger } from "../../lib/logger.js";

export type VobizWaCallAction = "pre_accept" | "accept" | "reject" | "terminate";

export async function vobizInitiateWhatsappCall(opts: {
  authId: string;
  authToken: string;
  channelId: string;
  to: string;
  sdpOffer: string;
}): Promise<{ ok: true; callId: string; status: string } | { ok: false; error: string }> {
  try {
    const resp = await fetch(`${VOBIZ_API_BASE}/messaging/calls/whatsapp`, {
      method: "POST",
      headers: vobizApiHeaders(opts.authId, opts.authToken),
      body: JSON.stringify({
        channel_id: opts.channelId,
        to: opts.to,
        sdp_offer: opts.sdpOffer,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await resp.text().catch(() => "");
    if (!resp.ok) {
      return { ok: false, error: `VoBiz call initiate HTTP ${resp.status}: ${text.slice(0, 400)}` };
    }
    let callId = "";
    let status = "initiated";
    try {
      const j = JSON.parse(text) as Record<string, unknown>;
      callId = String(j["call_id"] ?? j["id"] ?? "");
      status = String(j["status"] ?? "initiated");
    } catch {
      return { ok: false, error: `VoBiz call initiate: non-JSON body ${text.slice(0, 200)}` };
    }
    if (!callId) return { ok: false, error: "VoBiz call initiate: missing call_id" };
    return { ok: true, callId, status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, "whatsapp-calls: initiate failed");
    return { ok: false, error: msg };
  }
}

export async function vobizWhatsappCallAction(opts: {
  authId: string;
  authToken: string;
  channelId: string;
  callId: string;
  action: VobizWaCallAction;
  sdp?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const body: Record<string, string> = {
      channel_id: opts.channelId,
      call_id: opts.callId,
      action: opts.action,
    };
    if (opts.sdp) body["sdp"] = opts.sdp;
    const resp = await fetch(`${VOBIZ_API_BASE}/messaging/calls/whatsapp/action`, {
      method: "POST",
      headers: vobizApiHeaders(opts.authId, opts.authToken),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await resp.text().catch(() => "");
    if (!resp.ok) {
      return { ok: false, error: `VoBiz call action HTTP ${resp.status}: ${text.slice(0, 400)}` };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}
