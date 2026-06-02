import React, { useState } from "react";
import {
  Brain, Plus, Trash2, FileText, Globe, Loader2,
  CheckCircle2, XCircle, Clock, Search, ChevronRight,
  Sparkles, Upload, Link, X, ChevronDown, ChevronUp,
  BookOpen, Settings2, ArrowLeft, FlaskConical,
} from "lucide-react";
import {
  useListKnowledgeBases,
  useCreateKnowledgeBase,
  useDeleteKnowledgeBase,
  useGetKnowledgeBase,
  useAddKbDocument,
  useDeleteKbDocument,
  useQueryKnowledgeBase,
  getListKnowledgeBasesQueryKey,
  getGetKnowledgeBaseQueryKey,
} from "@workspace/api-client-react";
import type { KnowledgeBase, KbDocument, KbChunkResult } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";
import { format, formatDistanceToNow } from "date-fns";

/* ── Status helpers ─────────────────────────────────────────────────────── */

function StatusDot({ status }: { status: string }) {
  if (status === "ready")
    return <span className="flex items-center gap-1 text-[10px] text-emerald-400"><CheckCircle2 className="w-3 h-3" />Ready</span>;
  if (status === "processing")
    return <span className="flex items-center gap-1 text-[10px] text-amber-400"><Loader2 className="w-3 h-3 animate-spin" />Teaching AI…</span>;
  if (status === "error")
    return <span className="flex items-center gap-1 text-[10px] text-red-400"><XCircle className="w-3 h-3" />Error</span>;
  return <span className="flex items-center gap-1 text-[10px] text-muted-foreground"><Clock className="w-3 h-3" />Queued</span>;
}

function SourceTypeIcon({ type }: { type: string }) {
  if (type === "url") return <Globe className="w-4 h-4 text-muted-foreground/60" />;
  return <FileText className="w-4 h-4 text-muted-foreground/60" />;
}

/* ── Add Knowledge Wizard ────────────────────────────────────────────────── */

type WizardStep = "choose-kb" | "create-kb" | "choose-type" | "add-text" | "add-url" | "done";

interface WizardProps {
  open: boolean;
  onClose: () => void;
  existingKbs: KnowledgeBase[];
  onDone: (kbId: number) => void;
}

function AddKnowledgeWizard({ open, onClose, existingKbs, onDone }: WizardProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [step, setStep] = useState<WizardStep>(existingKbs.length ? "choose-kb" : "create-kb");
  const [selectedKbId, setSelectedKbId] = useState<number | null>(null);

  const [kbName, setKbName] = useState("");
  const [kbDesc, setKbDesc] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [chunkSize, setChunkSize] = useState("512");
  const [chunkOverlap, setChunkOverlap] = useState("64");

  const [docName, setDocName] = useState("");
  const [docContent, setDocContent] = useState("");
  const [docUrl, setDocUrl] = useState("");

  const createKb = useCreateKnowledgeBase();
  const addDoc = useAddKbDocument();

  function reset() {
    setStep(existingKbs.length ? "choose-kb" : "create-kb");
    setSelectedKbId(null);
    setKbName(""); setKbDesc("");
    setDocName(""); setDocContent(""); setDocUrl("");
    setShowAdvanced(false);
  }

  function handleClose() { reset(); onClose(); }

  async function handleCreateKb() {
    if (!kbName.trim()) return;
    createKb.mutate(
      { data: { name: kbName.trim(), description: kbDesc || undefined, chunkSize: parseInt(chunkSize), chunkOverlap: parseInt(chunkOverlap) } },
      {
        onSuccess: (kb) => {
          queryClient.invalidateQueries({ queryKey: getListKnowledgeBasesQueryKey() });
          setSelectedKbId(kb.id);
          setStep("choose-type");
        },
        onError: (err: unknown) => toast({ title: "Error", description: formatApiError(err), variant: "destructive" }),
      }
    );
  }

  async function handleAddDoc(type: "text" | "url") {
    if (!selectedKbId) return;
    const name = docName.trim() || (type === "url" ? "Website Content" : "Text Document");
    addDoc.mutate(
      {
        id: selectedKbId,
        data: {
          name,
          sourceType: type,
          content: type === "text" ? docContent : undefined,
          sourceUrl: type === "url" ? docUrl.trim() : undefined,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetKnowledgeBaseQueryKey(selectedKbId) });
          queryClient.invalidateQueries({ queryKey: getListKnowledgeBasesQueryKey() });
          setStep("done");
        },
        onError: (err: unknown) => toast({ title: "Error", description: formatApiError(err), variant: "destructive" }),
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="bg-card border-border text-foreground max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-foreground text-sm flex items-center gap-2">
            <Brain className="w-4 h-4 text-muted-foreground" />
            {step === "done" ? "Knowledge Added!" : "Add Knowledge"}
          </DialogTitle>
        </DialogHeader>

        {/* Step: Choose KB */}
        {step === "choose-kb" && (
          <div className="space-y-4 py-2">
            <p className="text-[12px] text-muted-foreground">Add to an existing knowledge source, or create a new one.</p>
            <div className="space-y-1.5">
              {existingKbs.map(kb => (
                <button key={kb.id} onClick={() => { setSelectedKbId(kb.id); setStep("choose-type"); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border bg-muted hover:bg-accent/40 transition-colors text-left">
                  <BookOpen className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium text-foreground truncate">{kb.name}</p>
                    <p className="text-[10px] text-muted-foreground">{kb.documentCount} source{kb.documentCount !== 1 ? "s" : ""} · {kb.chunkCount} knowledge sections</p>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                </button>
              ))}
            </div>
            <button onClick={() => setStep("create-kb")}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-dashed border-border hover:border-muted-foreground/40 hover:bg-accent/20 transition-colors text-left">
              <Plus className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-[12px] text-muted-foreground">Create new knowledge set</span>
            </button>
          </div>
        )}

        {/* Step: Create KB */}
        {step === "create-kb" && (
          <div className="space-y-4 py-2">
            <p className="text-[12px] text-muted-foreground">Give your AI a name for this knowledge set. Think of it as a topic or category.</p>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider block mb-1">Name</label>
                <Input value={kbName} onChange={e => setKbName(e.target.value)} placeholder="e.g. Product FAQ, Company Policies, Support Guides"
                  className="bg-muted border-border text-foreground" autoFocus
                  onKeyDown={e => e.key === "Enter" && handleCreateKb()} />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider block mb-1">Description (optional)</label>
                <Input value={kbDesc} onChange={e => setKbDesc(e.target.value)} placeholder="What will your AI learn from this?"
                  className="bg-muted border-border text-foreground" />
              </div>
              <button onClick={() => setShowAdvanced(v => !v)}
                className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                <Settings2 className="w-3 h-3" />
                Advanced settings
                {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
              {showAdvanced && (
                <div className="bg-muted/50 border border-border/60 rounded-xl p-3 space-y-3">
                  <p className="text-[10px] text-muted-foreground/50">Technical settings — only change these if you know what you're doing.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-muted-foreground block mb-1">Chunk size (tokens)</label>
                      <Select value={chunkSize} onValueChange={setChunkSize}>
                        <SelectTrigger className="h-7 text-xs bg-muted border-border text-foreground"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-card border-border">
                          {["256", "512", "1024"].map(v => <SelectItem key={v} value={v} className="text-foreground text-xs">{v}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground block mb-1">Overlap (tokens)</label>
                      <Select value={chunkOverlap} onValueChange={setChunkOverlap}>
                        <SelectTrigger className="h-7 text-xs bg-muted border-border text-foreground"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-card border-border">
                          {["32", "64", "128"].map(v => <SelectItem key={v} value={v} className="text-foreground text-xs">{v}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground/40">Embedding model: text-embedding-004 · Powered by Gemini</p>
                </div>
              )}
            </div>
            <div className="flex gap-2 justify-end pt-1">
              {existingKbs.length > 0 && <Button variant="ghost" size="sm" onClick={() => setStep("choose-kb")} className="text-muted-foreground text-xs">Back</Button>}
              <Button size="sm" onClick={handleCreateKb} disabled={!kbName.trim() || createKb.isPending}
                className="bg-primary hover:opacity-90 text-primary-foreground text-xs">
                {createKb.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Continue"}
              </Button>
            </div>
          </div>
        )}

        {/* Step: Choose type */}
        {step === "choose-type" && (
          <div className="space-y-4 py-2">
            <p className="text-[12px] text-muted-foreground">What would you like your AI to learn from?</p>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { type: "text" as const, icon: FileText, label: "Paste Text", desc: "Product info, policies, FAQs, scripts" },
                { type: "url" as const, icon: Globe, label: "Import Website", desc: "Fetch content from a web page or doc" },
              ].map(opt => (
                <button key={opt.type} onClick={() => setStep(opt.type === "text" ? "add-text" : "add-url")}
                  className="flex flex-col items-center gap-2.5 p-4 rounded-xl border border-border bg-muted hover:bg-accent/40 hover:border-muted-foreground/30 transition-colors text-center">
                  <div className="w-9 h-9 rounded-xl bg-elevated border border-border flex items-center justify-center">
                    <opt.icon className="w-4.5 h-4.5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-[12px] font-semibold text-foreground">{opt.label}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{opt.desc}</p>
                  </div>
                </button>
              ))}
            </div>
            <div className="flex justify-start">
              <button onClick={() => setStep("choose-kb")} className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground flex items-center gap-1 transition-colors">
                <ArrowLeft className="w-3 h-3" /> Back
              </button>
            </div>
          </div>
        )}

        {/* Step: Add text */}
        {step === "add-text" && (
          <div className="space-y-4 py-2">
            <p className="text-[12px] text-muted-foreground">Paste any company information your AI should know.</p>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider block mb-1">Title (optional)</label>
                <Input value={docName} onChange={e => setDocName(e.target.value)} placeholder="e.g. Refund Policy, Pricing, Product Overview"
                  className="bg-muted border-border text-foreground text-xs" />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider block mb-1">Content</label>
                <Textarea value={docContent} onChange={e => setDocContent(e.target.value)}
                  placeholder="Paste your content here — company overview, pricing, FAQs, support policies, product details…"
                  rows={7} className="bg-muted border-border text-foreground text-xs resize-none" />
              </div>
            </div>
            <div className="flex gap-2 justify-between pt-1">
              <button onClick={() => setStep("choose-type")} className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground flex items-center gap-1 transition-colors">
                <ArrowLeft className="w-3 h-3" /> Back
              </button>
              <Button size="sm" onClick={() => handleAddDoc("text")} disabled={addDoc.isPending || !docContent.trim()}
                className="bg-primary hover:opacity-90 text-primary-foreground text-xs">
                {addDoc.isPending ? <><Loader2 className="w-3 h-3 animate-spin mr-1" />Teaching AI…</> : "Teach AI"}
              </Button>
            </div>
          </div>
        )}

        {/* Step: Add URL */}
        {step === "add-url" && (
          <div className="space-y-4 py-2">
            <p className="text-[12px] text-muted-foreground">Your AI will read and learn from this web page.</p>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider block mb-1">Title (optional)</label>
                <Input value={docName} onChange={e => setDocName(e.target.value)} placeholder="e.g. Company Website, Docs"
                  className="bg-muted border-border text-foreground text-xs" />
              </div>
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider block mb-1">Website URL</label>
                <div className="relative">
                  <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
                  <Input value={docUrl} onChange={e => setDocUrl(e.target.value)} placeholder="https://yourwebsite.com/about"
                    className="bg-muted border-border text-foreground text-xs pl-8" />
                </div>
              </div>
              <div className="bg-muted/60 border border-border/60 rounded-xl p-3 space-y-1.5">
                <p className="text-[10px] font-medium text-muted-foreground">What happens next:</p>
                {["Reading the page", "Extracting information", "Organizing knowledge", "Making it searchable for your AI"].map((step, i) => (
                  <p key={i} className="text-[10px] text-muted-foreground/60 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/20 shrink-0" />{step}
                  </p>
                ))}
              </div>
            </div>
            <div className="flex gap-2 justify-between pt-1">
              <button onClick={() => setStep("choose-type")} className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground flex items-center gap-1 transition-colors">
                <ArrowLeft className="w-3 h-3" /> Back
              </button>
              <Button size="sm" onClick={() => handleAddDoc("url")} disabled={addDoc.isPending || !docUrl.trim()}
                className="bg-primary hover:opacity-90 text-primary-foreground text-xs">
                {addDoc.isPending ? <><Loader2 className="w-3 h-3 animate-spin mr-1" />Teaching AI…</> : "Teach AI"}
              </Button>
            </div>
          </div>
        )}

        {/* Step: Done */}
        {step === "done" && (
          <div className="space-y-4 py-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-7 h-7 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Your AI is learning!</p>
              <p className="text-[12px] text-muted-foreground mt-1">The information is being processed. Once ready, your AI will use it to answer calls accurately.</p>
            </div>
            <div className="flex gap-2 justify-center">
              <Button variant="ghost" size="sm" onClick={handleClose} className="text-muted-foreground text-xs">Close</Button>
              <Button size="sm" onClick={() => { reset(); }} className="bg-muted border border-border text-foreground text-xs hover:bg-accent">
                <Plus className="w-3 h-3 mr-1" />Add More
              </Button>
              {selectedKbId && (
                <Button size="sm" onClick={() => { onDone(selectedKbId); handleClose(); }}
                  className="bg-primary hover:opacity-90 text-primary-foreground text-xs">
                  View Sources
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Test AI Knowledge panel ─────────────────────────────────────────────── */

function TestKnowledgePanel({ kbId, kbName }: { kbId: number; kbName: string }) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KbChunkResult[] | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const queryKb = useQueryKnowledgeBase();

  function runQuery() {
    if (!query.trim()) return;
    queryKb.mutate(
      { id: kbId, data: { query: query.trim(), topK: 5 } },
      {
        onSuccess: (res) => setResults(res),
        onError: (err: unknown) => toast({ title: "Error", description: formatApiError(err), variant: "destructive" }),
      }
    );
  }

  const topResult = results?.[0];
  const hasResults = results !== null && results.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <FlaskConical className="w-4 h-4 text-muted-foreground" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">Test AI Knowledge</span>
      </div>
      <p className="text-[12px] text-muted-foreground">Ask a question your AI might receive on a call. See if it knows the answer.</p>

      <div className="flex gap-2">
        <Input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && runQuery()}
          placeholder="e.g. What is your refund policy?"
          className="bg-muted border-border text-foreground text-xs h-9 flex-1" autoFocus />
        <Button size="sm" onClick={runQuery} disabled={queryKb.isPending || !query.trim()}
          className="bg-primary hover:opacity-90 text-primary-foreground text-xs h-9 px-4">
          {queryKb.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Test"}
        </Button>
      </div>

      {results !== null && (
        results.length === 0 ? (
          <div className="bg-muted border border-border/60 rounded-xl p-4 text-center space-y-2">
            <p className="text-xs font-medium text-foreground">No answer found</p>
            <p className="text-[11px] text-muted-foreground">Your AI doesn't have information about this topic yet. Add more knowledge to improve coverage.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Primary answer card */}
            {topResult && (
              <div className="bg-muted border border-border rounded-xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Best Match</p>
                  <span className="text-[10px] text-muted-foreground shrink-0">{topResult.documentName}</span>
                </div>
                <p className="text-[13px] text-foreground leading-relaxed">{topResult.content}</p>
                <div className="flex items-center gap-3 pt-1 border-t border-border/50">
                  <span className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    Found in {kbName}
                  </span>
                  <button onClick={() => setShowAdvanced(v => !v)}
                    className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground flex items-center gap-1 ml-auto transition-colors">
                    <Settings2 className="w-3 h-3" />
                    {showAdvanced ? "Hide" : "Show"} technical details
                  </button>
                </div>
              </div>
            )}

            {/* Other matches summary */}
            {hasResults && results.length > 1 && (
              <p className="text-[11px] text-muted-foreground text-center">
                +{results.length - 1} more matching section{results.length - 1 !== 1 ? "s" : ""} found
              </p>
            )}

            {/* Advanced: raw chunks */}
            {showAdvanced && (
              <div className="space-y-2 bg-muted/40 border border-border/40 rounded-xl p-3">
                <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Technical Details · Retrieved Chunks</p>
                {results.map((r, i) => (
                  <div key={i} className="bg-card border border-border/60 rounded-lg p-2.5 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold text-foreground">#{i + 1}</span>
                      <span className="text-[10px] text-muted-foreground truncate flex-1">{r.documentName} · chunk {r.chunkIndex}</span>
                      <span className="text-[10px] font-mono text-muted-foreground/50">score {(r.score * 1000).toFixed(1)}</span>
                    </div>
                    <p className="text-[11px] text-foreground/80 leading-relaxed line-clamp-3">{r.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}

/* ── Knowledge Source detail ──────────────────────────────────────────────── */

function KnowledgeDetail({ kbId, onBack }: { kbId: number; onBack: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showAddWizard, setShowAddWizard] = useState(false);
  const [polling, setPolling] = useState(false);
  const [activeTab, setActiveTab] = useState<"sources" | "test">("sources");
  const { data: kb, isLoading, refetch } = useGetKnowledgeBase(kbId, {
    query: { queryKey: getGetKnowledgeBaseQueryKey(kbId), refetchInterval: polling ? 2000 : false },
  });

  React.useEffect(() => {
    const docs = kb?.documents ?? [];
    const hasInProgress = docs.some((d: KbDocument) => d.status === "pending" || d.status === "processing");
    setPolling(hasInProgress);
  }, [kb?.documents]);

  const deleteDoc = useDeleteKbDocument();

  function handleDeleteDoc(docId: number) {
    deleteDoc.mutate({ id: kbId, docId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetKnowledgeBaseQueryKey(kbId) });
        queryClient.invalidateQueries({ queryKey: getListKnowledgeBasesQueryKey() });
        toast({ title: "Source removed" });
      },
    });
  }

  const docList = kb?.documents ?? [];
  const readyDocs = docList.filter((d: KbDocument) => d.status === "ready").length;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 pt-5 pb-4 border-b border-border">
        <button onClick={onBack} className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground mb-3 transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> All Knowledge
        </button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-foreground">{kb?.name ?? "…"}</h1>
            {kb?.description && <p className="text-[12px] text-muted-foreground mt-0.5">{kb.description}</p>}
          </div>
          <Button size="sm" onClick={() => setShowAddWizard(true)}
            className="bg-primary hover:opacity-90 text-primary-foreground text-xs h-8 shrink-0">
            <Plus className="w-3.5 h-3.5 mr-1" />Add Knowledge
          </Button>
        </div>

        {/* Stat pills */}
        <div className="flex gap-3 mt-3">
          {[
            { label: "Sources", value: docList.length },
            { label: "Ready", value: readyDocs },
            { label: "Knowledge Sections", value: kb?.chunkCount ?? 0 },
          ].map(s => (
            <div key={s.label} className="flex items-center gap-1.5 px-2.5 py-1 bg-muted border border-border/60 rounded-lg">
              <span className="text-[12px] font-bold text-foreground tabular-nums">{s.value}</span>
              <span className="text-[10px] text-muted-foreground">{s.label}</span>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4">
          {(["sources", "test"] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${activeTab === tab ? "bg-muted text-foreground border border-border" : "text-muted-foreground hover:text-foreground"}`}>
              {tab === "sources" ? "Knowledge Sources" : "Test AI"}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === "sources" && (
          <div className="max-w-2xl space-y-3">
            {isLoading ? (
              [1, 2, 3].map(i => <Skeleton key={i} className="h-20 bg-muted rounded-2xl" />)
            ) : docList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-muted border border-border/40 flex items-center justify-center">
                  <Brain className="w-7 h-7 text-muted-foreground/40" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">No sources added yet</p>
                  <p className="text-[12px] text-muted-foreground/60 mt-1">Add text or a website to start teaching your AI.</p>
                </div>
                <Button size="sm" onClick={() => setShowAddWizard(true)} className="bg-primary hover:opacity-90 text-primary-foreground text-xs">
                  <Plus className="w-3.5 h-3.5 mr-1" />Add First Source
                </Button>
              </div>
            ) : docList.map((doc: KbDocument) => (
              <div key={doc.id} className="bg-card border border-border rounded-2xl p-4 group">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-muted border border-border/60 flex items-center justify-center shrink-0 mt-0.5">
                    <SourceTypeIcon type={doc.sourceType} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[13px] font-medium text-foreground">{doc.name}</p>
                      <button onClick={() => handleDeleteDoc(doc.id)}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-all shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {doc.sourceUrl && <p className="text-[10px] text-muted-foreground truncate mt-0.5">{doc.sourceUrl}</p>}
                    {doc.processingError && <p className="text-[10px] text-red-400 mt-1">{doc.processingError}</p>}
                    <div className="flex items-center gap-3 mt-2">
                      <StatusDot status={doc.status} />
                      {doc.chunkCount != null && doc.status === "ready" && (
                        <span className="text-[10px] text-muted-foreground/60">{doc.chunkCount} knowledge sections</span>
                      )}
                      <span className="text-[10px] text-muted-foreground/40 ml-auto">
                        {doc.sourceType === "url" ? "Website" : "Text"} · {formatDistanceToNow(new Date(doc.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === "test" && (
          <div className="max-w-xl">
            {(kb?.chunkCount ?? 0) === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-muted border border-border/40 flex items-center justify-center">
                  <FlaskConical className="w-7 h-7 text-muted-foreground/40" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Nothing to test yet</p>
                  <p className="text-[12px] text-muted-foreground/60 mt-1">Add at least one knowledge source first, then test how your AI responds.</p>
                </div>
              </div>
            ) : (
              <TestKnowledgePanel kbId={kbId} kbName={kb?.name ?? "this set"} />
            )}
          </div>
        )}
      </div>

      {showAddWizard && (
        <AddKnowledgeWizard
          open={showAddWizard}
          onClose={() => { setShowAddWizard(false); refetch(); }}
          existingKbs={[]}
          onDone={() => setShowAddWizard(false)}
        />
      )}
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────────────────────── */

export default function KnowledgeBasePage() {
  const { data: kbs, isLoading } = useListKnowledgeBases();
  const deleteKb = useDeleteKnowledgeBase();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [search, setSearch] = useState("");

  const allKbs = kbs ?? [];
  const filtered = allKbs.filter(kb => !search || kb.name.toLowerCase().includes(search.toLowerCase()));

  const totalDocs = allKbs.reduce((s, kb) => s + (kb.documentCount ?? 0), 0);
  const totalSections = allKbs.reduce((s, kb) => s + (kb.chunkCount ?? 0), 0);

  function handleDelete(kb: KnowledgeBase, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Remove "${kb.name}" and all its sources? This cannot be undone.`)) return;
    deleteKb.mutate({ id: kb.id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListKnowledgeBasesQueryKey() });
        if (selectedId === kb.id) setSelectedId(null);
        toast({ title: "Knowledge set removed" });
      },
    });
  }

  if (selectedId) {
    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-background">
        <KnowledgeDetail kbId={selectedId} onBack={() => setSelectedId(null)} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-background">
      {/* Page header */}
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-border">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
              <Brain className="w-5 h-5 text-muted-foreground/60" />
              AI Knowledge
            </h1>
            <p className="text-[12px] text-muted-foreground mt-0.5">Teach your AI agents using documents, websites, and company information.</p>
          </div>
          {allKbs.length > 0 && (
            <Button size="sm" onClick={() => setShowWizard(true)}
              className="bg-primary hover:opacity-90 text-primary-foreground text-xs h-8 shrink-0">
              <Plus className="w-3.5 h-3.5 mr-1.5" />Add Knowledge
            </Button>
          )}
        </div>

        {/* Stats row */}
        {allKbs.length > 0 && (
          <div className="flex gap-3 mt-4">
            {[
              { label: "Knowledge Sets", value: allKbs.length },
              { label: "Total Sources", value: totalDocs },
              { label: "Knowledge Sections", value: totalSections },
            ].map(s => (
              <div key={s.label} className="flex items-center gap-2 px-3 py-2 bg-muted border border-border/60 rounded-xl">
                <span className="text-[15px] font-bold text-foreground tabular-nums">{s.value}</span>
                <span className="text-[10px] text-muted-foreground">{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-4xl">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-36 bg-muted rounded-2xl" />)}
          </div>
        ) : allKbs.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-24 text-center gap-6 max-w-lg mx-auto">
            <div className="w-20 h-20 rounded-3xl bg-muted border border-border/40 flex items-center justify-center">
              <Brain className="w-10 h-10 text-muted-foreground/30" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Teach Your AI Everything It Needs To Know</h2>
              <p className="text-[13px] text-muted-foreground mt-2 leading-relaxed">
                Upload documents, import websites, or paste text so your AI can answer customer questions accurately — without you needing to be on every call.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 w-full">
              {[
                { icon: FileText, label: "Paste Text", desc: "Policies, pricing, FAQs" },
                { icon: Globe, label: "Import Website", desc: "Fetch from a URL" },
              ].map(opt => (
                <button key={opt.label} onClick={() => setShowWizard(true)}
                  className="flex flex-col items-center gap-2 p-4 rounded-2xl border border-border bg-muted hover:bg-accent/40 hover:border-muted-foreground/30 transition-colors text-center">
                  <div className="w-9 h-9 rounded-xl bg-elevated border border-border flex items-center justify-center">
                    <opt.icon className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-[12px] font-semibold text-foreground">{opt.label}</p>
                    <p className="text-[10px] text-muted-foreground">{opt.desc}</p>
                  </div>
                </button>
              ))}
            </div>
            <Button size="sm" onClick={() => setShowWizard(true)} className="bg-primary hover:opacity-90 text-primary-foreground text-sm h-9 px-5">
              <Plus className="w-4 h-4 mr-1.5" />Add First Knowledge Set
            </Button>
          </div>
        ) : (
          /* Knowledge set grid */
          <div className="space-y-4 max-w-4xl">
            {/* Search */}
            <div className="relative max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
                className="w-full bg-muted border border-border rounded-xl pl-8 pr-3 py-2 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-muted-foreground/40 transition-colors" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map(kb => {
                const readyCount = kb.documentCount ?? 0;
                const hasContent = (kb.chunkCount ?? 0) > 0;
                return (
                  <div key={kb.id}
                    onClick={() => setSelectedId(kb.id)}
                    className="group bg-card border border-border rounded-2xl p-5 cursor-pointer hover:bg-accent/20 hover:border-muted-foreground/20 transition-all relative">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="w-9 h-9 rounded-xl bg-muted border border-border/60 flex items-center justify-center shrink-0">
                        <Brain className="w-4.5 h-4.5 text-muted-foreground/60" />
                      </div>
                      <button
                        onClick={e => handleDelete(kb, e)}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-all p-1 rounded-md hover:bg-muted">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <h3 className="text-[14px] font-semibold text-foreground">{kb.name}</h3>
                    {kb.description && <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{kb.description}</p>}
                    <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border/50">
                      <span className="text-[10px] text-muted-foreground">{readyCount} source{readyCount !== 1 ? "s" : ""}</span>
                      <span className="text-[10px] text-muted-foreground">{kb.chunkCount ?? 0} sections</span>
                      {hasContent ? (
                        <span className="ml-auto flex items-center gap-1 text-[10px] text-emerald-400">
                          <CheckCircle2 className="w-3 h-3" />Ready
                        </span>
                      ) : (
                        <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground/50">
                          <Clock className="w-3 h-3" />Empty
                        </span>
                      )}
                    </div>
                    <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </div>
                );
              })}

              {/* Add new card */}
              <button onClick={() => setShowWizard(true)}
                className="flex flex-col items-center justify-center gap-2 p-5 rounded-2xl border border-dashed border-border hover:border-muted-foreground/40 hover:bg-accent/10 transition-all min-h-[140px] text-center">
                <Plus className="w-6 h-6 text-muted-foreground/40" />
                <p className="text-[12px] text-muted-foreground/60">New Knowledge Set</p>
              </button>
            </div>
          </div>
        )}
      </div>

      <AddKnowledgeWizard
        open={showWizard}
        onClose={() => setShowWizard(false)}
        existingKbs={allKbs}
        onDone={id => { setSelectedId(id); setShowWizard(false); }}
      />
    </div>
  );
}
