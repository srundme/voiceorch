import { useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, GraduationCap, FileText, FlaskConical, Trophy } from "lucide-react";
import { useInternStore } from "@/hooks/use-intern";
import { getDeviceId } from "@/lib/device-id";

const PERKS = [
  { icon: FileText,      text: "77 chapters across 17 modules" },
  { icon: FlaskConical,  text: "189 annotated source files in File Explorer" },
  { icon: GraduationCap, text: "Final exam to test your understanding" },
  { icon: Trophy,        text: "Named certificate of completion" },
];

export function InternGate({ children }: { children: ReactNode }) {
  const { profile, register } = useInternStore();
  const [name, setName]         = useState("");
  const [email, setEmail]       = useState("");
  const [error, setError]       = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (profile) return <>{children}</>;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!name.trim() || name.trim().length < 2) {
      setError("Please enter your full name (at least 2 characters).");
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    setSubmitting(true);
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    // Register in localStorage first so the book opens immediately
    register(trimmedName, trimmedEmail);
    // Then sync to server (fire-and-forget — doesn't block the UX)
    const deviceId = getDeviceId();
    fetch("/api/book/interns/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmedName, email: trimmedEmail, deviceId }),
    }).catch(() => { /* silent — local profile already saved */ });
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-[#080808] flex items-stretch">

      {/* ── Left panel ───────────────────────────────────────────── */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 px-16 py-14"
           style={{ background: "linear-gradient(145deg, #111 0%, #1a0a00 60%, #0f0500 100%)" }}>

        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-orange-500 flex items-center justify-center">
            <GraduationCap size={20} className="text-white" />
          </div>
          <span className="font-bold text-white text-lg tracking-tight">
            <span className="text-orange-400">Snap</span>Serve
          </span>
        </div>

        {/* Centre content */}
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-orange-500/30 bg-orange-500/10 text-orange-400 text-xs font-semibold tracking-wide mb-8 uppercase">
            Engineering Programme
          </div>

          <h1 className="text-5xl font-bold font-serif text-white leading-tight mb-5">
            The SnapServe<br />
            <span className="text-orange-400">Book</span>
          </h1>

          <p className="text-zinc-400 text-lg leading-relaxed mb-12 max-w-sm">
            A deep dive into the VoiceOrch codebase — every module, every
            design decision, explained.
          </p>

          <div className="space-y-4">
            {PERKS.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-4">
                <div className="w-8 h-8 rounded-lg bg-orange-500/15 flex items-center justify-center flex-shrink-0">
                  <Icon size={15} className="text-orange-400" />
                </div>
                <span className="text-zinc-300 text-sm">{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Mini certificate teaser */}
        <div className="rounded-2xl border border-white/8 bg-white/4 p-5 backdrop-blur-sm">
          <div className="flex items-center gap-3 mb-3">
            <Trophy size={16} className="text-orange-400" />
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Certificate preview</span>
          </div>
          <div className="rounded-xl overflow-hidden border border-orange-900/40 opacity-70">
            <svg viewBox="0 0 400 120" xmlns="http://www.w3.org/2000/svg"
                 style={{ fontFamily: "Georgia, serif", display: "block", width: "100%" }}>
              <rect width="400" height="120" fill="#fffbf5" />
              <rect x="6" y="6" width="388" height="108" rx="6" fill="none" stroke="#f97316" strokeWidth="1.5" />
              <text x="200" y="28" textAnchor="middle" fontSize="7" fill="#94a3b8"
                    fontFamily="sans-serif" fontWeight="600" letterSpacing="2">THE SNAPSERVE BOOK</text>
              <text x="200" y="52" textAnchor="middle" fontSize="14" fill="#1e293b" fontWeight="700">
                Certificate of Completion
              </text>
              <text x="200" y="68" textAnchor="middle" fontSize="7" fill="#64748b" fontFamily="sans-serif">
                This certifies that
              </text>
              <text x="200" y="86" textAnchor="middle" fontSize="16" fill="#f97316"
                    fontStyle="italic" fontWeight="700">Your Name</text>
              <line x1="80" y1="92" x2="320" y2="92" stroke="#f97316" strokeWidth="0.8" opacity="0.4" />
              <text x="200" y="110" textAnchor="middle" fontSize="6" fill="#94a3b8" fontFamily="sans-serif">
                VoiceOrch Codebase Mastery • SnapServe AI Voice Platform
              </text>
            </svg>
          </div>
        </div>
      </div>

      {/* ── Right panel — form ────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center px-6 py-14 bg-[#0d0d0d]">
        <AnimatePresence mode="wait">
          <motion.div
            key="form"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="w-full max-w-md"
          >
            {/* Mobile logo */}
            <div className="flex items-center gap-2 mb-10 lg:hidden">
              <div className="w-8 h-8 rounded-xl bg-orange-500 flex items-center justify-center">
                <GraduationCap size={17} className="text-white" />
              </div>
              <span className="font-bold text-white text-base">
                <span className="text-orange-400">Snap</span>Serve
              </span>
            </div>

            <h2 className="text-3xl font-bold text-white mb-2">
              Register to start
            </h2>
            <p className="text-zinc-500 text-sm mb-8 leading-relaxed">
              Your name will appear on your certificate — enter it exactly as you'd like it printed.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
                  Full name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Priya Sharma"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  autoFocus
                  className="w-full px-4 py-3.5 rounded-xl border border-zinc-800 bg-zinc-900 text-white placeholder:text-zinc-600 focus:outline-none focus:border-orange-500/60 focus:ring-1 focus:ring-orange-500/30 transition-all text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
                  Email address
                </label>
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full px-4 py-3.5 rounded-xl border border-zinc-800 bg-zinc-900 text-white placeholder:text-zinc-600 focus:outline-none focus:border-orange-500/60 focus:ring-1 focus:ring-orange-500/30 transition-all text-sm"
                />
              </div>

              <AnimatePresence>
                {error && (
                  <motion.p
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="text-red-400 text-sm font-medium"
                  >
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>

              <button
                type="submit"
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl font-bold text-sm transition-all mt-2 disabled:opacity-60"
                style={{ background: "#f97316", color: "#fff" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#ea6c0a")}
                onMouseLeave={e => (e.currentTarget.style.background = "#f97316")}
              >
                {submitting ? (
                  <span className="animate-pulse">Setting up your profile…</span>
                ) : (
                  <>Begin reading <ArrowRight size={16} /></>
                )}
              </button>
            </form>

            <p className="text-zinc-600 text-xs text-center mt-8">
              Your progress is saved locally in your browser.
              No account or password needed.
            </p>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
