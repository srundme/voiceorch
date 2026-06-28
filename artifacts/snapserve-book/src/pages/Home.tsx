import { useEffect, useState } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { course, courseStats, modules, getPublishedChaptersForModule } from "@/content";
import { useProgressStore } from "@/hooks/use-progress";
import { useBookmarksStore } from "@/hooks/use-bookmarks";
import { useDarkMode } from "@/hooks/use-dark-mode";
import { getBookExamAttempts, type BookExamAttempts } from "@workspace/api-client-react";
import { getDeviceId } from "@/lib/device-id";
import * as Icons from "lucide-react";

export default function Home() {
  const { getModuleProgress } = useProgressStore();
  const { bookmarked } = useBookmarksStore();
  const { isDark, toggle: toggleDark } = useDarkMode();
  const [examAttempts, setExamAttempts] = useState<BookExamAttempts | null>(null);

  useEffect(() => {
    let alive = true;
    getBookExamAttempts({ deviceId: getDeviceId() })
      .then((a) => {
        if (alive) setExamAttempts(a);
      })
      .catch(() => {
        /* exam history is best-effort on the home page */
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Quick-access toolbar */}
      <div className="sticky top-0 z-50 bg-background/90 backdrop-blur-sm border-b border-border">
        <div className="max-w-5xl mx-auto px-6 flex items-center justify-between h-12 gap-2">
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            <Link href="/search" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-all whitespace-nowrap">
              <Icons.Search size={13} /> Search
            </Link>
            <Link href="/glossary" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-all whitespace-nowrap">
              <Icons.BookMarked size={13} /> Glossary
            </Link>
            <Link href="/cheatsheet" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-all whitespace-nowrap">
              <Icons.FileCode2 size={13} /> Cheat Sheet
            </Link>
            <Link href="/architecture" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-all whitespace-nowrap">
              <Icons.Map size={13} /> Architecture
            </Link>
            <Link href="/bookmarks" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-all whitespace-nowrap">
              <Icons.Bookmark size={13} />
              Bookmarks
              {bookmarked.length > 0 && (
                <span className="ml-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-400 text-white text-[10px] font-bold">{bookmarked.length}</span>
              )}
            </Link>
            <Link href="/certificate" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-all whitespace-nowrap">
              <Icons.Award size={13} /> Certificate
            </Link>
          </div>
          <button
            onClick={toggleDark}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all flex-shrink-0"
            title={isDark ? "Light mode" : "Dark mode"}
          >
            {isDark ? <Icons.Sun size={15} /> : <Icons.Moon size={15} />}
          </button>
        </div>
      </div>

      {/* Hero */}
      <section className="pt-24 pb-16 px-6 max-w-5xl mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-orange-100 text-primary font-medium text-sm mb-6 border border-orange-200">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            Interactive Codebase Tour
          </div>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-foreground mb-6 font-serif">
            {course.title}
          </h1>
          <p className="text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            {course.subtitle}
          </p>
        </motion.div>

        <motion.div 
          className="flex justify-center gap-8 mt-12"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          <div className="text-center">
            <div className="text-3xl font-bold text-foreground">{courseStats.moduleCount}</div>
            <div className="text-sm text-muted-foreground font-medium uppercase tracking-wider mt-1">Modules</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-foreground">{courseStats.publishedCount}</div>
            <div className="text-sm text-muted-foreground font-medium uppercase tracking-wider mt-1">Chapters</div>
          </div>
        </motion.div>
      </section>

      {/* Modules Grid */}
      <section className="px-6 max-w-5xl mx-auto">
        <div className="grid md:grid-cols-2 gap-6">
          {modules.map((mod, i) => {
            const progress = getModuleProgress(
              getPublishedChaptersForModule(mod.id).map((c) => c.slug)
            );
            // @ts-ignore
            const Icon = Icons[mod.icon] || Icons.BookOpen;

            return (
              <motion.div
                key={mod.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 * i, duration: 0.5 }}
              >
                <Link href={`/module/${mod.slug}`} className="block h-full">
                  <div className="group h-full p-8 rounded-3xl bg-card border-2 border-transparent hover:border-primary/20 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col cursor-pointer hover:-translate-y-1">
                    <div className="flex items-start justify-between mb-6">
                      <div className="w-14 h-14 rounded-2xl bg-orange-50 text-primary flex items-center justify-center group-hover:scale-110 group-hover:rotate-3 transition-transform duration-300">
                        <Icon size={28} strokeWidth={2} />
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-bold text-muted-foreground uppercase tracking-widest">
                          Module {mod.number}
                        </div>
                        {progress.total > 0 && (
                          <div className="text-xs font-medium text-primary mt-1">
                            {progress.completed} / {progress.total} done
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <h3 className="text-2xl font-bold mb-3 group-hover:text-primary transition-colors">
                      {mod.title}
                    </h3>
                    <p className="text-muted-foreground leading-relaxed flex-grow">
                      {mod.tagline}
                    </p>

                    {progress.total > 0 && (
                      <div className="mt-6 h-2 w-full bg-muted rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-primary transition-all duration-1000 ease-out"
                          style={{ width: `${progress.percentage}%` }}
                        />
                      </div>
                    )}
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* Final exam CTA */}
      <section className="px-6 max-w-5xl mx-auto mt-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <Link href="/exam" className="block">
            <div className="group relative overflow-hidden rounded-3xl bg-foreground text-background p-8 md:p-10 shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-1 cursor-pointer">
              <div className="absolute -right-12 -top-12 w-48 h-48 rounded-full bg-primary/20 blur-2xl" />
              <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                <div className="flex-grow">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/20 text-primary-foreground font-medium text-xs mb-4">
                    <Icons.GraduationCap size={14} />
                    Final Certification Exam
                  </div>
                  <h2 className="text-3xl md:text-4xl font-bold font-serif mb-2">
                    Think you know SnapServe?
                  </h2>
                  <p className="text-background/70 max-w-xl leading-relaxed">
                    30 marks, 30 minutes, server-graded. Calibrated so only about one in five make
                    the cut. Prove it.
                  </p>
                </div>
                <div className="flex items-center gap-5 flex-shrink-0">
                  {examAttempts && examAttempts.attemptCount > 0 && (
                    <div className="text-right">
                      <div className="text-3xl font-bold">
                        {examAttempts.bestScore}
                        <span className="text-lg text-background/60">/{examAttempts.total}</span>
                      </div>
                      <div className="text-xs uppercase tracking-wider text-background/60 font-medium">
                        {examAttempts.passed ? "Certified ✓" : "Best score"}
                      </div>
                    </div>
                  )}
                  <div className="w-14 h-14 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center group-hover:scale-110 group-hover:rotate-3 transition-transform duration-300">
                    <Icons.ArrowRight size={26} />
                  </div>
                </div>
              </div>
            </div>
          </Link>
        </motion.div>
      </section>
    </div>
  );
}
