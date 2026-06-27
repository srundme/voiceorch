import { Link } from "wouter";
import { motion } from "framer-motion";
import { course, courseStats, modules, getPublishedChaptersForModule } from "@/content";
import { useProgressStore } from "@/hooks/use-progress";
import * as Icons from "lucide-react";

export default function Home() {
  const { getModuleProgress } = useProgressStore();

  return (
    <div className="min-h-screen bg-background pb-20">
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
    </div>
  );
}
