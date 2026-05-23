import React, { useState } from "react";
import {
  BookOpen, Plus, Trash2, FileText, Globe, Loader2,
  CheckCircle2, XCircle, Clock, Search, ChevronRight,
  Database, Layers, Sparkles, Upload, Link, X,
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

/* ── Status badges ───────────────────────────────────────────────────────── */

function DocStatusBadge({ status }: { status: string }) {
  if (status === "ready")
    return <Badge className="bg-gray-50 text-gray-700 border-gray-200 text-[10px] gap-1"><CheckCircle2 className="w-2.5 h-2.5" />Ready</Badge>;
  if (status === "processing")
    return <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/30 text-[10px] gap-1"><Loader2 className="w-2.5 h-2.5 animate-spin" />Processing</Badge>;
  if (status === "error")
    return <Badge className="bg-red-500/15 text-red-500 border-red-500/30 text-[10px] gap-1"><XCircle className="w-2.5 h-2.5" />Error</Badge>;
  return <Badge className="bg-gray-50 text-gray-500 border-[#ACADB1] text-[10px] gap-1"><Clock className="w-2.5 h-2.5" />Pending</Badge>;
}

/* ── New KB dialog ────────────────────────────────────────────────────────── */

function NewKbDialog({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: (id: number) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [chunkSize, setChunkSize] = useState("512");
  const [chunkOverlap, setChunkOverlap] = useState("64");
  const create = useCreateKnowledgeBase();

  function submit() {
    if (!name.trim()) return;
    create.mutate(
      { data: { name: name.trim(), description: desc || undefined, chunkSize: parseInt(chunkSize), chunkOverlap: parseInt(chunkOverlap) } },
      {
        onSuccess: (kb) => {
          queryClient.invalidateQueries({ queryKey: getListKnowledgeBasesQueryKey() });
          toast({ title: "Knowledge base created" });
          setName(""); setDesc("");
          onClose();
          onCreated(kb.id);
        },
        onError: () => toast({ title: "Error", description: "Failed to create KB", variant: "destructive" }),
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="bg-white border-gray-200 text-gray-700 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-gray-800 text-sm">New Knowledge Base</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-gray-500 text-xs">Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Product FAQ" className="mt-1 bg-gray-50 border-gray-200 text-gray-700" />
          </div>
          <div>
            <Label className="text-gray-500 text-xs">Description (optional)</Label>
            <Input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Company knowledge for support agents" className="mt-1 bg-gray-50 border-gray-200 text-gray-700" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-gray-500 text-xs">Chunk size (tokens)</Label>
              <Select value={chunkSize} onValueChange={setChunkSize}>
                <SelectTrigger className="mt-1 h-8 text-xs bg-gray-50 border-gray-200 text-gray-700"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-white border-gray-200">
                  {["256", "512", "1024"].map(v => <SelectItem key={v} value={v} className="text-gray-700 text-xs">{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-gray-500 text-xs">Overlap (tokens)</Label>
              <Select value={chunkOverlap} onValueChange={setChunkOverlap}>
                <SelectTrigger className="mt-1 h-8 text-xs bg-gray-50 border-gray-200 text-gray-700"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-white border-gray-200">
                  {["32", "64", "128"].map(v => <SelectItem key={v} value={v} className="text-gray-700 text-xs">{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-[10px] text-gray-400">Embedding model: <span className="text-gray-500">text-embedding-3-small</span> · Uses your OpenAI provider key</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} className="text-gray-500">Cancel</Button>
          <Button size="sm" onClick={submit} disabled={!name.trim() || create.isPending} className="bg-gray-800 hover:bg-black/90 text-gray-900 text-xs">
            {create.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Add document form ────────────────────────────────────────────────────── */

function AddDocumentForm({ kbId, onDone }: { kbId: number; onDone: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [sourceType, setSourceType] = useState<"text" | "url">("text");
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const add = useAddKbDocument();

  function submit() {
    if (!name.trim()) return;
    if (sourceType === "text" && !content.trim()) return;
    if (sourceType === "url" && !sourceUrl.trim()) return;

    add.mutate(
      {
        id: kbId,
        data: {
          name: name.trim(),
          sourceType,
          content: sourceType === "text" ? content : undefined,
          sourceUrl: sourceType === "url" ? sourceUrl.trim() : undefined,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetKnowledgeBaseQueryKey(kbId) });
          queryClient.invalidateQueries({ queryKey: getListKnowledgeBasesQueryKey() });
          toast({ title: "Document added", description: "Ingestion started in background" });
          setName(""); setContent(""); setSourceUrl("");
          onDone();
        },
        onError: () => toast({ title: "Error", description: "Failed to add document", variant: "destructive" }),
      }
    );
  }

  return (
    <div className="bg-gray-50 border border-gray-200/60 rounded-xl p-4 space-y-3">
      <p className="text-xs font-semibold text-gray-700 flex items-center gap-1.5"><Upload className="w-3.5 h-3.5 text-gray-700" />Add Document</p>

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setSourceType("text")}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-colors ${sourceType === "text" ? "border-[#ACADB1] bg-gray-50 text-gray-700" : "border-gray-200 text-gray-400 hover:border-[#ACADB1]"}`}
        >
          <FileText className="w-3.5 h-3.5" /> Paste text
        </button>
        <button
          onClick={() => setSourceType("url")}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-colors ${sourceType === "url" ? "border-[#ACADB1] bg-gray-50 text-gray-700" : "border-gray-200 text-gray-400 hover:border-[#ACADB1]"}`}
        >
          <Globe className="w-3.5 h-3.5" /> Fetch URL
        </button>
      </div>

      <div>
        <Input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Document name"
          className="bg-white border-gray-200 text-gray-700 text-xs h-8"
        />
      </div>

      {sourceType === "text" ? (
        <Textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="Paste your document content here…"
          rows={6}
          className="bg-white border-gray-200 text-gray-700 text-xs resize-none"
        />
      ) : (
        <Input
          value={sourceUrl}
          onChange={e => setSourceUrl(e.target.value)}
          placeholder="https://example.com/docs/page"
          className="bg-white border-gray-200 text-gray-700 text-xs h-8"
        />
      )}

      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={onDone} className="text-gray-400 text-xs h-7">Cancel</Button>
        <Button
          size="sm"
          onClick={submit}
          disabled={add.isPending || !name.trim() || (sourceType === "text" ? !content.trim() : !sourceUrl.trim())}
          className="bg-gray-800 hover:bg-black/90 text-gray-900 text-xs h-7"
        >
          {add.isPending ? <><Loader2 className="w-3 h-3 animate-spin mr-1" />Processing…</> : "Add & Ingest"}
        </Button>
      </div>
    </div>
  );
}

/* ── Test query panel ────────────────────────────────────────────────────── */

function QueryPanel({ kbId }: { kbId: number }) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KbChunkResult[] | null>(null);
  const queryKb = useQueryKnowledgeBase();

  function runQuery() {
    if (!query.trim()) return;
    queryKb.mutate(
      { id: kbId, data: { query: query.trim(), topK: 5 } },
      {
        onSuccess: (res) => setResults(res),
        onError: (err: unknown) => {
          const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Query failed";
          toast({ title: "Error", description: msg, variant: "destructive" });
        },
      }
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 flex items-center gap-1.5">
        <Sparkles className="w-3 h-3 text-gray-700" /> Test Retrieval
      </p>
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && runQuery()}
          placeholder="Ask anything…"
          className="bg-white border-gray-200 text-gray-700 text-xs h-8 flex-1"
        />
        <Button
          size="sm"
          onClick={runQuery}
          disabled={queryKb.isPending || !query.trim()}
          className="bg-gray-800 hover:bg-black/90 text-gray-900 text-xs h-8 px-3"
        >
          {queryKb.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
        </Button>
      </div>

      {results !== null && (
        <div className="space-y-2">
          {results.length === 0 ? (
            <p className="text-xs text-gray-400 py-2 text-center">No matching chunks found</p>
          ) : results.map((r, i) => (
            <div key={i} className="bg-white border border-gray-100 rounded-lg p-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold text-gray-700">#{i + 1}</span>
                <span className="text-[10px] text-gray-400 truncate flex-1">{r.documentName} · chunk {r.chunkIndex}</span>
                <span className="text-[10px] font-mono text-gray-400">{(r.score * 1000).toFixed(2)}</span>
              </div>
              <p className="text-xs text-gray-700 leading-relaxed line-clamp-4">{r.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── KB detail panel ──────────────────────────────────────────────────────── */

function KbDetailPanel({ kbId, onClose }: { kbId: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showAddDoc, setShowAddDoc] = useState(false);
  const [polling, setPolling] = useState(false);
  const { data: kb, isLoading, refetch } = useGetKnowledgeBase(kbId, {
    query: { queryKey: getGetKnowledgeBaseQueryKey(kbId), refetchInterval: polling ? 2000 : false },
  });

  // Update polling state based on document statuses
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
        toast({ title: "Document removed" });
      },
    });
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden border-l border-gray-200">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 h-12 border-b border-gray-200 shrink-0">
        {isLoading ? (
          <Skeleton className="h-4 w-40 bg-gray-100" />
        ) : (
          <>
            <BookOpen className="w-4 h-4 text-gray-700 shrink-0" />
            <span className="font-semibold text-sm text-gray-800 truncate">{kb?.name}</span>
            <div className="flex items-center gap-3 ml-auto text-[11px] text-gray-400">
              <span className="flex items-center gap-1"><FileText className="w-3 h-3" />{kb?.documentCount ?? 0} docs</span>
              <span className="flex items-center gap-1"><Layers className="w-3 h-3" />{kb?.chunkCount ?? 0} chunks</span>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-500 ml-2">
              <X className="w-4 h-4" />
            </button>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 h-full divide-x divide-black/[0.06]">
          {/* Left: Documents */}
          <div className="p-5 space-y-4 overflow-y-auto">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Documents</p>
              <Button
                size="sm"
                onClick={() => setShowAddDoc(v => !v)}
                className="h-6 px-2 text-[10px] bg-gray-50 hover:bg-gray-50 text-gray-700 border border-gray-200"
              >
                <Plus className="w-3 h-3 mr-1" />Add
              </Button>
            </div>

            {showAddDoc && (
              <AddDocumentForm kbId={kbId} onDone={() => { setShowAddDoc(false); refetch(); }} />
            )}

            {isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 bg-gray-100 rounded-xl" />)}
              </div>
            ) : kb?.documents?.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-gray-400" />
                </div>
                <p className="text-xs text-gray-400">No documents yet<br /><span className="text-gray-400">Add text or a URL to start building</span></p>
              </div>
            ) : (
              <div className="space-y-2">
                {kb?.documents?.map((doc: KbDocument) => (
                  <div key={doc.id} className="bg-gray-50 border border-gray-100 rounded-xl p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      {doc.sourceType === "url"
                        ? <Globe className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                        : <FileText className="w-3.5 h-3.5 text-gray-500 shrink-0 mt-0.5" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-700 truncate">{doc.name}</p>
                        {doc.sourceUrl && <p className="text-[10px] text-gray-400 truncate">{doc.sourceUrl}</p>}
                        {doc.processingError && <p className="text-[10px] text-red-500 mt-1">{doc.processingError}</p>}
                      </div>
                      <button
                        onClick={() => handleDeleteDoc(doc.id)}
                        className="text-gray-400 hover:text-red-500 transition-colors shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center gap-3">
                      <DocStatusBadge status={doc.status} />
                      {doc.chunkCount != null && (
                        <span className="text-[10px] text-gray-400">{doc.chunkCount} chunks</span>
                      )}
                      {doc.charCount != null && (
                        <span className="text-[10px] text-gray-400">{(doc.charCount / 1000).toFixed(1)}k chars</span>
                      )}
                      <span className="text-[10px] text-gray-400 ml-auto">
                        {format(new Date(doc.createdAt), "MMM d")}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: Query panel */}
          <div className="p-5 space-y-4 overflow-y-auto">
            {(kb?.chunkCount ?? 0) > 0 ? (
              <QueryPanel kbId={kbId} />
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-gray-400" />
                </div>
                <p className="text-xs text-gray-400">Test retrieval available<br /><span className="text-gray-400">once documents are ingested</span></p>
              </div>
            )}
          </div>
        </div>
      </div>
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
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = (kbs ?? []).filter(kb =>
    !search || kb.name.toLowerCase().includes(search.toLowerCase())
  );

  function handleDelete(kb: KnowledgeBase, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete "${kb.name}" and all its documents?`)) return;
    deleteKb.mutate({ id: kb.id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListKnowledgeBasesQueryKey() });
        if (selectedId === kb.id) setSelectedId(null);
        toast({ title: "Knowledge base deleted" });
      },
    });
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* KB list panel */}
      <div className="w-64 shrink-0 flex flex-col border-r border-gray-200 bg-white/40 backdrop-blur-xl">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 h-12 border-b border-gray-200 shrink-0">
          <span className="font-semibold text-sm text-gray-800 flex-1">Knowledge Bases</span>
          <button
            onClick={() => setShowNewDialog(true)}
            className="w-6 h-6 rounded flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-gray-200/50">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full bg-gray-50 border border-gray-100 rounded-lg pl-7 pr-3 py-1.5 text-xs text-gray-700 placeholder:text-gray-400 outline-none focus:border-[#ACADB1]"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto py-1">
          {isLoading ? (
            <div className="space-y-1 px-2 pt-1">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 bg-gray-100 rounded-lg" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center gap-2">
              <Database className="w-8 h-8 text-gray-400" />
              <p className="text-xs text-gray-400">No knowledge bases yet</p>
              <Button size="sm" onClick={() => setShowNewDialog(true)} className="mt-1 h-7 text-xs bg-gray-50 text-gray-700 hover:bg-gray-50 border border-gray-200">
                <Plus className="w-3 h-3 mr-1" />Create one
              </Button>
            </div>
          ) : (
            filtered.map(kb => (
              <div
                key={kb.id}
                onClick={() => setSelectedId(kb.id === selectedId ? null : kb.id)}
                className={`mx-2 my-0.5 px-3 py-2.5 rounded-lg cursor-pointer transition-colors group ${selectedId === kb.id ? "bg-white/10" : "hover:bg-white/5"}`}
              >
                <div className="flex items-start gap-2">
                  <BookOpen className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${selectedId === kb.id ? "text-gray-700" : "text-gray-400"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-700 truncate">{kb.name}</p>
                    {kb.description && <p className="text-[10px] text-gray-400 truncate">{kb.description}</p>}
                    <div className="flex gap-3 mt-1">
                      <span className="text-[10px] text-gray-400">{kb.documentCount} doc{kb.documentCount !== 1 ? "s" : ""}</span>
                      <span className="text-[10px] text-gray-400">{kb.chunkCount} chunks</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {selectedId === kb.id && <ChevronRight className="w-3 h-3 text-gray-400" />}
                    <button
                      onClick={e => handleDelete(kb, e)}
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer info */}
        <div className="px-4 py-3 border-t border-gray-200 shrink-0">
          <p className="text-[10px] text-gray-400 leading-relaxed">
            Attach a KB to an agent to inject retrieved context into every call.
          </p>
        </div>
      </div>

      {/* Detail panel or empty state */}
      {selectedId ? (
        <KbDetailPanel kbId={selectedId} onClose={() => setSelectedId(null)} />
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
          <div className="w-14 h-14 rounded-2xl bg-gray-50 border border-gray-200/40 flex items-center justify-center">
            <BookOpen className="w-7 h-7 text-gray-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Select a knowledge base</p>
            <p className="text-xs text-gray-400 mt-1">or create one to start ingesting documents</p>
          </div>
          <Button size="sm" onClick={() => setShowNewDialog(true)} className="bg-gray-800 hover:bg-black/90 text-gray-900 text-xs">
            <Plus className="w-3.5 h-3.5 mr-1.5" />New Knowledge Base
          </Button>
          <div className="mt-4 grid grid-cols-3 gap-3 max-w-sm">
            {[
              { icon: Upload, label: "Paste text", desc: "Any text content" },
              { icon: Globe, label: "Fetch URL", desc: "Web pages, docs" },
              { icon: Sparkles, label: "Test queries", desc: "Debug retrieval" },
            ].map(({ icon: Icon, label, desc }) => (
              <div key={label} className="bg-gray-50 border border-gray-200/40 rounded-xl p-3 text-center">
                <Icon className="w-4 h-4 text-gray-700 mx-auto mb-1.5" />
                <p className="text-[10px] font-medium text-gray-700">{label}</p>
                <p className="text-[10px] text-gray-400">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <NewKbDialog
        open={showNewDialog}
        onClose={() => setShowNewDialog(false)}
        onCreated={id => setSelectedId(id)}
      />
    </div>
  );
}
