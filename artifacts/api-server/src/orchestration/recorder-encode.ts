/**
 * Dual-mono WAV: caller + agent mixed onto BOTH channels.
 *
 * Isolated L=caller / R=agent made the human disappear on phones, Bluetooth,
 * and HTML5 `<audio>` — those players often play only the right channel.
 */

function mixSample(a: number, b: number): number {
  const s = a + b;
  if (s > 32767) return 32767;
  if (s < -32768) return -32768;
  return s;
}

export function encodeCallRecordingWav(
  callerPcm: Buffer,
  agentPcm: Buffer,
  sampleRate: number,
): Buffer {
  const numSamples = Math.max(callerPcm.length, agentPcm.length) >> 1;
  const channels = 2;
  const bytesPerSample = 2;
  const dataSize = numSamples * channels * bytesPerSample;
  const headerSize = 44;
  const buf = Buffer.allocUnsafe(headerSize + dataSize);

  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");

  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buf.writeUInt16LE(channels * bytesPerSample, 32);
  buf.writeUInt16LE(16, 34);

  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);

  let offset = headerSize;
  for (let i = 0; i < numSamples; i++) {
    const byteIdx = i * 2;
    const caller = byteIdx + 1 < callerPcm.length ? callerPcm.readInt16LE(byteIdx) : 0;
    const agent = byteIdx + 1 < agentPcm.length ? agentPcm.readInt16LE(byteIdx) : 0;
    const mixed = mixSample(caller, agent);
    buf.writeInt16LE(mixed, offset);
    buf.writeInt16LE(mixed, offset + 2);
    offset += 4;
  }

  return buf;
}
