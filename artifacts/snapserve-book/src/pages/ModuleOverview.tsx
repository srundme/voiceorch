import { useRoute, Link } from "wouter";
import { motion } from "framer-motion";
import { modules, getChaptersForModule } from "@/content";
import { useProgressStore } from "@/hooks/use-progress";
import * as Icons from "lucide-react";
import NotFound from "./not-found";

export default function ModuleOverview() {
  const [match, params] = useRoute("/module/:slug");
  const mod = modules.find((m) => m.slug === params?.slug);
  const { isChapterCompleted } = useProgressStore();

  if (!match || !mod) return <NotFound />;

  const chapters = getChaptersForModule(mod.id);
  // @ts-ignore
  const Icon = Icons[mod.icon] || Icons.BookOpen;

  return (
    <div className="min-h-screen bg-background pb-20 pt-16 px-6">
      <div className="max-w-3xl mx-auto">
        <Link href="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground font-medium mb-12 transition-colors">
          <Icons.ArrowLeft size={16} /> Back to Overview
        </Link>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-16"
        >
          <div className="w-16 h-16 rounded-2xl bg-orange-100 text-primary flex items-center justify-center mb-6">
            <Icon size={32} strokeWidth={2} />
          </div>
          <h1 className="text-sm font-bold text-primary uppercase tracking-widest mb-3">
            Module {mod.number}
          </h1>
          <h2 className="text-4xl md:text-5xl font-serif font-bold text-foreground mb-6">
            {mod.title}
          </h2>
          <p className="text-xl text-muted-foreground leading-relaxed">
            {mod.description}
          </p>
        </motion.div>

        <div className="space-y-4">
          {chapters.map((chapter, i) => {
            const isCompleted = isChapterCompleted(chapter.slug);
            const isPublished = chapter.status === "published";

            return (
              <motion.div
                key={chapter.slug}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 * i }}
              >
                {isPublished ? (
                  <Link href={`/chapter/${chapter.slug}`} className="block">
                    <div className={`p-6 rounded-2xl border-2 transition-all duration-200 flex items-start gap-6 cursor-pointer
                      ${isCompleted ? 'bg-card border-green-200 hover:border-green-300' : 'bg-card border-transparent hover:border-primary/20 hover:shadow-md'}`}>
                      
                      <div className={`w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center border-2 
                        ${isCompleted ? 'bg-green-100 border-green-500 text-green-600' : 'border-muted-foreground/30 text-muted-foreground'}`}>
                        {isCompleted ? <Icons.Check size={20} strokeWidth={3} /> : <span className="font-bold text-sm">{chapter.number}</span>}
                      </div>

                      <div className="flex-grow">
                        <h3 className={`text-xl font-bold mb-2 ${isCompleted ? 'text-foreground' : 'text-foreground'}`}>
                          {chapter.title}
                        </h3>
                        <p className="text-muted-foreground leading-relaxed">
                          {chapter.summary}
                        </p>
                        <div className="mt-4 flex items-center gap-4 text-sm font-medium text-muted-foreground">
                          <span className="flex items-center gap-1.5"><Icons.Clock size={14}/> {chapter.estMinutes} min</span>
                        </div>
                      </div>
                    </div>
                  </Link>
                ) : (
                  <div className="p-6 rounded-2xl border-2 border-dashed border-muted bg-transparent flex items-start gap-6 opacity-60">
                    <div className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center border-2 border-muted-foreground/30 text-muted-foreground">
                      <span className="font-bold text-sm">{chapter.number}</span>
                    </div>
                    <div>
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted text-xs font-bold uppercase tracking-wider mb-2">
                        Coming Soon
                      </div>
                      <h3 className="text-xl font-bold text-foreground mb-2">
                        {chapter.title}
                      </h3>
                      <p className="text-muted-foreground leading-relaxed">
                        {chapter.summary}
                      </p>
                    </div>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
