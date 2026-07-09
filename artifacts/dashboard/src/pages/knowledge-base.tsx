import React, { useState } from "react";
import {
  BookOpen, Brain, Plus, Trash2, FileText, Globe, MessageSquare,
  ChevronRight, ArrowLeft, FlaskConical, Loader2,
  XCircle, CheckCircle2, Link, AlignLeft, HelpCircle,
  Pencil, X, Search, Upload,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  useListKnowledgeSources,
  useCreateKnowledgeSource,
  useDeleteKnowledgeSource,
  useGetKnowledgeSource,
  useAddKnowledgeEntry,
  useUpdateKnowledgeEntry,
  useDeleteKnowledgeEntry,
  useSearchKnowledge,
  getListKnowledgeSourcesQueryKey,
  getGetKnowledgeSourceQueryKey,
} from "@workspace/api-client-react";
import type {
  KnowledgeSource,
  KnowledgeSourceDetail,
  KnowledgeEntry,
  KnowledgeSourceInputType,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";
import { formatDistanceToNow } from "date-fns";

/* ── Type constants ─────────────────────────────────────────────────────── */

const TYPE_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  faq: { label: "FAQ", icon: <HelpCircle className="w-4 h-4" />, color: "bg-violet-500/15 text-violet-400 border-violet-500/20" },
  text: { label: "Text", icon: <AlignLeft className="w-4 h-4" />, color: "bg-blue-500/15 text-blue-400 border-blue-500/20" },
  website: { label: "Website", icon: <Globe className="w-4 h-4" />, color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" },
  file: { label: "File", icon: <FileText className="w-4 h-4" />, color: "bg-amber-500/15 text-amber-400 border-amber-500/20" },
};

const STATUS_META: Record<string, { label: string; color: string; spin?: boolean }> = {
  active:     { label: "Active",       color: "text-emerald-400" },
  ready:      { label: "Ready",        color: "text-emerald-400" },
  partial:    { label: "Partial",      color: "text-amber-400" },
  validating: { label: "Validating…",  color: "text-amber-400", spin: true },
  processing: { label: "Processing…",  color: "text-amber-400", spin: true },
  crawling:   { label: "Crawling…",    color: "text-amber-400", spin: true },
  error:      { label: "Error",        color: "text-red-400" },
  failed:     { label: "Failed",       color: "text-red-400" },
};

const NON_TERMINAL_STATUSES = new Set(["validating", "processing", "crawling"]);

/* ── Source Card ─────────────────────────────────────────────────────────── */

function SourceCard({
  source,
  onClick,
  onDelete,
}: {
  source: KnowledgeSource;
  onClick: () => void;
  onDelete: () => void;
}) {
  const meta = TYPE_META[source.type] ?? TYPE_META["text"]!;
  const st = STATUS_META[source.status] ?? STATUS_META["active"]!;

  return (
    <div
      onClick={onClick}
      className="group relative bg-card border border-border rounded-xl p-5 cursor-pointer hover:border-primary/40 hover:bg-accent/30 transition-all"
    >
      {/* Type badge */}
      <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium border mb-3 ${meta.color}`}>
        {meta.icon}
        {meta.label}
      </div>

      <h3 className="font-semibold text-sm mb-1 truncate pr-6">{source.name}</h3>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className={`flex items-center gap-1 ${st.color}`}>
          {st.spin && <Loader2 className="w-3 h-3 animate-spin" />}
          {st.label}
        </span>
        <span>·</span>
        <span>{source.entryCount} {source.entryCount === 1 ? "entry" : "entries"}</span>
        <span>·</span>
        <span>{formatDistanceToNow(new Date(source.createdAt), { addSuffix: true })}</span>
      </div>

      {/* Arrow */}
      <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />

      {/* Delete button */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="absolute top-3 right-8 p-1 rounded text-muted-foreground/0 group-hover:text-muted-foreground/60 hover:!text-red-400 transition-colors"
        title="Delete source"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/* ── Create Source Modal ─────────────────────────────────────────────────── */

type SourceType = "faq" | "text" | "website" | "file";

const ACCEPTED_FILE_EXTS = ".pdf,.docx,.txt,.csv,.md,.markdown";

interface CreateSourceModalProps {
  open: boolean;
  onClose: () => void;
}

interface FaqPair { q: string; a: string }

function CreateSourceModal({ open, onClose }: CreateSourceModalProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { getToken } = useAuth();
  const [step, setStep] = useState<"type" | "details">("type");
  const [selectedType, setSelectedType] = useState<SourceType>("faq");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [textContent, setTextContent] = useState("");
  const [textTitle, setTextTitle] = useState("");
  const [faqs, setFaqs] = useState<FaqPair[]>([{ q: "", a: "" }]);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const create = useCreateKnowledgeSource();

  function reset() {
    setStep("type");
    setName("");
    setUrl("");
    setTextContent("");
    setTextTitle("");
    setFaqs([{ q: "", a: "" }]);
    setFile(null);
    setUploading(false);
  }

  function handleClose() { reset(); onClose(); }

  async function handleFileUpload() {
    if (!name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    if (!file) { toast({ title: "Choose a file to upload", variant: "destructive" }); return; }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("name", name.trim());
      form.append("file", file);
      const token = await getToken();
      const res = await fetch("/api/knowledge-sources/upload", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      });
      if (!res.ok) {
        let msg = `Upload failed (${res.status})`;
        try { const body = await res.json(); if (body?.error) msg = body.error; } catch { /* ignore */ }
        throw new Error(msg);
      }
      await queryClient.invalidateQueries({ queryKey: getListKnowledgeSourcesQueryKey() });
      toast({ title: "Document uploaded", description: "Text extracted into knowledge entries." });
      handleClose();
    } catch (err) {
      toast({ title: "Failed to upload", description: formatApiError(err), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit() {
    if (selectedType === "file") { await handleFileUpload(); return; }
    if (!name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }

    let entries: Array<{ title?: string; content: string; keywords?: string }> = [];

    if (selectedType === "faq") {
      entries = faqs
        .filter(f => f.q.trim() && f.a.trim())
        .map(f => ({ title: f.q.trim(), content: f.a.trim(), keywords: f.q.trim() }));
      if (!entries.length) { toast({ title: "Add at least one Q&A pair", variant: "destructive" }); return; }
    } else if (selectedType === "text") {
      if (!textContent.trim()) { toast({ title: "Content is required", variant: "destructive" }); return; }
      entries = [{ title: textTitle.trim() || undefined, content: textContent.trim() }];
    } else if (selectedType === "website") {
      if (!url.trim()) { toast({ title: "URL is required", variant: "destructive" }); return; }
    }

    try {
      await create.mutateAsync({
        data: {
          name: name.trim(),
          type: selectedType as unknown as KnowledgeSourceInputType,
          url: selectedType === "website" ? url.trim() : undefined,
          entries: selectedType !== "website" ? entries : undefined,
        },
      });
      await queryClient.invalidateQueries({ queryKey: getListKnowledgeSourcesQueryKey() });
      toast({ title: "Knowledge source created" });
      handleClose();
    } catch (err) {
      toast({ title: "Failed to create", description: formatApiError(err), variant: "destructive" });
    }
  }

  const typeChoices: Array<{ type: SourceType; label: string; desc: string; icon: React.ReactNode }> = [
    { type: "faq", label: "FAQ", desc: "Question & Answer pairs", icon: <HelpCircle className="w-5 h-5 text-violet-400" /> },
    { type: "text", label: "Paste Text", desc: "Paste any information directly", icon: <AlignLeft className="w-5 h-5 text-blue-400" /> },
    { type: "file", label: "File Upload", desc: "PDF, DOCX, TXT, CSV, or Markdown", icon: <FileText className="w-5 h-5 text-amber-400" /> },
    { type: "website", label: "Website", desc: "Import from a URL", icon: <Globe className="w-5 h-5 text-emerald-400" /> },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {step === "type" ? "Add Knowledge Source" : `New ${TYPE_META[selectedType]?.label} Source`}
          </DialogTitle>
        </DialogHeader>

        {step === "type" ? (
          <div className="space-y-2 py-2">
            {typeChoices.map(({ type, label, desc, icon }) => (
              <button
                key={type}
                onClick={() => { setSelectedType(type); setStep("details"); }}
                className="w-full flex items-center gap-4 p-4 rounded-lg border border-border hover:border-primary/40 hover:bg-accent/30 transition-all text-left"
              >
                <div className="p-2 rounded-lg bg-muted">{icon}</div>
                <div>
                  <div className="font-medium text-sm">{label}</div>
                  <div className="text-xs text-muted-foreground">{desc}</div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground ml-auto" />
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Source Name</label>
              <Input
                placeholder={selectedType === "faq" ? "e.g. Business FAQs" : selectedType === "website" ? "e.g. Product Docs" : "e.g. Company Policy"}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>

            {selectedType === "faq" && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">Q&A Pairs</label>
                <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                  {faqs.map((faq, i) => (
                    <div key={i} className="bg-muted/50 rounded-lg p-3 space-y-2 relative">
                      <Input
                        placeholder="Question"
                        value={faq.q}
                        onChange={(e) => setFaqs(f => f.map((x, j) => j === i ? { ...x, q: e.target.value } : x))}
                        className="text-sm"
                      />
                      <Textarea
                        placeholder="Answer"
                        value={faq.a}
                        onChange={(e) => setFaqs(f => f.map((x, j) => j === i ? { ...x, a: e.target.value } : x))}
                        rows={2}
                        className="text-sm resize-none"
                      />
                      {faqs.length > 1 && (
                        <button
                          onClick={() => setFaqs(f => f.filter((_, j) => j !== i))}
                          className="absolute top-2 right-2 text-muted-foreground hover:text-red-400 transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 w-full"
                  onClick={() => setFaqs(f => [...f, { q: "", a: "" }])}
                >
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                  Add Q&A Pair
                </Button>
              </div>
            )}

            {selectedType === "text" && (
              <>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Title (optional)</label>
                  <Input
                    placeholder="e.g. Return Policy"
                    value={textTitle}
                    onChange={(e) => setTextTitle(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Content</label>
                  <Textarea
                    placeholder="Paste your information here…"
                    value={textContent}
                    onChange={(e) => setTextContent(e.target.value)}
                    rows={6}
                    className="resize-none"
                  />
                </div>
              </>
            )}

            {selectedType === "website" && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Website URL</label>
                <div className="relative">
                  <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="https://example.com/about"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">The page will be crawled and imported automatically.</p>
              </div>
            )}

            {selectedType === "file" && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Document</label>
                <label
                  htmlFor="kb-file-input"
                  className="flex flex-col items-center justify-center gap-2 p-6 rounded-lg border border-dashed border-border hover:border-primary/40 hover:bg-accent/30 transition-all cursor-pointer text-center"
                >
                  {file ? (
                    <>
                      <FileText className="w-6 h-6 text-amber-400" />
                      <span className="text-sm font-medium truncate max-w-full">{file.name}</span>
                      <span className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB · click to replace</span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-6 h-6 text-muted-foreground" />
                      <span className="text-sm font-medium">Choose a file</span>
                      <span className="text-xs text-muted-foreground">PDF, DOCX, TXT, CSV, or Markdown (max 20 MB)</span>
                    </>
                  )}
                </label>
                <input
                  id="kb-file-input"
                  type="file"
                  accept={ACCEPTED_FILE_EXTS}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setFile(f);
                    if (f && !name.trim()) setName(f.name.replace(/\.[^.]+$/, ""));
                  }}
                />
                <p className="text-xs text-muted-foreground mt-1.5">The document text will be extracted into searchable entries.</p>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === "details" && (
            <Button variant="outline" onClick={() => setStep("type")} disabled={uploading}>Back</Button>
          )}
          {step === "type" && (
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
          )}
          {step === "details" && (
            <Button onClick={handleSubmit} disabled={create.isPending || uploading}>
              {(create.isPending || uploading) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {selectedType === "website" ? "Import Website" : selectedType === "file" ? "Upload Document" : "Create Source"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Entry Row ───────────────────────────────────────────────────────────── */

function EntryRow({
  entry,
  sourceId,
  type,
  onDeleted,
}: {
  entry: KnowledgeEntry;
  sourceId: number;
  type: string;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(entry.title ?? "");
  const [content, setContent] = useState(entry.content);
  const [keywords, setKeywords] = useState(entry.keywords ?? "");

  const update = useUpdateKnowledgeEntry();
  const del = useDeleteKnowledgeEntry();

  async function handleSave() {
    try {
      await update.mutateAsync({ id: sourceId, entryId: entry.id, data: { title: title || undefined, content, keywords: keywords || undefined } });
      setEditing(false);
      onDeleted();
    } catch (err) {
      toast({ title: "Failed to update", description: formatApiError(err), variant: "destructive" });
    }
  }

  async function handleDelete() {
    try {
      await del.mutateAsync({ id: sourceId, entryId: entry.id });
      onDeleted();
    } catch (err) {
      toast({ title: "Failed to delete", description: formatApiError(err), variant: "destructive" });
    }
  }

  if (editing) {
    return (
      <div className="bg-muted/50 rounded-lg p-4 space-y-2 border border-border">
        {type === "faq" ? (
          <>
            <Input placeholder="Question" value={title} onChange={(e) => setTitle(e.target.value)} className="text-sm" />
            <Textarea placeholder="Answer" value={content} onChange={(e) => setContent(e.target.value)} rows={3} className="text-sm resize-none" />
          </>
        ) : (
          <>
            <Input placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} className="text-sm" />
            <Textarea placeholder="Content" value={content} onChange={(e) => setContent(e.target.value)} rows={4} className="text-sm resize-none" />
            <Input placeholder="Keywords (optional)" value={keywords} onChange={(e) => setKeywords(e.target.value)} className="text-sm" />
          </>
        )}
        <div className="flex gap-2 pt-1">
          <Button size="sm" onClick={handleSave} disabled={update.isPending}>
            {update.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
            Save
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex items-start gap-3 px-4 py-3 rounded-lg hover:bg-muted/50 transition-colors border border-transparent hover:border-border">
      <div className="flex-1 min-w-0">
        {entry.title && (
          <p className="text-sm font-medium mb-0.5 truncate">{entry.title}</p>
        )}
        <p className="text-sm text-muted-foreground line-clamp-2 whitespace-pre-wrap">{entry.content}</p>
        {entry.keywords && !entry.title && (
          <p className="text-xs text-muted-foreground/60 mt-1 italic">{entry.keywords}</p>
        )}
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button onClick={() => setEditing(true)} className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button onClick={handleDelete} disabled={del.isPending} className="p-1.5 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors">
          {del.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}

/* ── Add Entry Form ──────────────────────────────────────────────────────── */

function AddEntryForm({ sourceId, type, onAdded }: { sourceId: number; type: string; onAdded: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [keywords, setKeywords] = useState("");

  const add = useAddKnowledgeEntry();

  async function handleAdd() {
    if (!content.trim()) { toast({ title: "Content is required", variant: "destructive" }); return; }
    try {
      await add.mutateAsync({ id: sourceId, data: { title: title.trim() || undefined, content: content.trim(), keywords: keywords.trim() || undefined } });
      setTitle(""); setContent(""); setKeywords("");
      setOpen(false);
      onAdded();
    } catch (err) {
      toast({ title: "Failed to add entry", description: formatApiError(err), variant: "destructive" });
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="w-3.5 h-3.5 mr-1.5" />
        {type === "faq" ? "Add Q&A Pair" : "Add Entry"}
      </Button>
    );
  }

  return (
    <div className="bg-muted/50 rounded-lg p-4 space-y-2 border border-border">
      {type === "faq" ? (
        <>
          <Input placeholder="Question" value={title} onChange={(e) => setTitle(e.target.value)} className="text-sm" autoFocus />
          <Textarea placeholder="Answer" value={content} onChange={(e) => setContent(e.target.value)} rows={3} className="text-sm resize-none" />
        </>
      ) : (
        <>
          <Input placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} className="text-sm" autoFocus />
          <Textarea placeholder="Content" value={content} onChange={(e) => setContent(e.target.value)} rows={4} className="text-sm resize-none" />
          <Input placeholder="Keywords (optional, helps with search)" value={keywords} onChange={(e) => setKeywords(e.target.value)} className="text-sm" />
        </>
      )}
      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={handleAdd} disabled={add.isPending}>
          {add.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
          Add
        </Button>
        <Button size="sm" variant="outline" onClick={() => { setOpen(false); setTitle(""); setContent(""); setKeywords(""); }}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* ── Test AI Knowledge Panel ─────────────────────────────────────────────── */

function TestPanel({ sourceId }: { sourceId: number }) {
  const [query, setQuery] = useState("");
  const search = useSearchKnowledge();

  async function handleSearch() {
    if (!query.trim()) return;
    await search.mutateAsync({ id: sourceId, data: { query: query.trim(), limit: 5 } });
  }

  return (
    <div className="border border-border rounded-xl p-5 bg-card space-y-4">
      <div className="flex items-center gap-2">
        <FlaskConical className="w-4 h-4 text-primary" />
        <h3 className="font-semibold text-sm">Test AI Knowledge</h3>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Ask a question…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
          className="flex-1"
        />
        <Button onClick={handleSearch} disabled={search.isPending || !query.trim()}>
          {search.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
        </Button>
      </div>

      {search.data && (
        <div className="space-y-4">
          {/* Generated Answer */}
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Brain className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-medium text-primary">Generated Answer</span>
            </div>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{search.data.answer}</p>
          </div>

          {/* Matched Entries */}
          {search.data.matchedEntries.length > 0 ? (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Knowledge Sources Used ({search.data.matchedEntries.length} matched {search.data.matchedEntries.length === 1 ? "entry" : "entries"})
              </p>
              <div className="space-y-2">
                {search.data.matchedEntries.map((m, i) => (
                  <div key={m.entry.id} className="bg-muted/50 rounded-lg p-3 text-sm border border-border">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-muted-foreground">
                        {m.entry.title ?? `Entry ${i + 1}`}
                      </span>
                      <span className="text-xs text-muted-foreground/60">
                        Score: {(m.rank * 100).toFixed(0)}
                      </span>
                    </div>
                    {m.snippet ? (
                      <p
                        className="text-muted-foreground text-xs leading-relaxed"
                        dangerouslySetInnerHTML={{ __html: m.snippet.replace(/<mark>/g, '<mark class="bg-yellow-400/30 text-foreground not-italic">') }}
                      />
                    ) : (
                      <p className="text-muted-foreground text-xs leading-relaxed line-clamp-3">{m.entry.content}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <XCircle className="w-4 h-4 text-amber-400" />
              No matching entries found. Try different keywords.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Detail View ─────────────────────────────────────────────────────────── */

function DetailView({ sourceId, onBack }: { sourceId: number; onBack: () => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetKnowledgeSource(sourceId);
  const del = useDeleteKnowledgeSource();
  const { toast } = useToast();

  function refresh() {
    queryClient.invalidateQueries({ queryKey: getGetKnowledgeSourceQueryKey(sourceId) });
    queryClient.invalidateQueries({ queryKey: getListKnowledgeSourcesQueryKey() });
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!data) return <div className="text-muted-foreground text-sm">Source not found.</div>;

  const source = data as KnowledgeSourceDetail;
  const meta = TYPE_META[source.type] ?? TYPE_META["text"]!;
  const st = STATUS_META[source.status] ?? STATUS_META["active"]!;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <h2 className="text-lg font-semibold">{source.name}</h2>
              <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border ${meta.color}`}>
                {meta.icon}
                {meta.label}
              </span>
            </div>
            <p className={`text-xs flex items-center gap-1 ${st.color}`}>
              {st.spin && <Loader2 className="w-3 h-3 animate-spin" />}
              {st.label} · {source.entryCount} {source.entryCount === 1 ? "entry" : "entries"}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="text-red-400 border-red-500/20 hover:bg-red-500/10 hover:text-red-400"
          onClick={async () => {
            try {
              await del.mutateAsync({ id: source.id });
              queryClient.invalidateQueries({ queryKey: getListKnowledgeSourcesQueryKey() });
              onBack();
            } catch (err) {
              toast({ title: "Failed to delete", description: formatApiError(err), variant: "destructive" });
            }
          }}
          disabled={del.isPending}
        >
          {del.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 mr-1.5" />}
          Delete Source
        </Button>
      </div>

      {/* Status banners */}
      {source.status === "validating" && (
        <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3 text-sm text-amber-400">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          Checking URL… Validating that the website is reachable and safe to index.
        </div>
      )}
      {source.status === "processing" && (
        <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3 text-sm text-amber-400">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          {source.type === "website" ? "Website fetched — discovering internal pages…" : "Indexing content…"}
        </div>
      )}
      {source.status === "crawling" && (
        <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3 text-sm text-amber-400">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          Crawling website pages. Entries will appear once complete. Refresh to check.
        </div>
      )}
      {(source.status === "error" || source.status === "failed") && (
        <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-400">
          <XCircle className="w-4 h-4 shrink-0" />
          {source.type === "website"
            ? "Website crawl failed. Check that the URL is publicly accessible and try again."
            : "Ingestion failed. Delete this source and try again."}
        </div>
      )}

      {/* Entries */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium">
            {source.type === "faq" ? "Q&A Pairs" : "Entries"}
            <span className="ml-1.5 text-muted-foreground font-normal">({source.entries?.length ?? 0})</span>
          </h3>
          {(["active", "ready", "partial"].includes(source.status)) && (
            <AddEntryForm sourceId={source.id} type={source.type} onAdded={refresh} />
          )}
        </div>

        {source.entries?.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm">
            No entries yet.{" "}
            {(["active", "ready", "partial"].includes(source.status)) && 'Click "Add Entry" to get started.'}
          </div>
        ) : (
          <div className="space-y-1">
            {source.entries?.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                sourceId={source.id}
                type={source.type}
                onDeleted={refresh}
              />
            ))}
          </div>
        )}
      </div>

      {/* Test panel — only show when there are entries */}
      {source.entries && source.entries.length > 0 && (
        <TestPanel sourceId={source.id} />
      )}
    </div>
  );
}

/* ── Main Page ───────────────────────────────────────────────────────────── */

export default function KnowledgeBasePage() {
  const { data: sources, isLoading } = useListKnowledgeSources();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Auto-poll every 3 s while any source is still processing or crawling
  React.useEffect(() => {
    const hasNonTerminal = sources?.some((s) => NON_TERMINAL_STATUSES.has(s.status));
    if (!hasNonTerminal) return;
    const timer = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: getListKnowledgeSourcesQueryKey() });
    }, 3000);
    return () => clearInterval(timer);
  }, [sources, queryClient]);
  const del = useDeleteKnowledgeSource();

  if (selectedId !== null) {
    return (
      <div className="max-w-3xl mx-auto py-8 px-4">
        <DetailView sourceId={selectedId} onBack={() => setSelectedId(null)} />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-8">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2.5">
            <BookOpen className="w-6 h-6 text-primary" />
            Agent Knowledge
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Build reusable knowledge sources from FAQs, text, documents, and websites — then attach them to any agent.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Add Knowledge
        </Button>
      </div>

      {/* Source grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      ) : !sources?.length ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="p-4 rounded-2xl bg-muted mb-4">
            <BookOpen className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="font-semibold mb-1">No knowledge sources yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm mb-6">
            Add FAQs, paste text, upload a document, or import from a website to train your voice agents.
          </p>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Your First Source
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              onClick={() => setSelectedId(source.id)}
              onDelete={() => setDeleting(source.id)}
            />
          ))}
        </div>
      )}

      {/* Info row */}
      {sources && sources.length > 0 && (
        <div className="flex flex-wrap gap-6 pt-2 border-t border-border text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            {sources.length} knowledge {sources.length === 1 ? "source" : "sources"}
          </span>
          <span className="flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-blue-400" />
            {sources.reduce((s, x) => s + x.entryCount, 0)} total entries
          </span>
          <span className="flex items-center gap-1.5 ml-auto text-xs">
            Powered by PostgreSQL Full Text Search
          </span>
        </div>
      )}

      {/* Create modal */}
      <CreateSourceModal open={createOpen} onClose={() => setCreateOpen(false)} />

      {/* Delete confirmation dialog */}
      <Dialog open={deleting !== null} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Knowledge Source?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete the source and all its entries. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={del.isPending}
              onClick={async () => {
                if (!deleting) return;
                try {
                  await del.mutateAsync({ id: deleting });
                  await queryClient.invalidateQueries({ queryKey: getListKnowledgeSourcesQueryKey() });
                  toast({ title: "Source deleted" });
                } catch (err) {
                  toast({ title: "Failed to delete", description: formatApiError(err), variant: "destructive" });
                } finally {
                  setDeleting(null);
                }
              }}
            >
              {del.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
