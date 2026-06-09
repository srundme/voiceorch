import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useFamilyStore, PolicyDocument } from "@/lib/family-store";
import {
  ChevronRight, Plus, BookOpen, Trash2, Pencil,
  FileText, Link2, Bot, Database, ChevronDown, ChevronUp,
  CheckCircle2,
} from "lucide-react";

const SOURCE_LABELS: Record<PolicyDocument["sourceType"], string> = {
  text:     "Plain Text",
  pdf_text: "PDF (text)",
  url:      "URL",
  faq:      "FAQ",
};
const SOURCE_STYLES: Record<PolicyDocument["sourceType"], string> = {
  text:     "bg-blue-500/10 text-blue-400 border-blue-500/20",
  pdf_text: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  url:      "bg-purple-500/10 text-purple-400 border-purple-500/20",
  faq:      "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
};

function estimateChunks(content: string): number {
  return Math.max(1, Math.ceil(content.trim().split(/\s+/).length / 120));
}

export default function PolicyKBPage({
  params,
}: {
  params: { companyId: string; policyId: string };
}) {
  const { companies, policies, documents, saveDocuments, isLoaded } = useFamilyStore();
  const { toast } = useToast();

  const company = companies.find(c => c.id === params.companyId);
  const policy  = policies.find(p => p.id === params.policyId);
  const policyDocs = documents.filter(d => d.policyId === params.policyId);

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing]   = useState<PolicyDocument | null>(null);
  const [title, setTitle]       = useState("");
  const [content, setContent]   = useState("");
  const [sourceType, setSourceType] = useState<PolicyDocument["sourceType"]>("text");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteId, setDeleteId]  = useState<string | null>(null);
  const [search, setSearch]     = useState("");

  function openCreate() {
    setEditing(null); setTitle(""); setContent(""); setSourceType("text");
    setShowModal(true);
  }
  function openEdit(doc: PolicyDocument) {
    setEditing(doc); setTitle(doc.title); setContent(doc.content); setSourceType(doc.sourceType);
    setShowModal(true);
  }
  function saveDoc() {
    if (!title.trim() || !content.trim() || !policy || !company) return;
    const chunks = estimateChunks(content);
    if (editing) {
      saveDocuments(documents.map(d =>
        d.id === editing.id
          ? { ...d, title: title.trim(), content: content.trim(), sourceType, chunkCount: chunks, indexed: false, updatedAt: new Date().toISOString() }
          : d
      ));
      toast({ title: "Document updated" });
    } else {
      const doc: PolicyDocument = {
        id: `doc-${Date.now()}`,
        policyId: policy.id,
        policyName: policy.name,
        companyName: company.name,
        title: title.trim(),
        content: content.trim(),
        sourceType,
        chunkCount: chunks,
        indexed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      saveDocuments([...documents, doc]);
      toast({ title: "Document added", description: `${chunks} chunk${chunks !== 1 ? "s" : ""} ready for indexing.` });
    }
    setShowModal(false);
  }
  function markIndexed(id: string) {
    saveDocuments(documents.map(d => d.id === id ? { ...d, indexed: true } : d));
    toast({ title: "Marked as indexed" });
  }
  function deleteDoc(id: string) {
    saveDocuments(documents.filter(d => d.id !== id));
    setDeleteId(null);
    toast({ title: "Document deleted" });
  }

  const filtered = policyDocs.filter(d =>
    d.title.toLowerCase().includes(search.toLowerCase()) ||
    d.content.toLowerCase().includes(search.toLowerCase())
  );

  const totalChunks   = policyDocs.reduce((s, d) => s + d.chunkCount, 0);
  const indexedChunks = policyDocs.filter(d => d.indexed).reduce((s, d) => s + d.chunkCount, 0);
  const allIndexed    = policyDocs.length > 0 && policyDocs.every(d => d.indexed);

  if (!isLoaded) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!company || !policy) {
    return (
      <div className="space-y-4">
        <Link href="/family/companies">
          <Button variant="ghost" size="sm" className="gap-1">Back to Companies</Button>
        </Link>
        <p className="text-muted-foreground">Policy not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        <Link href="/family/companies">
          <button className="hover:text-foreground transition-colors">Companies</button>
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link href={`/family/companies/${company.id}`}>
          <button className="hover:text-foreground transition-colors">{company.name}</button>
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-foreground font-medium">{policy.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div
            className="h-10 w-10 rounded-lg flex items-center justify-center text-white font-bold text-sm shrink-0"
            style={{ backgroundColor: company.logoColor }}
          >
            {company.name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{policy.name}</h1>
            <p className="text-sm text-muted-foreground">{company.name} · {policy.productType} insurance</p>
          </div>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          Add Document
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Documents",    value: policyDocs.length },
          { label: "Total Chunks", value: totalChunks },
          { label: "Indexed",      value: indexedChunks },
          { label: "Status",       value: allIndexed ? "Ready" : policyDocs.length === 0 ? "Empty" : "Pending" },
        ].map(({ label, value }) => (
          <Card key={label}>
            <CardContent className="p-4">
              <p className={`text-2xl font-bold ${label === "Status" && value === "Ready" ? "text-emerald-400" : label === "Status" && value === "Pending" ? "text-amber-400" : ""}`}>
                {value}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* RAG info banner */}
      <div className="flex items-start gap-3 p-4 rounded-xl border border-primary/20 bg-primary/5">
        <Database className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-foreground">Open-source RAG pipeline</p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            Documents added here are chunked and ready for vector indexing. Engineers wire this into the retrieval pipeline
            (LlamaIndex / LangChain / custom). Each chunk is ~120 words. Mark a document as "Indexed" once your
            embedding job has processed it.
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <Input
          placeholder="Search documents…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <span className="text-sm text-muted-foreground ml-auto">{filtered.length} document{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Documents list */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center">
            <BookOpen className="h-8 w-8 text-muted-foreground opacity-30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-3">
              {policyDocs.length === 0
                ? "No documents yet. Add the first document to build the knowledge base."
                : "No documents match your search."}
            </p>
            {policyDocs.length === 0 && (
              <Button size="sm" onClick={openCreate} className="gap-1">
                <Plus className="h-4 w-4" /> Add First Document
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(doc => (
            <Card key={doc.id} className="overflow-hidden">
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/20 transition-colors"
                onClick={() => setExpandedId(expandedId === doc.id ? null : doc.id)}
              >
                <Badge variant="outline" className={`shrink-0 text-xs ${SOURCE_STYLES[doc.sourceType]}`}>
                  {SOURCE_LABELS[doc.sourceType]}
                </Badge>
                <p className="flex-1 text-sm font-medium truncate">{doc.title}</p>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-muted-foreground">{doc.chunkCount} chunks</span>
                  {doc.indexed ? (
                    <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/20 gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Indexed
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-400 border-amber-500/20">
                      Pending
                    </Badge>
                  )}
                  <div className="flex items-center gap-1">
                    {!doc.indexed && (
                      <Button
                        size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1 text-emerald-400 hover:text-emerald-300"
                        onClick={e => { e.stopPropagation(); markIndexed(doc.id); }}
                      >
                        <CheckCircle2 className="h-3 w-3" /> Mark indexed
                      </Button>
                    )}
                    <Button
                      size="sm" variant="ghost" className="h-7 w-7 p-0"
                      onClick={e => { e.stopPropagation(); openEdit(doc); }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      onClick={e => { e.stopPropagation(); setDeleteId(doc.id); }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {expandedId === doc.id ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </div>
              </div>
              {expandedId === doc.id && (
                <div className="px-4 pb-4 border-t border-border/50 bg-muted/10">
                  <pre className="text-xs text-muted-foreground mt-3 leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto">
                    {doc.content}
                  </pre>
                  <p className="text-xs text-muted-foreground/60 mt-2">
                    Added {new Date(doc.createdAt).toLocaleDateString()}
                    {doc.updatedAt !== doc.createdAt && ` · Updated ${new Date(doc.updatedAt).toLocaleDateString()}`}
                  </p>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Add / Edit modal */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Document" : "Add Knowledge Document"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Title <span className="text-destructive">*</span></Label>
              <Input
                placeholder="e.g. Motor Policy — Coverage Details"
                value={title}
                onChange={e => setTitle(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Source Type</Label>
              <Select value={sourceType} onValueChange={v => setSourceType(v as PolicyDocument["sourceType"])}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(SOURCE_LABELS) as [PolicyDocument["sourceType"], string][]).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>
                Content <span className="text-destructive">*</span>
                <span className="text-muted-foreground font-normal ml-2 text-xs">
                  (~{estimateChunks(content)} chunk{estimateChunks(content) !== 1 ? "s" : ""} · ~120 words each)
                </span>
              </Label>
              <Textarea
                placeholder="Paste your policy text, FAQ content, or document content here…"
                value={content}
                onChange={e => setContent(e.target.value)}
                rows={14}
                className="font-mono text-xs resize-y"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={saveDoc} disabled={!title.trim() || !content.trim()}>
              {editing ? "Save Changes" : "Add Document"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm delete */}
      <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Document?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">This will permanently remove the document and its chunks.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteId && deleteDoc(deleteId)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
