import { useState, useMemo } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  FolderOpen, FileCode, Search, BookOpen, Tag, X,
  ChevronRight, Folder, Filter
} from "lucide-react";
import { fileIndex, allTags, fileIndexStats, type FileEntry } from "@/content/file-index";

// ── Directory tree helpers ───────────────────────────────────────────────────

function getSegments(path: string) {
  return path.replace(/\/$/, "").split("/");
}

function firstTwoSegments(path: string) {
  return getSegments(path).slice(0, 2).join("/");
}

/** Group entries by their top-level directory (artifacts/X or lib/X or scripts) */
function groupByDir(entries: FileEntry[]) {
  const map = new Map<string, FileEntry[]>();
  for (const entry of entries) {
    const segs = getSegments(entry.path);
    const key = segs.length >= 2 ? `${segs[0]}/${segs[1]}` : segs[0] ?? "";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(entry);
  }
  return map;
}

// ── Tag colors ───────────────────────────────────────────────────────────────
const TAG_COLORS: Record<string, string> = {
  orchestration: "bg-amber-100 text-amber-800",
  telephony:     "bg-orange-100 text-orange-800",
  auth:          "bg-red-100 text-red-800",
  database:      "bg-blue-100 text-blue-800",
  frontend:      "bg-purple-100 text-purple-800",
  llm:           "bg-green-100 text-green-800",
  stt:           "bg-teal-100 text-teal-800",
  tts:           "bg-cyan-100 text-cyan-800",
  billing:       "bg-emerald-100 text-emerald-800",
  security:      "bg-rose-100 text-rose-800",
  reliability:   "bg-slate-100 text-slate-700",
  ml:            "bg-violet-100 text-violet-800",
  python:        "bg-yellow-100 text-yellow-800",
  scheduling:    "bg-indigo-100 text-indigo-800",
  memory:        "bg-pink-100 text-pink-800",
  campaigns:     "bg-lime-100 text-lime-800",
};

function tagColor(tag: string) {
  return TAG_COLORS[tag] ?? "bg-muted text-muted-foreground";
}

// ── File name extraction ─────────────────────────────────────────────────────
function fileName(path: string) {
  const segs = getSegments(path);
  return segs[segs.length - 1] ?? path;
}

function isDirectory(entry: FileEntry) {
  return entry.path.endsWith("/");
}

// ── Main component ───────────────────────────────────────────────────────────

export default function FileExplorer() {
  const [query, setQuery] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [showTagFilter, setShowTagFilter] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [hoveredFile, setHoveredFile] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"tree" | "flat">("tree");

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return fileIndex.filter(entry => {
      const matchesQuery = !q ||
        entry.path.toLowerCase().includes(q) ||
        entry.description.toLowerCase().includes(q) ||
        entry.tags.some(t => t.includes(q));
      const matchesTags = activeTags.length === 0 ||
        activeTags.every(t => entry.tags.includes(t));
      return matchesQuery && matchesTags;
    });
  }, [query, activeTags]);

  const grouped = useMemo(() => groupByDir(filtered), [filtered]);
  const sortedDirs = useMemo(() => Array.from(grouped.keys()).sort(), [grouped]);

  const toggleTag = (tag: string) => {
    setActiveTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const toggleDir = (dir: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  };

  const clearAll = () => {
    setQuery("");
    setActiveTags([]);
  };

  const hasFilters = query.trim().length > 0 || activeTags.length > 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-6 pt-16 pb-24">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>

          {/* Header */}
          <div className="flex items-start justify-between gap-4 mb-2">
            <div className="flex items-center gap-3">
              <FolderOpen size={28} className="text-primary" />
              <h1 className="text-4xl font-bold font-serif text-foreground">File Explorer</h1>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <button
                onClick={() => setViewMode("tree")}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === "tree" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
              >
                Tree
              </button>
              <button
                onClick={() => setViewMode("flat")}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === "flat" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
              >
                Flat
              </button>
            </div>
          </div>
          <p className="text-muted-foreground text-lg mb-2">
            {fileIndexStats.total} key source files — look up any file, see what it does, jump to its chapter.
          </p>
          <div className="flex items-center gap-3 text-sm text-muted-foreground mb-8">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-50 border border-green-200 text-green-700 font-medium">
              <BookOpen size={12} /> {fileIndexStats.withChapter} with chapter links
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted text-muted-foreground font-medium">
              {fileIndexStats.total - fileIndexStats.withChapter} description-only
            </span>
            {hasFilters && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium">
                {filtered.length} matching
              </span>
            )}
          </div>

          {/* Search + Filter bar */}
          <div className="flex gap-3 mb-4">
            <div className="relative flex-grow">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                placeholder="Search by filename, description, or tag…"
                value={query}
                onChange={e => setQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-3 rounded-xl border-2 border-border bg-card text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary transition-colors"
              />
              {query && (
                <button onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X size={14} />
                </button>
              )}
            </div>
            <button
              onClick={() => setShowTagFilter(v => !v)}
              className={`flex items-center gap-2 px-4 py-3 rounded-xl border-2 font-semibold text-sm transition-all ${showTagFilter || activeTags.length > 0 ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-primary/40"}`}
            >
              <Filter size={15} />
              Tags
              {activeTags.length > 0 && (
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">{activeTags.length}</span>
              )}
            </button>
            {hasFilters && (
              <button onClick={clearAll} className="px-4 py-3 rounded-xl border-2 border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 font-semibold text-sm transition-all">
                Clear
              </button>
            )}
          </div>

          {/* Tag filter panel */}
          <AnimatePresence>
            {showTagFilter && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden mb-5"
              >
                <div className="p-4 rounded-2xl border-2 border-border bg-card flex flex-wrap gap-2">
                  {allTags.map(tag => (
                    <button
                      key={tag}
                      onClick={() => toggleTag(tag)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border-2 transition-all ${
                        activeTags.includes(tag)
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border hover:border-primary/40 " + tagColor(tag)
                      }`}
                    >
                      <Tag size={10} />
                      {tag}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* File listing */}
          {filtered.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">
              <FileCode size={48} className="mx-auto mb-4 opacity-20" />
              <p className="text-lg">No files matched your search</p>
            </div>
          ) : viewMode === "flat" ? (
            /* ── FLAT MODE ─────────────────────────────────────────── */
            <div className="space-y-2">
              {filtered.map((entry, i) => (
                <FileRow key={entry.path} entry={entry} index={i} />
              ))}
            </div>
          ) : (
            /* ── TREE MODE ─────────────────────────────────────────── */
            <div className="space-y-3">
              {sortedDirs.map((dir, di) => {
                const entries = grouped.get(dir) ?? [];
                const isExpanded = expandedDirs.has(dir) || hasFilters;
                return (
                  <motion.div
                    key={dir}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: di * 0.04 }}
                    className="rounded-2xl border-2 border-border overflow-hidden"
                  >
                    {/* Dir header */}
                    <button
                      onClick={() => toggleDir(dir)}
                      className="w-full flex items-center gap-3 px-5 py-4 bg-muted/50 hover:bg-muted transition-colors text-left"
                    >
                      {isExpanded ? (
                        <FolderOpen size={18} className="text-primary flex-shrink-0" />
                      ) : (
                        <Folder size={18} className="text-muted-foreground flex-shrink-0" />
                      )}
                      <span className="font-bold font-mono text-sm text-foreground flex-grow">{dir}/</span>
                      <span className="text-xs text-muted-foreground font-medium mr-2">
                        {entries.length} file{entries.length !== 1 ? "s" : ""}
                      </span>
                      <ChevronRight
                        size={16}
                        className={`text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`}
                      />
                    </button>

                    {/* Dir contents */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="divide-y divide-border"
                        >
                          {entries.map((entry, i) => (
                            <FileRow key={entry.path} entry={entry} index={i} indented />
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
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

// ── File row component ────────────────────────────────────────────────────────

function FileRow({ entry, index, indented = false }: { entry: FileEntry; index: number; indented?: boolean }) {
  const isDir = isDirectory(entry);
  const name = fileName(entry.path.replace(/\/$/, ""));
  const dirPath = entry.path.split("/").slice(0, -1).join("/");

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: Math.min(index * 0.015, 0.4) }}
      className={`flex items-start gap-3 px-5 py-4 hover:bg-primary/5 transition-colors group ${indented ? "pl-8" : ""}`}
    >
      {/* Icon */}
      <div className="flex-shrink-0 mt-0.5">
        {isDir ? (
          <Folder size={16} className="text-amber-500" />
        ) : (
          <FileCode size={16} className="text-muted-foreground group-hover:text-primary transition-colors" />
        )}
      </div>

      {/* Content */}
      <div className="flex-grow min-w-0">
        {/* Path */}
        <div className="flex items-center gap-2 flex-wrap mb-1">
          {indented ? (
            <span className="font-mono text-sm font-bold text-foreground group-hover:text-primary transition-colors">
              {name}
            </span>
          ) : (
            <span className="font-mono text-xs text-foreground">
              <span className="text-muted-foreground">{dirPath ? dirPath + "/" : ""}</span>
              <span className="font-bold group-hover:text-primary transition-colors">{name}{isDir ? "/" : ""}</span>
            </span>
          )}
        </div>

        {/* Description */}
        <p className="text-sm text-muted-foreground leading-relaxed mb-2">{entry.description}</p>

        {/* Tags */}
        <div className="flex flex-wrap gap-1">
          {entry.tags.slice(0, 5).map(tag => (
            <span
              key={tag}
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${tagColor(tag)}`}
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Chapter link */}
      {entry.chapterSlug && (
        <div className="flex-shrink-0 mt-0.5">
          <Link
            href={`/chapter/${entry.chapterSlug}`}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-50 border border-orange-200 text-primary text-xs font-bold hover:bg-orange-100 transition-colors whitespace-nowrap"
          >
            <BookOpen size={11} /> Read
          </Link>
        </div>
      )}
    </motion.div>
  );
}
