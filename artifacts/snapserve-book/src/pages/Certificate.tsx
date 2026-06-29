import { useRef } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { Award, Download, ArrowLeft, CheckCircle2, Star } from "lucide-react";
import { useProgressStore } from "@/hooks/use-progress";
import { useInternStore } from "@/hooks/use-intern";
import { allChapters } from "@/content";

function CertificateSVG({ name, date }: { name: string; date: string }) {
  return (
    <svg
      viewBox="0 0 800 560"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full rounded-2xl"
      style={{ fontFamily: "Georgia, serif" }}
    >
      {/* Background */}
      <rect width="800" height="560" fill="#fffbf5" />
      
      {/* Decorative border */}
      <rect x="16" y="16" width="768" height="528" rx="12" fill="none" stroke="#f97316" strokeWidth="3" />
      <rect x="24" y="24" width="752" height="512" rx="8" fill="none" stroke="#fed7aa" strokeWidth="1.5" />

      {/* Corner ornaments */}
      {[[40, 40], [760, 40], [40, 520], [760, 520]].map(([cx, cy], i) => (
        <g key={i} transform={`translate(${cx}, ${cy})`}>
          <circle r="8" fill="#f97316" opacity="0.2" />
          <circle r="4" fill="#f97316" opacity="0.5" />
        </g>
      ))}

      {/* Header */}
      <text x="400" y="80" textAnchor="middle" fontSize="13" fill="#94a3b8" letterSpacing="4" fontFamily="sans-serif" fontWeight="600">
        THE SNAPSERVE BOOK
      </text>
      
      {/* Star icon area */}
      <circle cx="400" cy="130" r="28" fill="#fff7ed" stroke="#f97316" strokeWidth="2" />
      <text x="400" y="138" textAnchor="middle" fontSize="24">🎓</text>

      {/* Certificate of Completion */}
      <text x="400" y="196" textAnchor="middle" fontSize="32" fill="#1e293b" fontWeight="700" letterSpacing="-0.5">
        Certificate of Completion
      </text>

      {/* This certifies */}
      <text x="400" y="238" textAnchor="middle" fontSize="15" fill="#64748b" fontFamily="sans-serif">
        This certifies that
      </text>

      {/* Name */}
      <text x="400" y="295" textAnchor="middle" fontSize="40" fill="#f97316" fontStyle="italic" fontWeight="700">
        {name || "Reader"}
      </text>
      
      {/* Underline */}
      <line x1="160" y1="308" x2="640" y2="308" stroke="#f97316" strokeWidth="1.5" opacity="0.4" />

      {/* Body text */}
      <text x="400" y="348" textAnchor="middle" fontSize="15" fill="#475569" fontFamily="sans-serif">
        has successfully completed all chapters and passed the final exam of
      </text>
      <text x="400" y="375" textAnchor="middle" fontSize="18" fill="#1e293b" fontWeight="700">
        The SnapServe Book: VoiceOrch Codebase Mastery
      </text>

      {/* Date */}
      <text x="400" y="430" textAnchor="middle" fontSize="13" fill="#94a3b8" fontFamily="sans-serif">
        Awarded on {date}
      </text>

      {/* Footer */}
      <line x1="240" y1="480" x2="400" y2="480" stroke="#cbd5e1" strokeWidth="1" />
      <line x1="400" y1="480" x2="560" y2="480" stroke="#cbd5e1" strokeWidth="1" />
      <text x="320" y="505" textAnchor="middle" fontSize="11" fill="#94a3b8" fontFamily="sans-serif">Author</text>
      <text x="480" y="505" textAnchor="middle" fontSize="11" fill="#94a3b8" fontFamily="sans-serif">SnapServe</text>
      <text x="320" y="494" textAnchor="middle" fontSize="12" fill="#475569" fontFamily="sans-serif" fontWeight="600">SnapServe Team</text>
      <text x="480" y="494" textAnchor="middle" fontSize="12" fill="#475569" fontFamily="sans-serif" fontWeight="600">AI Voice Platform</text>
    </svg>
  );
}

export default function Certificate() {
  const { completedChapters } = useProgressStore();
  const { profile } = useInternStore();
  const svgRef = useRef<HTMLDivElement>(null);

  const name = profile?.name ?? "";

  const publishedChapters = allChapters.filter(c => c.status === "published");
  const completedCount = publishedChapters.filter(c => completedChapters.includes(c.slug)).length;
  const totalCount = publishedChapters.length;
  const percentage = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100);
  const eligible = completedCount >= totalCount;

  const date = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const handleDownload = () => {
    if (!svgRef.current) return;
    const svgEl = svgRef.current.querySelector("svg");
    if (!svgEl) return;
    const data = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([data], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `snapserve-certificate-${(name || "intern").toLowerCase().replace(/\s+/g, "-")}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 pt-16 pb-24">
        <Link href="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground font-medium mb-8 transition-colors">
          <ArrowLeft size={16} /> Back to home
        </Link>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
        >
          <div className="flex items-center gap-3 mb-2">
            <Award size={28} className="text-primary" />
            <h1 className="text-4xl font-bold font-serif text-foreground">Certificate</h1>
          </div>
          <p className="text-muted-foreground text-lg mb-8">
            Complete all chapters and pass the final exam to earn your certificate.
          </p>

          {/* Progress bar */}
          <div className="p-5 rounded-2xl border-2 border-border bg-card mb-8">
            <div className="flex items-center justify-between mb-3">
              <span className="font-bold text-foreground">Your Progress</span>
              <span className="font-bold text-primary">{completedCount} / {totalCount} chapters ({percentage}%)</span>
            </div>
            <div className="h-3 rounded-full bg-muted overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${percentage}%` }}
                transition={{ duration: 1, ease: "easeOut" }}
                className="h-full bg-primary rounded-full"
              />
            </div>
            {eligible ? (
              <div className="flex items-center gap-2 mt-3 text-green-600 font-bold text-sm">
                <CheckCircle2 size={16} /> You've unlocked your certificate!
              </div>
            ) : (
              <p className="text-muted-foreground text-sm mt-3">
                Complete {totalCount - completedCount} more chapter{totalCount - completedCount !== 1 ? "s" : ""} to unlock.
              </p>
            )}
          </div>

          {eligible ? (
            <>
              {/* Name display */}
              <div className="mb-6 p-4 rounded-xl bg-orange-50 border border-orange-200 flex items-center gap-3">
                <CheckCircle2 size={18} className="text-primary flex-shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground font-medium">Certificate issued to</p>
                  <p className="font-bold text-foreground text-lg">{name || "Intern"}</p>
                </div>
              </div>

              {/* Certificate preview */}
              <div ref={svgRef} className="mb-6 shadow-2xl rounded-2xl overflow-hidden border-2 border-orange-200">
                <CertificateSVG name={name || "Intern"} date={date} />
              </div>

              {/* Download button */}
              <div className="flex gap-4">
                <button
                  onClick={handleDownload}
                  className="flex-grow flex items-center justify-center gap-3 px-8 py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-lg transition-all hover:opacity-90 active:scale-95"
                >
                  <Download size={22} /> Download Certificate (SVG)
                </button>
              </div>
            </>
          ) : (
            <div className="text-center py-16">
              <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-muted mb-6">
                <Star size={40} className="text-muted-foreground opacity-40" />
              </div>
              <h2 className="text-2xl font-serif font-bold text-foreground mb-4">Keep reading!</h2>
              <p className="text-muted-foreground text-lg mb-8">
                You need to complete <strong>all {totalCount} chapters</strong> to unlock your certificate.
              </p>
              <Link
                href="/"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-primary text-primary-foreground font-bold transition-all hover:scale-105 active:scale-95"
              >
                Continue reading <ArrowLeft size={16} className="rotate-180" />
              </Link>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
