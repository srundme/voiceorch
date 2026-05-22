import { Link } from "wouter";
import { Mic, Zap, Shield, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SnapServeLogo } from "@/components/logo";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-transparent text-[#353536] flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-8 h-16 border-b border-[#D4D8DF] bg-white/70/70 backdrop-blur-sm">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-[#353536]">
            <Mic className="h-4 w-4 text-[#EBEDF1]" />
          </div>
          <SnapServeLogo size="sm" className="text-[#353536]" />
        </div>
        <div className="flex items-center gap-3">
          <Link href={`${basePath}/sign-in`}>
            <Button variant="ghost" size="sm" className="text-[#706F70] hover:text-[#353536] hover:bg-[#D4D8DF]/50">Sign in</Button>
          </Link>
          <Link href={`${basePath}/sign-up`}>
            <Button size="sm" className="bg-[#353536] hover:bg-[#080808] text-[#EBEDF1] font-semibold">Get started free</Button>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center text-center px-4 py-20 gap-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#D4D8DF]/60 border border-[#D4D8DF] text-[#706F70] text-xs font-medium">
          <Zap className="w-3 h-3" />
          From $0.03 / min — BYOK, or use our managed numbers at $0.035
        </div>

        <div className="max-w-2xl space-y-4">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-[#080808] leading-tight">
            AI Voice Agent<br />Orchestration Platform
          </h1>
          <p className="text-[#706F70] text-lg leading-relaxed">
            Build, deploy, and manage intelligent voice agents. Integrate your own ASR, LLM, TTS, and telephony providers — we handle the orchestration.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <Link href={`${basePath}/sign-up`}>
            <Button size="lg" className="bg-[#353536] hover:bg-[#080808] text-[#EBEDF1] font-semibold px-8">
              Start free — $5 credit included
            </Button>
          </Link>
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl w-full mt-8">
          {[
            { icon: Shield, title: "BYOK Model", desc: "Your provider API keys, zero lock-in" },
            { icon: Zap, title: "Real-time Orchestration", desc: "ASR → LLM → TTS pipeline in milliseconds" },
            { icon: Globe, title: "Any Telephony", desc: "Twilio, Plivo, Vonage and more" },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="rounded-xl border border-[#D4D8DF] bg-white/70 p-5 text-left shadow-sm">
              <Icon className="w-4 h-4 text-[#353536] mb-3" />
              <p className="font-medium text-sm text-[#353536] mb-1">{title}</p>
              <p className="text-xs text-[#ACADB1]">{desc}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
