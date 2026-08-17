/**
 * Mic capture AudioWorklet for live test / webcall.
 * Loaded via audioWorklet.addModule("/worklets/pcm-capture.js") so CSP
 * script-src 'self' applies (blob: modules are treated as scripts in Chrome).
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length) {
      const out = new Float32Array(input[0]);
      this.port.postMessage(out.buffer, [out.buffer]);
    }
    return true;
  }
}
registerProcessor("pcm-capture", PcmCaptureProcessor);
