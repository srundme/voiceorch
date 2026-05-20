import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { useCompleteOnboarding, useGetOnboardingStatus } from "@workspace/api-client-react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ArrowRight } from "lucide-react";

/* ── Types ─────────────────────────────────────────────────────────────── */

type Role = "student" | "professional";
type ReferralSource = "instagram" | "youtube" | "reference" | "google" | "ai_search";
type PriorPlatform = "vapi" | "retell" | "bolna" | "other";

interface Answers {
  name: string;
  role: Role | null;
  referralSource: ReferralSource | null;
  usedVoiceAgents: boolean | null;
  priorPlatforms: PriorPlatform[];
}

/* ── Motion config ──────────────────────────────────────────────────────── */

const SLIDE_IN = {
  initial:  { opacity: 0, y: 48 },
  animate:  { opacity: 1, y: 0, transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] as [number,number,number,number] } },
  exit:     { opacity: 0, y: -32, transition: { duration: 0.28, ease: [0.4, 0, 1, 1] as [number,number,number,number] } },
};

/* ── Helpers ────────────────────────────────────────────────────────────── */

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = Math.round((current / total) * 100);
  return (
    <div className="fixed top-0 inset-x-0 z-50 h-1 bg-gray-100">
      <motion.div
        className="h-full bg-black"
        initial={false}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  );
}

function StepCounter({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5 text-[13px] text-gray-400 font-medium tracking-wide">
      <span className="text-black font-semibold">{current}</span>
      <span>/</span>
      <span>{total}</span>
    </div>
  );
}

function ContinueButton({
  onClick,
  disabled,
  loading,
  label = "OK",
}: {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  label?: string;
}) {
  return (
    <motion.button
      whileHover={{ scale: disabled ? 1 : 1.02 }}
      whileTap={{ scale: disabled ? 1 : 0.97 }}
      onClick={onClick}
      disabled={disabled || loading}
      className={`
        mt-8 flex items-center gap-2.5 px-6 py-3 rounded-lg font-semibold text-sm
        transition-all duration-150 select-none
        ${disabled
          ? "bg-gray-100 text-gray-400 cursor-not-allowed"
          : "bg-black text-white hover:bg-gray-800 cursor-pointer shadow-sm"
        }
      `}
    >
      {loading ? (
        <span className="inline-block h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
      ) : (
        <>
          {label}
          <div className="flex items-center gap-0.5 bg-white/15 rounded px-1.5 py-0.5 text-[11px]">
            <span>press</span>
            <kbd className="font-bold">↵</kbd>
          </div>
        </>
      )}
    </motion.button>
  );
}

/* ── Step components ────────────────────────────────────────────────────── */

function NameStep({ value, onChange, onNext }: { value: string; onChange: (v: string) => void; onNext: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && value.trim()) onNext();
  };

  return (
    <div className="w-full max-w-xl">
      <p className="text-[13px] font-semibold text-emerald-600 tracking-widest uppercase mb-4">Question 1</p>
      <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 leading-tight mb-2">
        What's your name? <span className="text-emerald-500">*</span>
      </h2>
      <p className="text-gray-400 text-base mb-8">We'll use this to personalise your experience.</p>
      <input
        ref={ref}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKey}
        placeholder="Type your full name here…"
        className="w-full border-b-2 border-gray-200 focus:border-black outline-none text-2xl py-3 bg-transparent text-gray-900 placeholder:text-gray-300 transition-colors"
      />
      <ContinueButton onClick={onNext} disabled={!value.trim()} />
    </div>
  );
}

/* Role step — auto-advances on click; onSelect receives the chosen value */
function RoleStep({
  value,
  onSelect,
  onNext,
}: {
  value: Role | null;
  onSelect: (v: Role) => void;
  onNext: () => void;
}) {
  const options: { id: Role; label: string; emoji: string; desc: string }[] = [
    { id: "student",      label: "Student",      emoji: "🎓", desc: "Exploring AI as part of my studies" },
    { id: "professional", label: "Professional",  emoji: "💼", desc: "Building voice agents for work" },
  ];

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "1") onSelect("student");
      if (e.key === "2") onSelect("professional");
      if (e.key === "Enter" && value) onNext();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [value, onSelect, onNext]);

  return (
    <div className="w-full max-w-xl">
      <p className="text-[13px] font-semibold text-emerald-600 tracking-widest uppercase mb-4">Question 2</p>
      <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 leading-tight mb-2">
        Are you a student or a professional?
      </h2>
      <p className="text-gray-400 text-base mb-8">Helps us show you the most relevant features.</p>
      <div className="flex flex-col gap-3">
        {options.map((opt, idx) => (
          <motion.button
            key={opt.id}
            whileHover={{ x: 4 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onSelect(opt.id)}
            className={`
              flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-all duration-150 cursor-pointer
              ${value === opt.id
                ? "border-black bg-black text-white"
                : "border-gray-200 hover:border-gray-400 text-gray-800"
              }
            `}
          >
            <span className="text-2xl">{opt.emoji}</span>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold opacity-40">{idx + 1}</span>
                <span className="font-semibold text-base">{opt.label}</span>
              </div>
              <p className={`text-sm mt-0.5 ${value === opt.id ? "text-gray-300" : "text-gray-400"}`}>{opt.desc}</p>
            </div>
            {value === opt.id && <Check className="h-5 w-5 shrink-0" />}
          </motion.button>
        ))}
      </div>
    </div>
  );
}

/* Referral step — auto-advances on click */
function ReferralStep({
  value,
  onSelect,
  onNext,
}: {
  value: ReferralSource | null;
  onSelect: (v: ReferralSource) => void;
  onNext: () => void;
}) {
  const options: { id: ReferralSource; label: string; emoji: string }[] = [
    { id: "instagram",  label: "Instagram",          emoji: "📸" },
    { id: "youtube",    label: "YouTube",             emoji: "▶️" },
    { id: "reference",  label: "Someone referred me", emoji: "🤝" },
    { id: "google",     label: "Google Search",       emoji: "🔍" },
    { id: "ai_search",  label: "AI Search Results",   emoji: "🤖" },
  ];

  useEffect(() => {
    const keys: Record<string, ReferralSource> = {
      "1": "instagram", "2": "youtube", "3": "reference", "4": "google", "5": "ai_search",
    };
    const handler = (e: KeyboardEvent) => {
      if (keys[e.key]) onSelect(keys[e.key]!);
      if (e.key === "Enter" && value) onNext();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [value, onSelect, onNext]);

  return (
    <div className="w-full max-w-xl">
      <p className="text-[13px] font-semibold text-emerald-600 tracking-widest uppercase mb-4">Question 3</p>
      <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 leading-tight mb-2">
        How did you hear about us?
      </h2>
      <p className="text-gray-400 text-base mb-8">So we know where our community is growing.</p>
      <div className="flex flex-col gap-2.5">
        {options.map((opt, idx) => (
          <motion.button
            key={opt.id}
            whileHover={{ x: 4 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onSelect(opt.id)}
            className={`
              flex items-center gap-3.5 px-4 py-3.5 rounded-xl border-2 text-left transition-all duration-150 cursor-pointer
              ${value === opt.id
                ? "border-black bg-black text-white"
                : "border-gray-200 hover:border-gray-400 text-gray-800"
              }
            `}
          >
            <span className="text-lg w-7 text-center">{opt.emoji}</span>
            <div className="flex items-center gap-2 flex-1">
              <span className={`text-[11px] font-bold ${value === opt.id ? "text-gray-400" : "opacity-30"}`}>{idx + 1}</span>
              <span className="font-medium text-[15px]">{opt.label}</span>
            </div>
            {value === opt.id && <Check className="h-4 w-4 shrink-0" />}
          </motion.button>
        ))}
      </div>
    </div>
  );
}

/* VoiceAgent step — auto-advances on click; onSelect receives the value */
function VoiceAgentStep({
  value,
  onSelect,
  onNext,
}: {
  value: boolean | null;
  onSelect: (v: boolean) => void;
  onNext: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "y" || e.key === "Y" || e.key === "1") onSelect(true);
      if (e.key === "n" || e.key === "N" || e.key === "2") onSelect(false);
      if (e.key === "Enter" && value !== null) onNext();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [value, onSelect, onNext]);

  return (
    <div className="w-full max-w-xl">
      <p className="text-[13px] font-semibold text-emerald-600 tracking-widest uppercase mb-4">Question 4</p>
      <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 leading-tight mb-2">
        Have you ever used AI voice agents before?
      </h2>
      <p className="text-gray-400 text-base mb-8">No wrong answer — we just want to set the right starting point.</p>
      <div className="flex gap-3">
        {[
          { v: true,  label: "Yes", emoji: "👍", key: "Y" },
          { v: false, label: "No",  emoji: "👋", key: "N" },
        ].map(opt => (
          <motion.button
            key={String(opt.v)}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => onSelect(opt.v)}
            className={`
              flex-1 flex flex-col items-center gap-2 py-6 rounded-2xl border-2 font-semibold text-base transition-all cursor-pointer
              ${value === opt.v
                ? "border-black bg-black text-white"
                : "border-gray-200 hover:border-gray-400 text-gray-800"
              }
            `}
          >
            <span className="text-3xl">{opt.emoji}</span>
            <div className="flex items-center gap-1.5">
              <span className={`text-[11px] ${value === opt.v ? "text-gray-400" : "text-gray-300"}`}>{opt.key}</span>
              <span>{opt.label}</span>
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function PlatformsStep({ value, onChange, onNext, loading }: {
  value: PriorPlatform[];
  onChange: (v: PriorPlatform[]) => void;
  onNext: () => void;
  loading: boolean;
}) {
  const options: { id: PriorPlatform; label: string; desc: string; color: string }[] = [
    { id: "vapi",   label: "Vapi.ai",   desc: "Voice AI infrastructure",    color: "bg-purple-50 border-purple-200" },
    { id: "retell", label: "Retell.ai",  desc: "AI calling platform",        color: "bg-blue-50 border-blue-200" },
    { id: "bolna",  label: "Bolna.ai",   desc: "Open-source voice agents",   color: "bg-emerald-50 border-emerald-200" },
    { id: "other",  label: "Other",      desc: "Something else",             color: "bg-gray-50 border-gray-200" },
  ];

  const toggle = (id: PriorPlatform) => {
    onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id]);
  };

  useEffect(() => {
    const keys: Record<string, PriorPlatform> = { "1": "vapi", "2": "retell", "3": "bolna", "4": "other" };
    const handler = (e: KeyboardEvent) => {
      if (keys[e.key]) toggle(keys[e.key]!);
      if (e.key === "Enter") onNext();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, onNext]);

  return (
    <div className="w-full max-w-xl">
      <p className="text-[13px] font-semibold text-emerald-600 tracking-widest uppercase mb-4">Question 5</p>
      <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 leading-tight mb-2">
        Which platforms have you used?
      </h2>
      <p className="text-gray-400 text-base mb-8">Select all that apply.</p>
      <div className="grid grid-cols-2 gap-3">
        {options.map((opt, idx) => {
          const selected = value.includes(opt.id);
          return (
            <motion.button
              key={opt.id}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => toggle(opt.id)}
              className={`
                relative flex flex-col items-start p-4 rounded-xl border-2 text-left transition-all cursor-pointer
                ${selected
                  ? "border-black bg-black text-white"
                  : `border-gray-200 hover:border-gray-400 text-gray-800 ${opt.color}`
                }
              `}
            >
              <div className="flex w-full items-start justify-between mb-2">
                <span className={`text-[11px] font-bold ${selected ? "text-gray-400" : "text-gray-300"}`}>{idx + 1}</span>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all
                  ${selected ? "border-white bg-white" : "border-gray-300"}`}>
                  {selected && <Check className="h-3 w-3 text-black" />}
                </div>
              </div>
              <p className="font-semibold text-[15px]">{opt.label}</p>
              <p className={`text-xs mt-0.5 ${selected ? "text-gray-300" : "text-gray-400"}`}>{opt.desc}</p>
            </motion.button>
          );
        })}
      </div>
      <ContinueButton onClick={onNext} loading={loading} label={value.length === 0 ? "Skip" : "Continue"} />
    </div>
  );
}

/* ── Done screen ────────────────────────────────────────────────────────── */

function DoneScreen({ name }: { name: string }) {
  const [, setLocation] = useLocation();

  const goToDashboard = useCallback(() => {
    // Use Wouter navigation; the AppRoutes gate re-checks status from server
    setLocation("/app");
  }, [setLocation]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter") goToDashboard();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goToDashboard]);

  return (
    <div className="flex flex-col items-center text-center max-w-md">
      <motion.div
        initial={{ scale: 0, rotate: -20 }}
        animate={{ scale: 1, rotate: 0, transition: { type: "spring", stiffness: 260, damping: 18 } }}
        className="w-20 h-20 rounded-full bg-black flex items-center justify-center mb-8 shadow-xl"
      >
        <Check className="h-10 w-10 text-white" strokeWidth={2.5} />
      </motion.div>
      <h2 className="text-4xl font-bold text-gray-900 mb-3">
        You're all set{name ? `, ${name.split(" ")[0]}` : ""}! 🎉
      </h2>
      <p className="text-gray-400 text-lg mb-10 leading-relaxed">
        Welcome to VoiceOrch. Let's build your first AI voice agent.
      </p>
      <motion.button
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
        onClick={goToDashboard}
        className="flex items-center gap-2.5 px-8 py-4 bg-black text-white rounded-xl font-semibold text-base hover:bg-gray-800 transition-colors shadow-md cursor-pointer"
      >
        Go to Dashboard
        <ArrowRight className="h-5 w-5" />
      </motion.button>
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────────────────────── */

export default function OnboardingPage() {
  const [, setLocation] = useLocation();
  const { data: status, isLoading: statusLoading } = useGetOnboardingStatus();
  const { mutate: complete, isPending } = useCompleteOnboarding();

  const [step, setStep] = useState(0);   // 0 = loading, 1–5 = questions, 6 = done
  const [answers, setAnswers] = useState<Answers>({
    name: "",
    role: null,
    referralSource: null,
    usedVoiceAgents: null,
    priorPlatforms: [],
  });

  // Redirect if already completed
  useEffect(() => {
    if (!statusLoading && status?.completed) {
      setLocation("/app");
    } else if (!statusLoading) {
      setStep(1);
    }
  }, [status, statusLoading, setLocation]);

  const totalSteps = answers.usedVoiceAgents === true ? 5 : 4;

  const submitOnboarding = useCallback((finalAnswers: Answers) => {
    complete(
      {
        data: {
          name:            finalAnswers.name || undefined,
          role:            finalAnswers.role ?? undefined,
          referralSource:  finalAnswers.referralSource ?? undefined,
          usedVoiceAgents: finalAnswers.usedVoiceAgents ?? undefined,
          priorPlatforms:  finalAnswers.priorPlatforms.length > 0 ? finalAnswers.priorPlatforms : undefined,
        },
      },
      {
        onSuccess: () => setStep(6),
        onError:   () => setStep(6),   // non-blocking — still show done screen
      }
    );
  }, [complete]);

  if (statusLoading || step === 0) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-gray-200 border-t-black animate-spin" />
      </div>
    );
  }

  const stepNum = Math.min(step, totalSteps);

  return (
    <div className="min-h-screen bg-white flex flex-col select-none">
      {step < 6 && (
        <>
          <ProgressBar current={stepNum - 1} total={totalSteps} />
          <header className="flex items-center justify-between px-6 pt-6 pb-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-black flex items-center justify-center">
                <span className="text-white text-xs font-bold">V</span>
              </div>
              <span className="font-semibold text-sm text-gray-900 tracking-tight">VoiceOrch</span>
            </div>
            <StepCounter current={stepNum} total={totalSteps} />
          </header>
        </>
      )}

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <AnimatePresence mode="wait" initial={false}>
          {step === 6 ? (
            <motion.div key="done" {...SLIDE_IN}>
              <DoneScreen name={answers.name} />
            </motion.div>

          ) : step === 1 ? (
            <motion.div key="q1" {...SLIDE_IN} className="w-full flex justify-center">
              <NameStep
                value={answers.name}
                onChange={(v) => setAnswers(a => ({ ...a, name: v }))}
                onNext={() => { if (answers.name.trim()) setStep(2); }}
              />
            </motion.div>

          ) : step === 2 ? (
            <motion.div key="q2" {...SLIDE_IN} className="w-full flex justify-center">
              <RoleStep
                value={answers.role}
                onSelect={(v) => {
                  // Update state + advance immediately with the fresh value — no stale closure
                  setAnswers(a => ({ ...a, role: v }));
                  setTimeout(() => setStep(3), 180);
                }}
                onNext={() => { if (answers.role) setStep(3); }}
              />
            </motion.div>

          ) : step === 3 ? (
            <motion.div key="q3" {...SLIDE_IN} className="w-full flex justify-center">
              <ReferralStep
                value={answers.referralSource}
                onSelect={(v) => {
                  setAnswers(a => ({ ...a, referralSource: v }));
                  setTimeout(() => setStep(4), 180);
                }}
                onNext={() => { if (answers.referralSource) setStep(4); }}
              />
            </motion.div>

          ) : step === 4 ? (
            <motion.div key="q4" {...SLIDE_IN} className="w-full flex justify-center">
              <VoiceAgentStep
                value={answers.usedVoiceAgents}
                onSelect={(v) => {
                  // Capture the full updated answers synchronously with the new value
                  const updated: Answers = { ...answers, usedVoiceAgents: v };
                  setAnswers(updated);
                  if (v === true) {
                    // Has prior experience → ask which platforms
                    setTimeout(() => setStep(5), 80);
                  } else {
                    // No prior experience → skip Q5, submit now
                    setTimeout(() => {
                      submitOnboarding(updated);
                      setStep(6);
                    }, 180);
                  }
                }}
                onNext={() => {
                  if (answers.usedVoiceAgents === true) setStep(5);
                  else if (answers.usedVoiceAgents === false) { submitOnboarding(answers); setStep(6); }
                }}
              />
            </motion.div>

          ) : step === 5 ? (
            <motion.div key="q5" {...SLIDE_IN} className="w-full flex justify-center">
              <PlatformsStep
                value={answers.priorPlatforms}
                onChange={(v) => setAnswers(a => ({ ...a, priorPlatforms: v }))}
                onNext={() => { submitOnboarding(answers); setStep(6); }}
                loading={isPending}
              />
            </motion.div>

          ) : null}
        </AnimatePresence>
      </main>

      {step < 6 && (
        <footer className="flex items-center justify-center gap-4 pb-6 text-[12px] text-gray-300">
          <span className="flex items-center gap-1">
            <kbd className="bg-gray-100 text-gray-500 rounded px-1.5 py-0.5 font-mono text-[11px]">↵ Enter</kbd>
            <span>to continue</span>
          </span>
          {step > 1 && (
            <button
              onClick={() => setStep(s => Math.max(1, s - 1))}
              className="text-gray-400 hover:text-gray-600 transition-colors flex items-center gap-0.5"
            >
              ← back
            </button>
          )}
        </footer>
      )}
    </div>
  );
}
