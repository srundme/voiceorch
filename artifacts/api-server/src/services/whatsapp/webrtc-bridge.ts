/**
 * Server-side WebRTC peer for WhatsApp Calling.
 *
 * Uses optional `wrtc` (install `@roamhq/wrtc` in production). When unavailable,
 * createOfferSdp() still returns a minimal SDP suitable for API/contract tests
 * but cannot exchange real media — callers must check `mediaReady`.
 */
import { EventEmitter } from "node:events";
import { logger } from "../../lib/logger.js";

type AudioSource = {
  createTrack: () => unknown;
  onData: (data: {
    samples: Int16Array;
    sampleRate: number;
    bitsPerSample: number;
    channelCount: number;
  }) => void;
};

type AudioSink = {
  ondata: ((data: { samples: Int16Array; sampleRate: number }) => void) | null;
  stop: () => void;
};

type PeerConnectionLike = {
  addTrack: (track: unknown) => void;
  addTransceiver: (kind: string, init?: { direction: string }) => void;
  createOffer: () => Promise<{ sdp?: string; type?: string }>;
  createAnswer: () => Promise<{ sdp?: string; type?: string }>;
  setLocalDescription: (desc: { type?: string; sdp?: string }) => Promise<void>;
  setRemoteDescription: (desc: { type: string; sdp: string }) => Promise<void>;
  close: () => void;
  iceGatheringState: string;
  localDescription: { sdp?: string } | null;
  ontrack: ((ev: { track: { kind: string } }) => void) | null;
  onicegatheringstatechange: (() => void) | null;
};

type WrtcModule = {
  RTCPeerConnection: new (config?: { iceServers?: { urls: string }[] }) => PeerConnectionLike;
  nonstandard?: {
    RTCAudioSource?: new () => AudioSource;
    RTCAudioSink?: new (track: unknown) => AudioSink;
  };
};

let wrtcMod: WrtcModule | null | undefined;

async function loadWrtc(): Promise<WrtcModule | null> {
  if (wrtcMod !== undefined) return wrtcMod;
  try {
    const mod = await import("@roamhq/wrtc").catch(() => import("wrtc"));
    wrtcMod = mod as unknown as WrtcModule;
    return wrtcMod;
  } catch (err) {
    logger.warn({ err }, "whatsapp-webrtc: wrtc not installed — signaling-only mode");
    wrtcMod = null;
    return null;
  }
}

/** Minimal Opus offer used when wrtc is missing (signaling / spike only). */
function placeholderSdpOffer(): string {
  return [
    "v=0",
    "o=- 0 0 IN IP4 127.0.0.1",
    "s=SnapServeWhatsAppCall",
    "t=0 0",
    "a=group:BUNDLE 0",
    "a=msid-semantic: WMS *",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111",
    "c=IN IP4 0.0.0.0",
    "a=rtcp:9 IN IP4 0.0.0.0",
    "a=ice-ufrag:snap",
    "a=ice-pwd:snapservewhatsappcallpwd1",
    "a=fingerprint:sha-256 00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00",
    "a=setup:actpass",
    "a=mid:0",
    "a=sendrecv",
    "a=rtcp-mux",
    "a=rtpmap:111 opus/48000/2",
    "a=fmtp:111 minptime=10;useinbandfec=1",
  ].join("\r\n") + "\r\n";
}

export type WhatsappWebRtcBridge = EventEmitter & {
  mediaReady: boolean;
  localSdp: string;
  setRemoteSdp: (sdp: string, type?: "answer" | "offer") => Promise<void>;
  /** Push PCM16 LE mono @ 16kHz toward WhatsApp (TTS out). */
  pushPcm16k: (pcm: Buffer) => void;
  close: () => void;
};

async function waitIce(pc: PeerConnectionLike): Promise<void> {
  await new Promise<void>((resolve) => {
    if (pc.iceGatheringState === "complete") { resolve(); return; }
    const t = setTimeout(() => resolve(), 1500);
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(t);
        resolve();
      }
    };
  });
}

/**
 * Create a local WebRTC peer and produce an SDP offer for outbound WhatsApp calls.
 */
export async function createOutboundBridge(): Promise<WhatsappWebRtcBridge> {
  const wrtc = await loadWrtc();
  const ee = new EventEmitter() as WhatsappWebRtcBridge;

  if (!wrtc) {
    ee.mediaReady = false;
    ee.localSdp = placeholderSdpOffer();
    ee.setRemoteSdp = async () => {};
    ee.pushPcm16k = () => {};
    ee.close = () => ee.removeAllListeners();
    return ee;
  }

  const pc = new wrtc.RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  ee.mediaReady = true;

  let audioSource: AudioSource | null = null;

  if (wrtc.nonstandard?.RTCAudioSource) {
    audioSource = new wrtc.nonstandard.RTCAudioSource();
    pc.addTrack(audioSource.createTrack());
  } else {
    pc.addTransceiver("audio", { direction: "sendrecv" });
  }

  pc.ontrack = (ev) => {
    const track = ev.track;
    if (track.kind !== "audio" || !wrtc.nonstandard?.RTCAudioSink) return;
    const sink = new wrtc.nonstandard.RTCAudioSink(track);
    sink.ondata = (data) => {
      const buf = Buffer.from(data.samples.buffer, data.samples.byteOffset, data.samples.byteLength);
      ee.emit("pcm", buf, data.sampleRate);
    };
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitIce(pc);

  ee.localSdp = pc.localDescription?.sdp ?? offer.sdp ?? "";
  ee.setRemoteSdp = async (sdp, type = "answer") => {
    await pc.setRemoteDescription({ type, sdp });
  };
  ee.pushPcm16k = (pcm) => {
    if (!audioSource) return;
    const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);
    audioSource.onData({ samples, sampleRate: 16000, bitsPerSample: 16, channelCount: 1 });
  };
  ee.close = () => {
    try { pc.close(); } catch { /* ignore */ }
    ee.removeAllListeners();
  };
  return ee;
}

/**
 * Create a peer that answers an inbound SDP offer (from call.connect webhook).
 */
export async function createInboundBridge(remoteOfferSdp: string): Promise<WhatsappWebRtcBridge> {
  const wrtc = await loadWrtc();
  const ee = new EventEmitter() as WhatsappWebRtcBridge;

  if (!wrtc) {
    ee.mediaReady = false;
    ee.localSdp = placeholderSdpOffer().replace("a=setup:actpass", "a=setup:active");
    ee.setRemoteSdp = async () => {};
    ee.pushPcm16k = () => {};
    ee.close = () => ee.removeAllListeners();
    return ee;
  }

  const pc = new wrtc.RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  ee.mediaReady = true;

  let audioSource: AudioSource | null = null;

  if (wrtc.nonstandard?.RTCAudioSource) {
    audioSource = new wrtc.nonstandard.RTCAudioSource();
    pc.addTrack(audioSource.createTrack());
  } else {
    pc.addTransceiver("audio", { direction: "sendrecv" });
  }

  pc.ontrack = (ev) => {
    const track = ev.track;
    if (track.kind !== "audio" || !wrtc.nonstandard?.RTCAudioSink) return;
    const sink = new wrtc.nonstandard.RTCAudioSink(track);
    sink.ondata = (data) => {
      const buf = Buffer.from(data.samples.buffer, data.samples.byteOffset, data.samples.byteLength);
      ee.emit("pcm", buf, data.sampleRate);
    };
  };

  await pc.setRemoteDescription({ type: "offer", sdp: remoteOfferSdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitIce(pc);

  ee.localSdp = pc.localDescription?.sdp ?? answer.sdp ?? "";
  ee.setRemoteSdp = async (sdp, type = "answer") => {
    await pc.setRemoteDescription({ type, sdp });
  };
  ee.pushPcm16k = (pcm) => {
    if (!audioSource) return;
    const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);
    audioSource.onData({ samples, sampleRate: 16000, bitsPerSample: 16, channelCount: 1 });
  };
  ee.close = () => {
    try { pc.close(); } catch { /* ignore */ }
    ee.removeAllListeners();
  };
  return ee;
}

export async function isWrtcAvailable(): Promise<boolean> {
  return !!(await loadWrtc());
}
