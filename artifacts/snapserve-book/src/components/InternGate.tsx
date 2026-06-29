import { useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BookOpen, ArrowRight, Sparkles, CheckCircle2 } from "lucide-react";
import { useInternStore } from "@/hooks/use-intern";

const PERKS = [
  "77 chapters across 17 modules",
  "File Explorer with 189 annotated source files",
  "Final exam with certificate of completion",
  "Your progress saved automatically across sessions",
];

export function InternGate({ children }: { children: ReactNode }) {
  const { profile, register } = useInternStore();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"welcome" | "form">("welcome");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Already registered — render the book normally
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
    // Small delay for perceived feedback, then register
    setTimeout(() => {
      register(name.trim(), email.trim());
      setSubmitting(false);
    }, 600);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <AnimatePresence mode="wait">

        {step === "welcome" ? (
          /* ── Welcome screen ─────────────────────────── */
          <motion.div
            key="welcome"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -24 }}
            transition={{ duration: 0.4 }}
            className="max-w-xl w-full text-center"
          >
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-orange-50 border border-orange-200 text-primary text-sm font-bold mb-8">
              <Sparkles size={14} /> SnapServe Engineering Programme
            </div>

            {/* Book icon */}
            <div className="flex justify-center mb-6">
              <div className="w-24 h-24 rounded-3xl bg-orange-50 border-2 border-orange-200 flex items-center justify-center">
                <BookOpen size={44} className="text-primary" />
              </div>
            </div>

            <h1 className="text-5xl font-bold font-serif text-foreground mb-4">
              The SnapServe Book
            </h1>
            <p className="text-xl text-muted-foreground mb-10 leading-relaxed">
              Your complete guide to the VoiceOrch codebase.<br />
              Read every chapter, pass the exam, earn your certificate.
            </p>

            {/* Perks */}
            <div className="grid grid-cols-1 gap-3 mb-10 text-left">
              {PERKS.map((perk) => (
                <div key={perk} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-card border border-border">
                  <CheckCircle2 size={16} className="text-primary flex-shrink-0" />
                  <span className="text-sm font-medium text-foreground">{perk}</span>
                </div>
              ))}
            </div>

            <button
              onClick={() => setStep("form")}
              className="w-full flex items-center justify-center gap-3 px-8 py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-lg transition-all hover:opacity-90 active:scale-95"
            >
              Get Started <ArrowRight size={20} />
            </button>
          </motion.div>

        ) : (
          /* ── Registration form ──────────────────────── */
          <motion.div
            key="form"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -24 }}
            transition={{ duration: 0.4 }}
            className="max-w-md w-full"
          >
            {/* Header */}
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-orange-50 border-2 border-orange-200 mb-4">
                <BookOpen size={28} className="text-primary" />
              </div>
              <h2 className="text-3xl font-bold font-serif text-foreground mb-2">
                Create your profile
              </h2>
              <p className="text-muted-foreground">
                Your name will appear on your certificate of completion.
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-bold text-foreground mb-2">
                  Full name <span className="text-primary">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Priya Sharma"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  autoFocus
                  className="w-full px-4 py-3 rounded-xl border-2 border-border bg-card text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary transition-colors text-base"
                />
                <p className="text-xs text-muted-foreground mt-1.5">
                  This name will be printed on your certificate — enter it exactly as you'd like it to appear.
                </p>
              </div>

              <div>
                <label className="block text-sm font-bold text-foreground mb-2">
                  Email address <span className="text-primary">*</span>
                </label>
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border-2 border-border bg-card text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary transition-colors text-base"
                />
              </div>

              {error && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-sm text-red-600 font-medium"
                >
                  {error}
                </motion.p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full flex items-center justify-center gap-3 px-8 py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-lg transition-all hover:opacity-90 active:scale-95 disabled:opacity-60 mt-2"
              >
                {submitting ? (
                  <span className="animate-pulse">Setting up your profile…</span>
                ) : (
                  <>Start Learning <ArrowRight size={20} /></>
                )}
              </button>

              <button
                type="button"
                onClick={() => setStep("welcome")}
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                ← Back
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
