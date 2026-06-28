import { Link } from "wouter";
import { motion } from "framer-motion";
import { Bookmark, BookOpen, ArrowLeft } from "lucide-react";
import { useBookmarksStore } from "@/hooks/use-bookmarks";
import { getChapter, getModule } from "@/content";

export default function Bookmarks() {
  const { bookmarked, toggleBookmark } = useBookmarksStore();

  const chapters = bookmarked
    .map(slug => getChapter(slug))
    .filter(Boolean) as NonNullable<ReturnType<typeof getChapter>>[];

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
            <Bookmark size={28} className="text-amber-500" />
            <h1 className="text-4xl font-bold font-serif text-foreground">Bookmarks</h1>
          </div>
          <p className="text-muted-foreground text-lg mb-8">
            {bookmarked.length === 0
              ? "No bookmarks yet — click the bookmark icon on any chapter."
              : `${bookmarked.length} bookmarked chapter${bookmarked.length !== 1 ? "s" : ""}.`}
          </p>

          {chapters.length === 0 ? (
            <div className="text-center py-20">
              <Bookmark size={56} className="mx-auto mb-4 text-muted-foreground opacity-20" />
              <p className="text-muted-foreground text-lg">
                Open any chapter and click the <strong>🔖</strong> bookmark icon to save it here.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {chapters.map((chapter, i) => {
                const mod = getModule(chapter.moduleId);
                return (
                  <motion.div
                    key={chapter.slug}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="flex items-center gap-4 p-5 rounded-2xl border-2 border-border bg-card group"
                  >
                    <div className="flex-shrink-0">
                      <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center">
                        <span className="text-sm font-bold text-amber-600">{chapter.number}</span>
                      </div>
                    </div>
                    <div className="flex-grow min-w-0">
                      <Link
                        href={`/chapter/${chapter.slug}`}
                        className="font-bold text-foreground hover:text-primary transition-colors line-clamp-1"
                      >
                        {chapter.title}
                      </Link>
                      {mod && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Module {mod.number}: {mod.title}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Link
                        href={`/chapter/${chapter.slug}`}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-bold hover:bg-primary/20 transition-colors"
                      >
                        <BookOpen size={12} /> Read
                      </Link>
                      <button
                        onClick={() => toggleBookmark(chapter.slug)}
                        className="p-1.5 rounded-lg text-amber-500 hover:bg-amber-50 transition-colors"
                        title="Remove bookmark"
                      >
                        <Bookmark size={15} fill="currentColor" />
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
