import { useRoute, Link } from "wouter";
import { getChapter, getChapterNeighbors, getChaptersForModule, getModule } from "@/content";
import { useProgressStore } from "@/hooks/use-progress";
import NotFound from "./not-found";
import { MarkdownText } from "@/components/MarkdownText";
import * as Icons from "lucide-react";
import { motion } from "framer-motion";
import React from "react";
import { CodeBlockRenderer } from "@/components/blocks/CodeBlockRenderer";
import { QuizBlockRenderer } from "@/components/blocks/QuizBlockRenderer";
import { ConnectionsBlockRenderer } from "@/components/blocks/ConnectionsBlockRenderer";
import { CalloutBlockRenderer, KeyTakeawaysBlockRenderer } from "@/components/blocks/CalloutBlockRenderer";

function BlockRenderer({ blocks }: { blocks: any[] }) {
  return (
    <div className="space-y-12">
      {blocks.map((block, idx) => (
        <motion.div 
          key={idx} 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.5 }}
          className="block-wrapper"
        >
          {block.kind === "prose" && (
            <div className="prose-block">
              {block.heading && <h2 className="text-3xl font-bold font-serif mb-6 text-foreground">{block.heading}</h2>}
              <div className="space-y-4">
                {block.paragraphs.map((p: string, i: number) => (
                  <p key={i} className="text-lg text-foreground/80 leading-relaxed font-medium"><MarkdownText content={p} /></p>
                ))}
              </div>
            </div>
          )}
          {block.kind === "concept" && (
            <div className="p-8 rounded-3xl bg-secondary/10 border-2 border-secondary/20 my-8">
              <div className="flex items-center gap-3 mb-4 text-secondary-foreground font-bold">
                <Icons.Lightbulb size={28} className="text-secondary" />
                <h3 className="text-2xl font-serif">{block.title}</h3>
              </div>
              <div className="space-y-4">
                {block.body.map((p: string, i: number) => (
                  <p key={i} className="text-lg text-foreground/80 leading-relaxed"><MarkdownText content={p} /></p>
                ))}
              </div>
            </div>
          )}
          {block.kind === "analogy" && (
            <div className="p-8 rounded-3xl bg-primary/5 border-2 border-primary/20 my-8">
              <div className="flex items-center gap-3 mb-4 text-primary font-bold">
                <Icons.Sparkles size={28} />
                <h3 className="text-2xl font-serif">{block.title || "Analogy"}</h3>
              </div>
              <div className="space-y-4">
                {block.body.map((p: string, i: number) => (
                  <p key={i} className="text-lg text-foreground/80 leading-relaxed"><MarkdownText content={p} /></p>
                ))}
              </div>
            </div>
          )}
          {block.kind === "code" && <CodeBlockRenderer block={block} />}
          {block.kind === "quiz" && <QuizBlockRenderer block={block} />}
          {block.kind === "connections" && <ConnectionsBlockRenderer block={block} />}
          {block.kind === "callout" && <CalloutBlockRenderer block={block} />}
          {block.kind === "keyTakeaways" && <KeyTakeawaysBlockRenderer block={block} />}
        </motion.div>
      ))}
    </div>
  );
}

export default function ChapterReader() {
  const [match, params] = useRoute("/chapter/:slug");
  const { isChapterCompleted, markChapterComplete, unmarkChapterComplete } = useProgressStore();

  if (!match || !params?.slug) return <NotFound />;
  
  const chapter = getChapter(params.slug);
  if (!chapter) return <NotFound />;

  const moduleInfo = getModule(chapter.moduleId);

  if (chapter.status !== "published") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <div className="max-w-lg text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-muted text-muted-foreground font-bold text-xs uppercase tracking-wider mb-6">
            Coming Soon
          </div>
          <h1 className="text-4xl md:text-5xl font-serif font-bold text-foreground mb-6 leading-tight">
            {chapter.title}
          </h1>
          <p className="text-xl text-muted-foreground leading-relaxed mb-10">
            {chapter.summary}
          </p>
          <Link
            href={`/module/${moduleInfo?.slug ?? ""}`}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-primary text-primary-foreground font-bold transition-transform hover:scale-105 active:scale-95"
            data-testid="link-back-to-module"
          >
            <Icons.ArrowLeft size={18} /> Back to {moduleInfo?.title || "Module"}
          </Link>
        </div>
      </div>
    );
  }

  const moduleChapters = moduleInfo ? getChaptersForModule(moduleInfo.id) : [];

  const { prev, next } = getChapterNeighbors(chapter.slug);
  const completed = isChapterCompleted(chapter.slug);

  const toggleComplete = () => {
    if (completed) unmarkChapterComplete(chapter.slug);
    else markChapterComplete(chapter.slug);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="w-full md:w-80 flex-shrink-0 border-r border-border bg-card/50 p-6 hidden md:block overflow-y-auto max-h-screen sticky top-0">
        <Link href={`/module/${moduleInfo?.slug ?? ""}`} className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground font-medium mb-8 transition-colors">
          <Icons.ArrowLeft size={16} /> Back to {moduleInfo?.title || "Module"}
        </Link>
        <div className="text-sm font-bold text-primary uppercase tracking-widest mb-4">
          Module {moduleInfo?.number}
        </div>
        
        <div className="space-y-1 mt-4">
          {moduleChapters.map(c => {
            const isCurrent = c.slug === chapter.slug;
            const isDone = isChapterCompleted(c.slug);
            const isPublished = c.status === "published";
            
            return (
              <div key={c.slug} className={`flex items-center gap-3 p-3 rounded-xl transition-all ${isCurrent ? 'bg-orange-100 text-primary font-bold' : isPublished ? 'hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer' : 'opacity-50 text-muted-foreground'}`}>
                <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${isDone ? 'bg-green-500 text-white' : isCurrent ? 'border-2 border-primary text-primary' : 'border-2 border-muted-foreground/30'}`}>
                  {isDone ? <Icons.Check size={12} strokeWidth={3} /> : null}
                </div>
                {isPublished ? (
                  <Link href={`/chapter/${c.slug}`} className="flex-grow line-clamp-2 text-sm leading-snug">
                    {c.number}. {c.title}
                  </Link>
                ) : (
                  <div className="flex-grow line-clamp-2 text-sm leading-snug">
                    {c.number}. {c.title}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-grow w-full overflow-hidden">
        <article className="px-6 py-12 md:py-20 md:px-16 max-w-4xl mx-auto">
          <header className="mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-orange-100 text-primary font-bold text-xs uppercase tracking-wider mb-6 border border-orange-200">
              Chapter {chapter.number}
            </div>
            <h1 className="text-4xl md:text-6xl font-serif font-bold text-foreground mb-6 leading-tight">
              {chapter.title}
            </h1>
            <p className="text-xl text-muted-foreground leading-relaxed">
              {chapter.summary}
            </p>
          </header>

          <BlockRenderer blocks={chapter.blocks} />

          {/* Completion & Navigation Footer */}
          <footer className="mt-24 pt-12 border-t border-border">
            <div className="flex flex-col items-center mb-16 text-center">
              <h3 className="text-2xl font-serif font-bold mb-6 text-foreground">Finished reading?</h3>
              <button 
                onClick={toggleComplete}
                className={`flex items-center gap-3 px-8 py-4 rounded-full font-bold text-lg transition-all duration-300 transform hover:scale-105 active:scale-95 ${
                  completed 
                    ? 'bg-green-100 text-green-800 border-2 border-green-500 shadow-[0_0_20px_rgba(34,197,94,0.2)]' 
                    : 'bg-primary text-primary-foreground shadow-xl shadow-primary/20'
                }`}
              >
                {completed ? (
                  <><Icons.CheckCircle2 size={24} /> Chapter Completed!</>
                ) : (
                  <><Icons.Circle size={24} /> Mark as Complete</>
                )}
              </button>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {prev ? (
                <Link href={`/chapter/${prev.slug}`} className="group p-6 rounded-2xl bg-card border-2 border-transparent hover:border-primary/20 text-left transition-all hover:-translate-y-1 hover:shadow-md">
                  <div className="text-sm font-bold text-muted-foreground uppercase tracking-widest mb-2 flex items-center gap-2">
                    <Icons.ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" /> Previous
                  </div>
                  <div className="font-bold text-foreground text-lg group-hover:text-primary transition-colors">{prev.title}</div>
                </Link>
              ) : <div />}
              
              {next ? (
                <Link href={`/chapter/${next.slug}`} className="group p-6 rounded-2xl bg-card border-2 border-transparent hover:border-primary/20 text-right transition-all hover:-translate-y-1 hover:shadow-md">
                  <div className="text-sm font-bold text-muted-foreground uppercase tracking-widest mb-2 flex items-center justify-end gap-2">
                    Next <Icons.ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                  </div>
                  <div className="font-bold text-foreground text-lg group-hover:text-primary transition-colors">{next.title}</div>
                </Link>
              ) : <div />}
            </div>
          </footer>
        </article>
      </main>
    </div>
  );
}
