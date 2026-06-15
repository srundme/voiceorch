export default function Slide4() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      {/* Amber bar motif */}
      <div className="absolute top-[6.5vh] left-[7vw] h-[0.3vh] w-[8vw] bg-primary" />
      <p className="absolute top-[6vh] right-[7vw] font-body text-[2.2vw] text-muted opacity-40">04 / 12</p>

      {/* Headline */}
      <div className="absolute top-[11vh] left-[7vw]">
        <p className="font-body font-medium text-[2.2vw] uppercase tracking-[0.35em] text-primary mb-[1.5vh]">
          The Platform
        </p>
        <h2 className="font-display font-black text-[5.5vw] leading-tight tracking-tight text-text" style={{ maxWidth: '52vw' }}>
          Orchestration + Intelligence Layer
        </h2>
      </div>

      {/* Left content */}
      <div className="absolute left-[7vw] top-[32vh]" style={{ width: '42vw' }}>
        <p className="font-body text-[3vw] text-muted leading-relaxed mb-[3vh]">
          SnapServe sits between your telephony provider and your AI providers. You bring your own keys. We handle everything else.
        </p>

        <div className="space-y-[2.5vh]">
          <div className="flex items-start gap-[1.5vw]">
            <div className="w-[0.5vw] h-[0.5vw] rounded-full bg-primary mt-[1.5vh] shrink-0" />
            <p className="font-body text-[3vw] text-text leading-relaxed">Any ASR + LLM + TTS + Telephony provider — mix and match</p>
          </div>
          <div className="flex items-start gap-[1.5vw]">
            <div className="w-[0.5vw] h-[0.5vw] rounded-full bg-primary mt-[1.5vh] shrink-0" />
            <p className="font-body text-[3vw] text-text leading-relaxed">Gender AI, Caller Memory, and Voice Fingerprinting on every call</p>
          </div>
          <div className="flex items-start gap-[1.5vw]">
            <div className="w-[0.5vw] h-[0.5vw] rounded-full bg-primary mt-[1.5vh] shrink-0" />
            <p className="font-body text-[3vw] text-text leading-relaxed">Live in production — not a prototype</p>
          </div>
        </div>
      </div>

      {/* Right pipeline visual */}
      <div className="absolute right-[7vw] top-1/2 -translate-y-1/2 flex flex-col items-center gap-0" style={{ width: '28vw' }}>

        <div className="w-full bg-surface rounded-[1vw] px-[2.5vw] py-[2vh] flex items-center gap-[2vw]" style={{ border: '1px solid #22223A' }}>
          <div className="w-[0.8vw] h-[0.8vw] rounded-full bg-primary shrink-0" />
          <p className="font-display font-bold text-[3vw] text-text">ASR</p>
          <p className="font-body text-[2.5vw] text-muted ml-auto">Deepgram · Azure · Whisper</p>
        </div>

        <div className="w-[0.2vw] h-[3vh] bg-primary opacity-40" />

        <div className="w-full bg-surface rounded-[1vw] px-[2.5vw] py-[2vh] flex items-center gap-[2vw]" style={{ border: '1px solid #22223A' }}>
          <div className="w-[0.8vw] h-[0.8vw] rounded-full bg-primary shrink-0" />
          <p className="font-display font-bold text-[3vw] text-text">LLM</p>
          <p className="font-body text-[2.5vw] text-muted ml-auto">OpenAI · Qwen · Anthropic</p>
        </div>

        <div className="w-[0.2vw] h-[3vh] bg-primary opacity-40" />

        <div className="w-full bg-surface rounded-[1vw] px-[2.5vw] py-[2vh] flex items-center gap-[2vw]" style={{ border: '1px solid #22223A' }}>
          <div className="w-[0.8vw] h-[0.8vw] rounded-full bg-primary shrink-0" />
          <p className="font-display font-bold text-[3vw] text-text">TTS</p>
          <p className="font-body text-[2.5vw] text-muted ml-auto">Cartesia · ElevenLabs · Azure</p>
        </div>

        <div className="w-[0.2vw] h-[3vh] bg-primary opacity-40" />

        <div className="w-full bg-surface rounded-[1vw] px-[2.5vw] py-[2vh] flex items-center gap-[2vw]" style={{ border: '1px solid #22223A' }}>
          <div className="w-[0.8vw] h-[0.8vw] rounded-full bg-primary shrink-0" />
          <p className="font-display font-bold text-[3vw] text-text">Telephony</p>
          <p className="font-body text-[2.5vw] text-muted ml-auto">Twilio · Plivo · Vobiz</p>
        </div>

      </div>
    </div>
  );
}
