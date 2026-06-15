export default function Slide4() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg flex">
      {/* Amber bar motif + slide counter */}
      <div className="absolute top-[6vh] left-[7vw] h-[0.3vh] w-[8vw] bg-primary" />
      <p className="absolute top-[5.5vh] right-[7vw] font-body text-[2.2vw] text-muted opacity-40">04 / 12</p>

      {/* Left column */}
      <div className="flex flex-col pl-[7vw] pr-[3vw] w-[52%] overflow-hidden" style={{ paddingTop: '11vh', paddingBottom: '8vh', gap: '2.5vh' }}>
        <p className="font-body font-medium text-[2.2vw] uppercase tracking-[0.35em] text-primary">The Platform</p>
        <h2 className="font-display font-black text-[4vw] leading-none tracking-tighter text-text">BYOK Orchestration</h2>
        <p className="font-body text-[2.7vw] text-muted leading-snug">Your API keys, our orchestration layer — routing, memory, gender AI, and fingerprinting on every call.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.8vh' }}>
          <div className="flex items-center gap-[1.2vw]">
            <div className="w-[0.45vw] h-[0.45vw] rounded-full bg-primary shrink-0" />
            <p className="font-body text-[2.7vw] text-text">Mix and match any provider</p>
          </div>
          <div className="flex items-center gap-[1.2vw]">
            <div className="w-[0.45vw] h-[0.45vw] rounded-full bg-primary shrink-0" />
            <p className="font-body text-[2.7vw] text-text">Gender AI + Memory + Fingerprinting</p>
          </div>
          <div className="flex items-center gap-[1.2vw]">
            <div className="w-[0.45vw] h-[0.45vw] rounded-full bg-primary shrink-0" />
            <p className="font-body text-[2.7vw] text-text">Live in production today</p>
          </div>
        </div>
      </div>

      {/* Right column — pipeline */}
      <div className="flex flex-col pr-[7vw] pl-[3vw] w-[48%] overflow-hidden" style={{ paddingTop: '13vh', paddingBottom: '8vh', gap: '0' }}>

        <div className="bg-surface rounded-[1vw] px-[2.5vw] py-[2.2vh] flex items-center justify-between" style={{ border: '1px solid #22223A' }}>
          <div className="flex items-center gap-[1.2vw]">
            <div className="w-[0.6vw] h-[0.6vw] rounded-full bg-primary shrink-0" />
            <p className="font-display font-bold text-[3vw] text-text">ASR</p>
          </div>
          <p className="font-body text-[2.2vw] text-muted">Deepgram · Azure · Whisper</p>
        </div>
        <div className="self-center w-[0.15vw] bg-primary opacity-40" style={{ height: '3vh' }} />

        <div className="bg-surface rounded-[1vw] px-[2.5vw] py-[2.2vh] flex items-center justify-between" style={{ border: '1px solid #22223A' }}>
          <div className="flex items-center gap-[1.2vw]">
            <div className="w-[0.6vw] h-[0.6vw] rounded-full bg-primary shrink-0" />
            <p className="font-display font-bold text-[3vw] text-text">LLM</p>
          </div>
          <p className="font-body text-[2.2vw] text-muted">OpenAI · Qwen · Anthropic</p>
        </div>
        <div className="self-center w-[0.15vw] bg-primary opacity-40" style={{ height: '3vh' }} />

        <div className="bg-surface rounded-[1vw] px-[2.5vw] py-[2.2vh] flex items-center justify-between" style={{ border: '1px solid #22223A' }}>
          <div className="flex items-center gap-[1.2vw]">
            <div className="w-[0.6vw] h-[0.6vw] rounded-full bg-primary shrink-0" />
            <p className="font-display font-bold text-[3vw] text-text">TTS</p>
          </div>
          <p className="font-body text-[2.2vw] text-muted">Cartesia · ElevenLabs · Azure</p>
        </div>
        <div className="self-center w-[0.15vw] bg-primary opacity-40" style={{ height: '3vh' }} />

        <div className="bg-surface rounded-[1vw] px-[2.5vw] py-[2.2vh] flex items-center justify-between" style={{ border: '1px solid #22223A' }}>
          <div className="flex items-center gap-[1.2vw]">
            <div className="w-[0.6vw] h-[0.6vw] rounded-full bg-primary shrink-0" />
            <p className="font-display font-bold text-[3vw] text-text">Telephony</p>
          </div>
          <p className="font-body text-[2.2vw] text-muted">Twilio · Plivo · Vobiz</p>
        </div>

      </div>
    </div>
  );
}
