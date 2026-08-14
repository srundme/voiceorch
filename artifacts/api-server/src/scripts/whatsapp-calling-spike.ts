/**
 * Spike: WhatsApp Calling SDP + VoBiz API (no live media required).
 *
 *   pnpm --filter @workspace/api-server exec tsx \
 *     src/scripts/whatsapp-calling-spike.ts
 *
 * Optional env:
 *   VOBIZ_AUTH_ID / VOBIZ_AUTH_TOKEN / VOBIZ_WA_CHANNEL_ID / WA_SPIKE_TO
 *
 * Proves: local SDP offer generation, optional live initiate (when env set).
 */
import { createOutboundBridge, isWrtcAvailable } from "../services/whatsapp/webrtc-bridge.js";
import { vobizInitiateWhatsappCall, vobizWhatsappCallAction } from "../services/whatsapp/calls-api.js";

async function main() {
  const wrtc = await isWrtcAvailable();
  console.log(`wrtc available: ${wrtc}`);

  const bridge = await createOutboundBridge();
  console.log(`mediaReady: ${bridge.mediaReady}`);
  console.log(`SDP offer length: ${bridge.localSdp.length}`);
  console.log(`SDP preview:\n${bridge.localSdp.slice(0, 280)}…`);

  const authId = (process.env["VOBIZ_AUTH_ID"] ?? "").trim();
  const authToken = (process.env["VOBIZ_AUTH_TOKEN"] ?? "").trim();
  const channelId = (process.env["VOBIZ_WA_CHANNEL_ID"] ?? "").trim();
  const to = (process.env["WA_SPIKE_TO"] ?? "").trim();

  if (!authId || !authToken || !channelId || !to) {
    console.log("\nVERDICT: local SDP OK. Set VOBIZ_AUTH_ID, VOBIZ_AUTH_TOKEN, VOBIZ_WA_CHANNEL_ID, WA_SPIKE_TO to place a live outbound call.");
    bridge.close();
    return;
  }

  const initiated = await vobizInitiateWhatsappCall({
    authId,
    authToken,
    channelId,
    to,
    sdpOffer: bridge.localSdp,
  });
  console.log("initiate:", initiated);
  if (initiated.ok) {
    console.log("Waiting 8s then terminate…");
    await new Promise((r) => setTimeout(r, 8000));
    const term = await vobizWhatsappCallAction({
      authId,
      authToken,
      channelId,
      callId: initiated.callId,
      action: "terminate",
    });
    console.log("terminate:", term);
  }
  bridge.close();
  console.log("\nVERDICT: see initiate/terminate results above. Install @roamhq/wrtc for real media.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
