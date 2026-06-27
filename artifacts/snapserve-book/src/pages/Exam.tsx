import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import * as Icons from "lucide-react";
import {
  getBookExam,
  submitBookExam,
  getBookExamAttempts,
  type BookExam,
  type BookExamResult,
  type BookExamAttempts,
} from "@workspace/api-client-react";
import { getDeviceId } from "@/lib/device-id";
import { Button } from "@/components/ui/button";
import { MarkdownText } from "@/components/MarkdownText";

type Phase = "intro" | "exam" | "result";
type AnswerMap = Record<string, number | number[]>;

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort((p, q) => p - q);
  const y = [...b].sort((p, q) => p - q);
  return x.every((v, i) => v === y[i]);
}

export default function Exam() {
  const [phase, setPhase] = useState<Phase>("intro");
  const [exam, setExam] = useState<BookExam | null>(null);
  const [attempts, setAttempts] = useState<BookExamAttempts | null>(null);
  const [loadError, setLoadError] = useState(false);

  const [answers, setAnswers] = useState<AnswerMap>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<BookExamResult | null>(null);

  // Refs so the countdown interval & auto-submit always read the latest values
  // without re-subscribing every tick.
  const answersRef = useRef<AnswerMap>({});
  const startedAtRef = useRef<number>(0);
  const submittedRef = useRef(false);
  const submitRef = useRef<(auto: boolean) => void>(() => {});
  answersRef.current = answers;

  // Load the (sanitized) bank + this device's attempt history.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [bank, hist] = await Promise.all([
          getBookExam(),
          getBookExamAttempts({ deviceId: getDeviceId() }).catch(() => null),
        ]);
        if (!alive) return;
        setExam(bank);
        setAttempts(hist);
      } catch {
        if (alive) setLoadError(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const handleSubmit = useCallback(
    async (auto: boolean) => {
      if (submittedRef.current || !exam) return;
      submittedRef.current = true;
      setSubmitting(true);
      const durationSeconds = Math.min(
        exam.durationMinutes * 60,
        Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000)),
      );
      try {
        const res = await submitBookExam({
          deviceId: getDeviceId(),
          answers: answersRef.current,
          durationSeconds,
        });
        setResult(res);
        setPhase("result");
        window.scrollTo({ top: 0, behavior: "auto" });
        // refresh history in the background
        void getBookExamAttempts({ deviceId: getDeviceId() })
          .then(setAttempts)
          .catch(() => {});
      } catch {
        // let the candidate retry the submit
        submittedRef.current = false;
        setSubmitting(false);
        if (!auto) {
          alert("Could not submit your exam — check your connection and try again.");
        }
      }
    },
    [exam],
  );
  submitRef.current = handleSubmit;

  // Countdown — runs only during the exam phase; auto-submits at zero.
  useEffect(() => {
    if (phase !== "exam") return;
    const id = window.setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(id);
          submitRef.current(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  const startExam = useCallback(() => {
    if (!exam) return;
    submittedRef.current = false;
    setSubmitting(false);
    setAnswers({});
    setResult(null);
    setCurrentIndex(0);
    setTimeLeft(exam.durationMinutes * 60);
    startedAtRef.current = Date.now();
    setPhase("exam");
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [exam]);

  const setSingle = useCallback((qid: string, choice: number) => {
    setAnswers((prev) => ({ ...prev, [qid]: choice }));
  }, []);

  const toggleMulti = useCallback((qid: string, choice: number) => {
    setAnswers((prev) => {
      const cur = Array.isArray(prev[qid]) ? (prev[qid] as number[]) : [];
      const next = cur.includes(choice)
        ? cur.filter((c) => c !== choice)
        : [...cur, choice].sort((a, b) => a - b);
      return { ...prev, [qid]: next };
    });
  }, []);

  const questions = exam?.questions ?? [];

  const isAnswered = useCallback(
    (qid: string, multi: boolean): boolean => {
      const v = answers[qid];
      if (multi) return Array.isArray(v) && v.length > 0;
      return typeof v === "number";
    },
    [answers],
  );

  const answeredCount = useMemo(
    () => questions.filter((q) => isAnswered(q.id, q.multi)).length,
    [questions, isAnswered],
  );

  /* ── Loading / error ──────────────────────────────────────────────────── */
  if (loadError) {
    return (
      <Shell>
        <div className="text-center py-32">
          <Icons.WifiOff className="mx-auto text-muted-foreground mb-4" size={48} />
          <h2 className="text-2xl font-serif font-bold mb-2">Couldn't load the exam</h2>
          <p className="text-muted-foreground mb-6">The exam service is unreachable right now.</p>
          <Link href="/">
            <Button variant="outline">Back to the book</Button>
          </Link>
        </div>
      </Shell>
    );
  }

  if (!exam) {
    return (
      <Shell>
        <div className="text-center py-32">
          <Icons.Loader2 className="mx-auto text-primary animate-spin" size={40} />
        </div>
      </Shell>
    );
  }

  /* ── Intro ────────────────────────────────────────────────────────────── */
  if (phase === "intro") {
    return (
      <Shell>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="max-w-3xl mx-auto px-6 py-16"
        >
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-orange-100 text-primary font-medium text-sm mb-6 border border-orange-200">
              <Icons.GraduationCap size={16} />
              Final Certification Exam
            </div>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight font-serif mb-4">
              The SnapServe Gauntlet
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-xl mx-auto leading-relaxed">
              One exam. Thirty marks. Built so that roughly{" "}
              <span className="font-semibold text-foreground">one in five</span> interns walk away
              certified. No second-guessing the bundle — every answer is graded on the server.
            </p>
          </div>

          {attempts && attempts.attemptCount > 0 && (
            <div
              className={`mb-8 p-5 rounded-2xl border flex items-center justify-between ${
                attempts.passed
                  ? "bg-green-50 border-green-200"
                  : "bg-orange-50 border-orange-200"
              }`}
            >
              <div className="flex items-center gap-3">
                {attempts.passed ? (
                  <Icons.BadgeCheck className="text-green-600" size={28} />
                ) : (
                  <Icons.Target className="text-orange-500" size={28} />
                )}
                <div>
                  <div className="font-bold text-foreground">
                    {attempts.passed ? "You're certified" : "Best so far"}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {attempts.attemptCount} attempt{attempts.attemptCount === 1 ? "" : "s"} on this
                    device
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold text-foreground">
                  {attempts.bestScore}
                  <span className="text-lg text-muted-foreground">/{attempts.total}</span>
                </div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                  Best score
                </div>
              </div>
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-4 mb-10">
            <RuleCard icon="Trophy" label="Total marks" value={`${exam.totalMarks}`} />
            <RuleCard
              icon="Flag"
              label="Pass mark"
              value={`${exam.passMarks} / ${exam.totalMarks}`}
            />
            <RuleCard icon="Timer" label="Time limit" value={`${exam.durationMinutes} min`} />
            <RuleCard icon="ListChecks" label="Questions" value={`${exam.questionCount}`} />
          </div>

          <div className="bg-card border border-border rounded-2xl p-6 mb-10">
            <h3 className="font-bold mb-3 flex items-center gap-2">
              <Icons.AlertTriangle className="text-secondary" size={18} />
              Before you begin
            </h3>
            <ul className="space-y-2 text-sm text-muted-foreground leading-relaxed">
              <li>• The {exam.durationMinutes}-minute clock starts immediately and auto-submits at zero.</li>
              <li>• Multi-select questions are worth 2 marks and are all-or-nothing — every correct box, no wrong ones.</li>
              <li>• You need {exam.passMarks} of {exam.totalMarks} to pass. There is no partial credit on the hard ones.</li>
              <li>• Retakes are allowed; your best score is what counts.</li>
            </ul>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button size="lg" className="text-base px-8 h-12" onClick={startExam}>
              <Icons.Play size={18} className="mr-1" />
              {attempts && attempts.attemptCount > 0 ? "Retake the exam" : "Begin the exam"}
            </Button>
            <Link href="/">
              <Button variant="ghost" size="lg" className="h-12">
                Back to the book
              </Button>
            </Link>
          </div>
        </motion.div>
      </Shell>
    );
  }

  /* ── Result ───────────────────────────────────────────────────────────── */
  if (phase === "result" && result) {
    const pct = Math.round((result.score / result.total) * 100);
    return (
      <Shell>
        <div className="max-w-3xl mx-auto px-6 py-16">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
            className={`rounded-3xl p-10 text-center mb-12 border-2 ${
              result.passed
                ? "bg-green-50 border-green-300"
                : "bg-orange-50 border-orange-300"
            }`}
          >
            {result.passed ? (
              <Icons.Award className="mx-auto text-green-600 mb-4" size={64} />
            ) : (
              <Icons.RefreshCcw className="mx-auto text-orange-500 mb-4" size={64} />
            )}
            <h1 className="text-4xl md:text-5xl font-serif font-bold mb-2">
              {result.passed ? "Certified." : "Not this time."}
            </h1>
            <p className="text-muted-foreground mb-6">
              {result.passed
                ? "You're in the top fifth. Genuinely well done."
                : `You needed ${result.passMarks}. Study the book and run it back.`}
            </p>
            <div className="flex items-center justify-center gap-8">
              <div>
                <div className="text-5xl font-bold text-foreground">
                  {result.score}
                  <span className="text-2xl text-muted-foreground">/{result.total}</span>
                </div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium mt-1">
                  {pct}% · pass {result.passMarks}
                </div>
              </div>
              {typeof result.durationSeconds === "number" && (
                <div>
                  <div className="text-5xl font-bold text-foreground">
                    {formatClock(result.durationSeconds)}
                  </div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium mt-1">
                    Time taken
                  </div>
                </div>
              )}
            </div>
          </motion.div>

          <div className="rounded-2xl border border-border bg-card p-8 text-center">
            <Icons.ShieldCheck className="mx-auto text-secondary mb-4" size={36} />
            <h2 className="text-xl font-serif font-bold mb-2">
              No answer review — by design
            </h2>
            <p className="text-muted-foreground leading-relaxed max-w-xl mx-auto">
              This is a real gatekeeper, not a practice quiz. The full question bank, the answer
              key, and the grading all live on the server and never reach your browser — so there's
              no per-question reveal to study (or screenshot). To raise your score, go back and read
              the chapters more closely, then take it again.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-12">
            <Button size="lg" className="h-12 px-8" onClick={startExam}>
              <Icons.RefreshCcw size={18} className="mr-1" />
              Retake the exam
            </Button>
            <Link href="/">
              <Button variant="ghost" size="lg" className="h-12">
                Back to the book
              </Button>
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  /* ── Exam (in progress) ───────────────────────────────────────────────── */
  const q = questions[currentIndex];
  const lowTime = timeLeft <= 300;
  const selected = answers[q.id];
  const selectedArr = Array.isArray(selected) ? selected : [];

  return (
    <Shell>
      {/* Sticky exam header: timer + progress */}
      <div className="sticky top-0 z-20 bg-background/90 backdrop-blur border-b border-border">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="text-sm font-medium text-muted-foreground">
            Answered <span className="text-foreground font-bold">{answeredCount}</span> /{" "}
            {questions.length}
          </div>
          <div
            className={`flex items-center gap-2 font-mono font-bold text-lg px-4 py-1.5 rounded-full ${
              lowTime ? "bg-red-100 text-red-700 animate-pulse" : "bg-muted text-foreground"
            }`}
          >
            <Icons.Timer size={18} />
            {formatClock(timeLeft)}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Question palette */}
        <div className="flex flex-wrap gap-2 mb-8">
          {questions.map((qq, i) => {
            const done = isAnswered(qq.id, qq.multi);
            const active = i === currentIndex;
            return (
              <button
                key={qq.id}
                onClick={() => setCurrentIndex(i)}
                className={`w-9 h-9 rounded-lg text-sm font-bold transition-all ${
                  active
                    ? "bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2 ring-offset-background"
                    : done
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground hover:bg-muted/70"
                }`}
                title={`Question ${i + 1}${qq.multi ? " (multi-select)" : ""}`}
              >
                {i + 1}
              </button>
            );
          })}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={q.id}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.2 }}
            className="bg-card border border-border rounded-3xl p-8 shadow-sm"
          >
            <div className="flex items-center gap-2 mb-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <span>Question {currentIndex + 1}</span>
              <span>·</span>
              <span>{q.topic}</span>
              <span>·</span>
              <span>
                {q.marks} mark{q.marks > 1 ? "s" : ""}
              </span>
              {q.multi && (
                <span className="px-2 py-0.5 rounded-full bg-secondary/20 text-secondary-foreground normal-case tracking-normal font-semibold">
                  Select all that apply
                </span>
              )}
            </div>

            <h2 className="text-xl md:text-2xl font-bold text-foreground mb-3 leading-snug">
              <MarkdownText content={q.prompt} />
            </h2>
            {q.code && (
              <pre className="bg-foreground/5 border border-border rounded-xl p-4 text-sm font-mono overflow-x-auto mb-4">
                <code>{q.code}</code>
              </pre>
            )}

            <div className="space-y-3 mt-6">
              {q.choices.map((choice, ci) => {
                const isSel = q.multi ? selectedArr.includes(ci) : selected === ci;
                return (
                  <button
                    key={ci}
                    onClick={() =>
                      q.multi ? toggleMulti(q.id, ci) : setSingle(q.id, ci)
                    }
                    className={`w-full text-left p-4 rounded-xl border-2 transition-all flex items-start gap-4 ${
                      isSel
                        ? "border-primary bg-primary/5"
                        : "border-transparent bg-muted/50 hover:bg-muted hover:border-primary/30"
                    }`}
                  >
                    <div
                      className={`w-6 h-6 ${q.multi ? "rounded-md" : "rounded-full"} border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                        isSel
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/30"
                      }`}
                    >
                      {isSel && <Icons.Check size={14} strokeWidth={3} />}
                    </div>
                    <div className="flex-grow font-medium">
                      <MarkdownText content={choice} />
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Nav */}
        <div className="flex items-center justify-between mt-8">
          <Button
            variant="outline"
            disabled={currentIndex === 0}
            onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
          >
            <Icons.ChevronLeft size={18} className="mr-1" />
            Previous
          </Button>

          {currentIndex < questions.length - 1 ? (
            <Button onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))}>
              Next
              <Icons.ChevronRight size={18} className="ml-1" />
            </Button>
          ) : (
            <Button
              className="bg-green-600 hover:bg-green-700"
              disabled={submitting}
              onClick={() => {
                const remaining = questions.length - answeredCount;
                const ok =
                  remaining === 0 ||
                  window.confirm(
                    `You have ${remaining} unanswered question${remaining === 1 ? "" : "s"}. Submit anyway? Unanswered questions score zero.`,
                  );
                if (ok) void handleSubmit(false);
              }}
            >
              {submitting ? (
                <Icons.Loader2 size={18} className="mr-1 animate-spin" />
              ) : (
                <Icons.Send size={18} className="mr-1" />
              )}
              Submit exam
            </Button>
          )}
        </div>

        <div className="text-center mt-6">
          <button
            className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4"
            disabled={submitting}
            onClick={() => {
              if (window.confirm("End the exam and submit now? This can't be undone.")) {
                void handleSubmit(false);
              }
            }}
          >
            Finish &amp; submit early
          </button>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-background pb-20">{children}</div>;
}

function RuleCard({ icon, label, value }: { icon: string; label: string; value: string }) {
  // @ts-ignore — dynamic lucide icon lookup, mirrors Home.tsx
  const Icon = Icons[icon] || Icons.Circle;
  return (
    <div className="bg-card border border-border rounded-2xl p-5 flex items-center gap-4">
      <div className="w-11 h-11 rounded-xl bg-orange-50 text-primary flex items-center justify-center flex-shrink-0">
        <Icon size={22} />
      </div>
      <div>
        <div className="text-2xl font-bold text-foreground leading-none">{value}</div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium mt-1">
          {label}
        </div>
      </div>
    </div>
  );
}
