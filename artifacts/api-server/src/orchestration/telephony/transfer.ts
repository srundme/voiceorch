/**
 * P2-A: Call Transfer helpers
 *
 * VoBiz transfer uses their REST API to redirect the aleg (caller) to a new
 * XML URL that returns a <Dial> instruction.
 *
 * POST https://api.vobiz.ai/api/v1/Account/{authId}/Call/{callUuid}/Transfer/
 * Body: { legs: "aleg", aleg_url: "<url>", aleg_method: "GET" }
 *
 * The aleg_url must return VoiceXML with a <Dial> node pointing at the target.
 */

import { logger } from "../../lib/logger.js";

export type TransferType = "warm" | "cold";

/**
 * Calls VoBiz REST API to redirect the active call to a new XML URL.
 * The XML URL should return a <Dial> response targeting the transfer destination.
 */
export async function transferVobizCall(opts: {
  authId: string;
  authToken: string;
  callUuid: string;
  xmlUrl: string;
}): Promise<void> {
  const url = `https://api.vobiz.ai/api/v1/Account/${opts.authId}/Call/${opts.callUuid}/Transfer/`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "X-Auth-ID": opts.authId,
      "X-Auth-Token": opts.authToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      legs: "aleg",
      aleg_url: opts.xmlUrl,
      aleg_method: "GET",
    }),
  });

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`VoBiz transfer API error ${resp.status}: ${text}`);
  }
  logger.info({ callUuid: opts.callUuid, xmlUrl: opts.xmlUrl }, "VoBiz transfer initiated");
}

/**
 * Build the VoiceXML response that VoBiz fetches from our transfer callback URL.
 * Returns XML that dials the target number / SIP URI directly.
 */
export function buildTransferXml(target: string): string {
  const escaped = target.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Dial>${escaped}</Dial>\n</Response>`;
}
