import { useState, useMemo, useCallback } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Search as SearchIcon, BookOpen, Clock, ChevronRight, X } from "lucide-react";
import { allChapters } from "@/content";

interface SearchResult {
  chapterSlug: string;
  chapterTitle: string;
  chapterNumber: string;
  excerpt: string;
  score: number;
}

function blockToText(block: any): string {
  if (!block) return "";
  switch (block.kind) {
    case "prose":
      return [block.heading ?? "", ...(block.paragraphs ?? [])].join(" ");
    case "concept":
    case "analogy":
      return [block.title ?? "", ...(block.body ?? [])].join(" ");
    case "callout":
      return [block.title ?? "", ...(block.body ?? [])].join(" ");
    case "code":
      return [block.intro ?? "", block.filename ?? "", block.code ?? ""].join(" ");
    case "keyTakeaways":
      return (block.items ?? []).join(" ");
    case "quiz":
      return (block.questions ?? [])
        .map((q: any) => [q.prompt, ...(q.choices ?? []), q.explanation].join(" "))
        .join(" ");
    default:
      return "";
  }
}

function chapterToSearchText(chapter: any): string {
  return [
    chapter.title,
    chapter.summary,
    ...(chapter.blocks ?? []).map(blockToText),
  ].join(" ").toLowerCase();
}

function getExcerpt(text: string, query: string): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, 120) + "…";
  const start = Math.max(0, idx - 60);
  const end = Math.min(text.length, idx + query.length + 100);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

export default function Search() {
  const [query, setQuery] = useState("");

  const chaptersWithText = useMemo(
    () => allChapters
      .filter(c => c.status === "published")
      .map(c => ({ chapter: c, text: chapterToSearchText(c) })),
    []
  );

  const results: SearchResult[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];

    const terms = q.split(/\s+/).filter(Boolean);

    return chaptersWithText
      .map(({ chapter, text }) => {
        const rawText = [chapter.title, chapter.summary, ...(chapter.blocks ?? []).map(blockToText)].join(" ");
        const score = terms.reduce((acc, term) => {
          const count = (text.match(new RegExp(term, "g")) ?? []).length;
          const titleBonus = chapter.title.toLowerCase().includes(term) ? 5 : 0;
          const summaryBonus = chapter.summary.toLowerCase().includes(term) ? 3 : 0;
          return acc + count + titleBonus + summaryBonus;
        }, 0);
        return {
          chapterSlug: chapter.slug,
          chapterTitle: chapter.title,
          chapterNumber: chapter.number,
          excerpt: getExcerpt(rawText, terms[0] ?? q),
          score,
        };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
  }, [query, chaptersWithText]);

  const clear = useCallback(() => setQuery(""), []);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 pt-16 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
        >
          <div className="flex items-center gap-3 mb-2">
            <SearchIcon size={28} className="text-primary" />
            <h1 className="text-4xl font-bold font-serif text-foreground">Search</h1>
          </div>
          <p className="text-muted-foreground text-lg mb-8">
            Full-text search across all {chaptersWithText.length} published chapters.
          </p>

          {/* Search input */}
          <div className="relative mb-10">
            <SearchIcon
              size={18}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <input
              autoFocus
              type="text"
              placeholder="Search chapters, concepts, code patterns…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full pl-11 pr-11 py-4 rounded-2xl border-2 border-border bg-card text-foreground text-lg placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary transition-colors"
            />
            {query && (
              <button
                onClick={clear}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X size={18} />
              </button>
            )}
          </div>

          {/* Results */}
          <AnimatePresence mode="wait">
            {query.trim().length < 2 ? (
              <motion.div
                key="hint"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-center py-16 text-muted-foreground"
              >
                <SearchIcon size={48} className="mx-auto mb-4 opacity-20" />
                <p className="text-lg">Type at least 2 characters to search</p>
              </motion.div>
            ) : results.length === 0 ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-center py-16 text-muted-foreground"
              >
                <BookOpen size={48} className="mx-auto mb-4 opacity-20" />
                <p className="text-lg">No chapters matched "<strong>{query}</strong>"</p>
                <p className="text-sm mt-2">Try different keywords or check spelling</p>
              </motion.div>
            ) : (
              <motion.div
                key="results"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <p className="text-sm text-muted-foreground mb-4 font-medium">
                  {results.length} result{results.length !== 1 ? "s" : ""} for "<strong>{query}</strong>"
                </p>
                <div className="space-y-3">
                  {results.map((r, i) => (
                    <motion.div
                      key={r.chapterSlug}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                    >
                      <Link
                        href={`/chapter/${r.chapterSlug}`}
                        className="group flex items-start gap-4 p-5 rounded-2xl border-2 border-border hover:border-primary/30 bg-card hover:bg-primary/5 transition-all"
                      >
                        <div className="flex-shrink-0 mt-0.5">
                          <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center">
                            <span className="text-xs font-bold text-primary">{r.chapterNumber}</span>
                          </div>
                        </div>
                        <div className="flex-grow min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-bold text-foreground group-hover:text-primary transition-colors truncate">
                              {r.chapterTitle}
                            </h3>
                          </div>
                          <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">{r.excerpt}</p>
                        </div>
                        <ChevronRight size={18} className="flex-shrink-0 mt-1 text-muted-foreground group-hover:text-primary transition-colors" />
                      </Link>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}
