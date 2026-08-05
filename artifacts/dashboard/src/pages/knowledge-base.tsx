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
  useListAgents,
  useAttachKnowledgeSourceToAgent,
  getListKnowledgeSourcesQueryKey,
  getGetKnowledgeSourceQueryKey,
  getListAgentsQueryKey,
  customFetch,
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
import { StripePage } from "@/components/stripe-page";
import { EmptyState } from "@/components/empty-state";

/* ── Type constants ─────────────────────────────────────────────────────── */

const TYPE_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  faq: { label: "FAQ", icon: <HelpCircle className="w-4 h-4" />, color: "bg-violet-500/15 text-violet-400 border-violet-500/20" },
  text: { label: "Text", icon: <AlignLeft className="w-4 h-4" />, color: "bg-blue-500/15 text-blue-400 border-blue-500/20" },
  website: { label: "Website", icon: <Globe className="w-4 h-4" />, color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" },
  file: { label: "File", icon: <FileText className="w-4 h-4" />, color: "bg-amber-500/15 text-amber-400 border-amber-500/20" },
};

const STATUS_META: Record<string, { label: string; color: string; spin?: boolean }> = {
  active:     { label: "Ready",        color: "text-emerald-400" },
  ready:      { label: "Ready",        color: "text-emerald-400" },
  partial:    { label: "Needs attention", color: "text-amber-400" },
  validating: { label: "Checking…",    color: "text-amber-400", spin: true },
  processing: { label: "Processing…",  color: "text-amber-400", spin: true },
  crawling:   { label: "Importing…",   color: "text-amber-400", spin: true },
  error:      { label: "Failed",       color: "text-red-400" },
  failed:     { label: "Failed",       color: "text-red-400" },
};

const NON_TERMINAL_STATUSES = new Set(["validating", "processing", "crawling"]);

/** List/detail rows may include enrichments from the API (optional for older clients). */
type KnowledgeSourceView = KnowledgeSource & {
  indexing?: boolean;
  needsAttention?: boolean;
  failedPageCount?: number;
  attachedAgentCount?: number;
  embeddedCount?: number;
};

/* ── Source Card ─────────────────────────────────────────────────────────── */

function SourceCard({
  source,
  onClick,
  onDelete,
}: {
  source: KnowledgeSourceView;
  onClick: () => void;
  onDelete: () => void;
}) {
  const meta = TYPE_META[source.type] ?? TYPE_META["text"]!;
  const st = source.indexing
    ? { label: "Indexing…", color: "text-amber-400", spin: true as const }
    : source.needsAttention
      ? { label: "Needs attention", color: "text-amber-400", spin: false as const }
      : (STATUS_META[source.status] ?? STATUS_META["ready"]!);

  return (
    <div
      onClick={onClick}
      className="group relative bg-card border border-border rounded-xl p-5 cursor-pointer hover:border-primary/40 hover:bg-accent/30 transition-all"
    >
      {/* Type as secondary chip — pack name is the hero */}
      <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-medium border mb-2 ${meta.color}`}>
        {meta.icon}
        {meta.label}
      </div>

      <h3 className="font-semibold text-sm mb-1 truncate pr-6">{source.name}</h3>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className={`flex items-center gap-1 ${st.color}`}>
          {st.spin && <Loader2 className="w-3 h-3 animate-spin" />}
          {st.label}
        </span>
        <span>·</span>
        <span>{source.entryCount} {source.entryCount === 1 ? "piece" : "pieces"}</span>
        {typeof source.attachedAgentCount === "number" && (
          <>
            <span>·</span>
            <span>
              {source.attachedAgentCount === 0
                ? "Not on an agent yet"
                : `${source.attachedAgentCount} agent${source.attachedAgentCount === 1 ? "" : "s"}`}
            </span>
          </>
        )}
        <span>·</span>
        <span>{formatDistanceToNow(new Date(source.createdAt), { addSuffix: true })}</span>
      </div>

      {/* Arrow */}
      <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />

      {/* Delete button */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="absolute top-3 right-8 p-1 rounded text-muted-foreground/0 group-hover:text-muted-foreground/60 hover:!text-red-400 transition-colors"
        title="Delete"
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
  const [step, setStep] = useState<"type" | "details" | "attach">("type");
  const [selectedType, setSelectedType] = useState<SourceType>("faq");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [textContent, setTextContent] = useState("");
  const [textTitle, setTextTitle] = useState("");
  const [faqs, setFaqs] = useState<FaqPair[]>([{ q: "", a: "" }]);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [createdSourceId, setCreatedSourceId] = useState<number | null>(null);
  const [selectedAgentIds, setSelectedAgentIds] = useState<number[]>([]);
  const [attaching, setAttaching] = useState(false);

  const create = useCreateKnowledgeSource();
  const attach = useAttachKnowledgeSourceToAgent();
  const { data: agents, isLoading: agentsLoading } = useListAgents({
    query: { queryKey: getListAgentsQueryKey(), enabled: step === "attach" },
  });

  function reset() {
    setStep("type");
    setName("");
    setUrl("");
    setTextContent("");
    setTextTitle("");
    setFaqs([{ q: "", a: "" }]);
    setFile(null);
    setUploading(false);
    setCreatedSourceId(null);
    setSelectedAgentIds([]);
    setAttaching(false);
  }

  function handleClose() { reset(); onClose(); }

  function goToAttach(sourceId: number) {
    setCreatedSourceId(sourceId);
    setSelectedAgentIds([]);
    setStep("attach");
    void queryClient.invalidateQueries({ queryKey: getListKnowledgeSourcesQueryKey() });
  }

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
      const body = await res.json() as { id?: number };
      if (!body?.id) throw new Error("Upload succeeded but no knowledge id returned");
      toast({ title: "Document uploaded", description: "Next: pick which agents can use it." });
      goToAttach(body.id);
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
      const created = await create.mutateAsync({
        data: {
          name: name.trim(),
          type: selectedType as unknown as KnowledgeSourceInputType,
          url: selectedType === "website" ? url.trim() : undefined,
          entries: selectedType !== "website" ? entries : undefined,
        },
      });
      toast({
        title: "Knowledge pack created",
        description: selectedType === "website"
          ? "Importing pages — you can attach agents now or later."
          : "Next: pick which agents can use it.",
      });
      goToAttach(created.id);
    } catch (err) {
      toast({ title: "Failed to create", description: formatApiError(err), variant: "destructive" });
    }
  }

  async function handleAttachFinish() {
    if (!createdSourceId) { handleClose(); return; }
    if (!selectedAgentIds.length) {
      toast({ title: "Knowledge pack ready", description: "Attach it anytime from an agent’s Knowledge section." });
      handleClose();
      return;
    }
    setAttaching(true);
    let attached = 0;
    let deferred = 0;
    try {
      for (const agentId of selectedAgentIds) {
        try {
          await attach.mutateAsync({ id: createdSourceId, agentId });
          attached += 1;
        } catch (err: unknown) {
          const status = typeof err === "object" && err && "status" in err
            ? Number((err as { status: number }).status)
            : undefined;
          if (status === 409) deferred += 1;
          else throw err;
        }
      }
      await queryClient.invalidateQueries({ queryKey: getListKnowledgeSourcesQueryKey() });
      if (attached > 0) {
        toast({
          title: `Attached to ${attached} agent${attached === 1 ? "" : "s"}`,
          description: deferred > 0
            ? "Some agents will get it after the website finishes importing — attach again from the agent if needed."
            : undefined,
        });
      } else if (deferred > 0) {
        toast({
          title: "Still importing",
          description: "Attach again from the agent once this pack shows Ready.",
        });
      }
      handleClose();
    } catch (err) {
      toast({ title: "Couldn’t attach", description: formatApiError(err), variant: "destructive" });
    } finally {
      setAttaching(false);
    }
  }

  const typeChoices: Array<{ type: SourceType; label: string; desc: string; icon: React.ReactNode }> = [
    { type: "faq", label: "Q&A", desc: "Common questions and answers", icon: <HelpCircle className="w-5 h-5 text-violet-400" /> },
    { type: "text", label: "Paste text", desc: "Paste facts or policies", icon: <AlignLeft className="w-5 h-5 text-blue-400" /> },
    { type: "file", label: "Upload a file", desc: "PDF, Word, text, CSV, or Markdown", icon: <FileText className="w-5 h-5 text-amber-400" /> },
    { type: "website", label: "Website link", desc: "Import pages from a URL", icon: <Globe className="w-5 h-5 text-emerald-400" /> },
  ];

  const stepTitle =
    step === "type" ? "Add knowledge"
    : step === "attach" ? "Attach to agents"
    : `Add ${TYPE_META[selectedType]?.label?.toLowerCase() ?? "content"}`;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{stepTitle}</DialogTitle>
          {step === "attach" && (
            <p className="text-xs text-muted-foreground pt-1">
              Optional — choose which agents should use “{name.trim() || "this pack"}”.
            </p>
          )}
        </DialogHeader>

        {step === "type" ? (
          <div className="space-y-2 py-2">
            <p className="text-xs text-muted-foreground mb-2">1. Name your pack → 2. Add content → 3. Attach to an agent</p>
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
        ) : step === "attach" ? (
          <div className="space-y-3 py-2 max-h-72 overflow-y-auto">
            {agentsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading agents…
              </div>
            ) : !agents?.length ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No agents yet. Create an agent, then attach this pack from Knowledge on the agent.
              </p>
            ) : (
              agents.map((agent) => {
                const checked = selectedAgentIds.includes(agent.id);
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => {
                      setSelectedAgentIds((ids) =>
                        checked ? ids.filter((id) => id !== agent.id) : [...ids, agent.id],
                      );
                    }}
                    className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all ${
                      checked ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/30"
                    }`}
                  >
                    <div className={`flex h-4 w-4 items-center justify-center rounded border shrink-0 ${
                      checked ? "bg-primary border-primary text-primary-foreground" : "border-border"
                    }`}>
                      {checked && <CheckCircle2 className="h-3 w-3" />}
                    </div>
                    <span className="text-sm font-medium truncate">{agent.name}</span>
                  </button>
                );
              })
            )}
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Pack name</label>
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
          {step === "attach" && (
            <Button variant="outline" onClick={handleClose} disabled={attaching}>Skip for now</Button>
          )}
          {step === "details" && (
            <Button onClick={handleSubmit} disabled={create.isPending || uploading}>
              {(create.isPending || uploading) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {selectedType === "website" ? "Continue" : selectedType === "file" ? "Upload & continue" : "Continue"}
            </Button>
          )}
          {step === "attach" && (
            <Button onClick={handleAttachFinish} disabled={attaching}>
              {attaching && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {selectedAgentIds.length ? `Attach to ${selectedAgentIds.length}` : "Done"}
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

  const data = search.data as (typeof search.data & { mode?: string; sameAsLiveCalls?: boolean }) | undefined;

  return (
    <div className="border border-border rounded-xl p-5 bg-card space-y-4">
      <div className="flex items-center gap-2">
        <FlaskConical className="w-4 h-4 text-primary" />
        <div>
          <h3 className="font-semibold text-sm">Test search</h3>
          <p className="text-[11px] text-muted-foreground">Uses the same search as live calls</p>
        </div>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Ask what a caller might ask…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
          className="flex-1"
        />
        <Button onClick={handleSearch} disabled={search.isPending || !query.trim()}>
          {search.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
        </Button>
      </div>

      {data && (
        <div className="space-y-4">
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Brain className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-medium text-primary">
                What the agent would see
                {data.mode ? <span className="text-muted-foreground font-normal"> · {data.mode}</span> : null}
              </span>
            </div>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              {data.answer || "No matching knowledge for this question."}
            </p>
          </div>

          {data.matchedEntries.length > 0 ? (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Matched pieces ({data.matchedEntries.length})
              </p>
              <div className="space-y-2">
                {data.matchedEntries.map((m, i) => (
                  <div key={m.entry.id} className="bg-muted/50 rounded-lg p-3 text-sm border border-border">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-muted-foreground">
                        {m.entry.title ?? `Piece ${i + 1}`}
                      </span>
                      <span className="text-xs text-muted-foreground/60">
                        Rank {(m.rank * 100).toFixed(0)}
                      </span>
                    </div>
                    <p className="text-muted-foreground text-xs leading-relaxed line-clamp-3">{m.entry.content}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <XCircle className="w-4 h-4 text-amber-400" />
              No matching pieces. Try different wording.
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
  const [retrying, setRetrying] = useState(false);

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

  const source = data as KnowledgeSourceDetail & KnowledgeSourceView;
  const meta = TYPE_META[source.type] ?? TYPE_META["text"]!;
  const st = source.indexing
    ? { label: "Indexing…", color: "text-amber-400", spin: true as const }
    : source.needsAttention
      ? { label: "Needs attention", color: "text-amber-400", spin: false as const }
      : (STATUS_META[source.status] ?? STATUS_META["ready"]!);

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
              <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border ${meta.color}`}>
                {meta.icon}
                {meta.label}
              </span>
            </div>
            <p className={`text-xs flex items-center gap-1 ${st.color}`}>
              {st.spin && <Loader2 className="w-3 h-3 animate-spin" />}
              {st.label} · {source.entryCount} {source.entryCount === 1 ? "piece" : "pieces"}
              {typeof source.attachedAgentCount === "number"
                ? ` · ${source.attachedAgentCount === 0 ? "not on an agent yet" : `${source.attachedAgentCount} agent${source.attachedAgentCount === 1 ? "" : "s"}`}`
                : null}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {source.type === "website" && (source.needsAttention || source.status === "partial") && (
            <Button
              size="sm"
              variant="outline"
              disabled={retrying || source.status === "crawling"}
              onClick={async () => {
                setRetrying(true);
                try {
                  await customFetch(`/api/knowledge-sources/${source.id}/retry-crawl`, { method: "POST" });
                  toast({ title: "Retry started", description: "We’ll re-fetch the pages that failed." });
                  refresh();
                } catch (err) {
                  toast({ title: "Retry failed", description: formatApiError(err), variant: "destructive" });
                } finally {
                  setRetrying(false);
                }
              }}
            >
              {retrying ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              Retry failed pages
            </Button>
          )}
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
            Delete
          </Button>
        </div>
      </div>

      {/* Status banners */}
      {source.status === "validating" && (
        <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3 text-sm text-amber-400">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          Checking the website address…
        </div>
      )}
      {source.status === "processing" && (
        <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3 text-sm text-amber-400">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          {source.type === "website" ? "Website fetched — finding pages…" : "Preparing your knowledge…"}
        </div>
      )}
      {source.status === "crawling" && (
        <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3 text-sm text-amber-400">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          Importing website pages. This updates automatically.
        </div>
      )}
      {(source.needsAttention || source.status === "partial") && source.status !== "crawling" && (
        <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3 text-sm text-amber-400">
          <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Needs attention</p>
            <p className="text-amber-400/80 text-xs mt-0.5">
              Some website pages didn’t import
              {source.failedPageCount ? ` (${source.failedPageCount})` : ""}.
              Use Retry failed pages, or add the missing content as text.
            </p>
          </div>
        </div>
      )}
      {(source.status === "error" || source.status === "failed") && (
        <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-400">
          <XCircle className="w-4 h-4 shrink-0" />
          {source.type === "website"
            ? "Website import failed. Check that the URL is public and try again."
            : "Import failed. Delete this pack and try again."}
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

  // Auto-poll every 3 s while importing or embeddings still catching up
  React.useEffect(() => {
    const views = (sources ?? []) as KnowledgeSourceView[];
    const shouldPoll = views.some(
      (s) => NON_TERMINAL_STATUSES.has(s.status) || s.indexing,
    );
    if (!shouldPoll) return;
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
    <StripePage
      title="Knowledge"
      description="Teach your agents facts from text, files, or a website — then attach a pack on the agent."
      actions={
        <Button size="sm" className="h-8 text-xs gap-1.5 rounded-lg" onClick={() => setCreateOpen(true)}>
          <Plus className="w-3.5 h-3.5" />
          Add knowledge
        </Button>
      }
    >
      {/* Source grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      ) : !sources?.length ? (
        <EmptyState
          variant="hero"
          icon={<BookOpen />}
          title="No knowledge yet"
          description="Paste text, upload a document, or import a website — then attach it on an agent so callers get accurate answers."
          action={{
            label: "Add your first pack",
            onClick: () => setCreateOpen(true),
            icon: <Plus className="w-3.5 h-3.5" />,
          }}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(sources as KnowledgeSourceView[]).map((source) => (
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
        <div className="flex flex-wrap gap-5 pt-3 mt-5 border-t border-border/50 text-xs text-muted-foreground/70">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            {sources.length} knowledge {sources.length === 1 ? "pack" : "packs"}
          </span>
          <span className="flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-sky-400" />
            {sources.reduce((s, x) => s + x.entryCount, 0)} total pieces
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
    </StripePage>
  );
}
