import { Link, useRoute } from "wouter";
import { teacherChapters, teacherModule, getTeacherChapter } from "@/content";
import { BlockRenderer } from "./ChapterReader";
import NotFound from "./not-found";
import * as Icons from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Teacher's Guide — a standalone area at /teach, outside the intern book.
// No registration gate, no global nav, no progress tracking. The founder opens
// /teach on a screen and teaches straight from the lesson script.
// ─────────────────────────────────────────────────────────────────────────────

export function TeacherGuideIndex() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 py-16">
        <div className="flex items-center gap-3 mb-2 text-primary">
          <Icons.GraduationCap size={32} />
          <span className="uppercase tracking-widest text-sm font-bold">Teacher's Guide</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold font-serif mb-4">{teacherModule.title}</h1>
        <p className="text-lg text-foreground/70 mb-10 max-w-2xl">{teacherModule.description}</p>

        <div className="space-y-4">
          {teacherChapters.map((ch) => (
            <Link key={ch.slug} href={`/teach/${ch.slug}`} className="block p-6 rounded-2xl border-2 border-border bg-card hover:border-primary transition-colors">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-bold text-primary mb-1">{ch.number}</div>
                    <div className="text-2xl font-serif font-bold">{ch.title}</div>
                    <p className="text-foreground/70 mt-2">{ch.summary}</p>
                  </div>
                  <div className="flex items-center gap-2 text-foreground/50 shrink-0">
                    <Icons.Clock size={16} />
                    <span className="text-sm">{ch.estMinutes} min</span>
                    <Icons.ChevronRight size={20} />
                  </div>
                </div>
            </Link>
          ))}
        </div>

        <p className="text-sm text-foreground/50 mt-10">
          More days will appear here as they are added. This page is separate from the intern book.
        </p>
      </div>
    </div>
  );
}

export function TeacherGuideChapter() {
  const [match, params] = useRoute("/teach/:slug");
  if (!match || !params?.slug) return <NotFound />;
  const chapter = getTeacherChapter(params.slug);
  if (!chapter) return <NotFound />;

  const idx = teacherChapters.findIndex((c) => c.slug === chapter.slug);
  const prev = idx > 0 ? teacherChapters[idx - 1] : undefined;
  const next = idx >= 0 && idx < teacherChapters.length - 1 ? teacherChapters[idx + 1] : undefined;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <Link href="/teach" className="inline-flex items-center gap-2 text-primary font-bold mb-8 hover:underline">
          <Icons.ArrowLeft size={18} /> All teaching days
        </Link>

        <div className="mb-10">
          <div className="text-sm font-bold text-primary mb-2">{chapter.number}</div>
          <h1 className="text-4xl md:text-5xl font-bold font-serif mb-4">{chapter.title}</h1>
          <p className="text-lg text-foreground/70">{chapter.summary}</p>
        </div>

        <BlockRenderer blocks={chapter.blocks} />

        <div className="flex justify-between items-center mt-16 pt-8 border-t border-border">
          {prev ? (
            <Link href={`/teach/${prev.slug}`} className="inline-flex items-center gap-2 text-primary font-bold hover:underline">
              <Icons.ArrowLeft size={18} /> {prev.title}
            </Link>
          ) : <span />}
          {next ? (
            <Link href={`/teach/${next.slug}`} className="inline-flex items-center gap-2 text-primary font-bold hover:underline">
              {next.title} <Icons.ArrowRight size={18} />
            </Link>
          ) : <span />}
        </div>
      </div>
    </div>
  );
}
