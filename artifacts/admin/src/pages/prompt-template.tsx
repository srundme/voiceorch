import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, BASE, formatAdminError } from "@/lib/api";
import { NoActiveTemplateBanner } from "@/components/no-active-template-banner";
import {
  Upload,
  FileText,
  CheckCircle2,
  XCircle,
  Loader2,
  Sparkles,
  ArrowRight,
} from "lucide-react";

type TemplateRow = {
  id: number;
  version: number;
  filename: string;
  mimeType: string;
  uploadedBy: string;
  uploadedAt: string;
  isActive: boolean;
};

type TemplateDetail = TemplateRow & { extractedText: string };

type UploadStatus =
  | { kind: "idle" }
  | { kind: "uploading"; filename: string }
  | { kind: "success"; detail: TemplateDetail }
  | { kind: "error"; message: string; filename?: string };

type CallFlowSection = {
  title: string;
  steps: string[];
  body: string[];
};

function parseCallFlow(text: string): CallFlowSection[] {
  const lines = text.split(/\r?\n/);
  const sections: CallFlowSection[] = [];
  let current: CallFlowSection | null = null;

  const headingRe = /^(?:#{1,6}\s+|\*\*([^*]+)\*\*\s*:?\s*$|([A-Z][A-Z0-9 &/_-]{3,}):?\s*$)/;
  const numberedRe = /^\s*(?:\d+[.)]|[-*•])\s+(.+)$/;

  const pushBody = (s: string) => {
    if (!current) {
      current = { title: "Overview", steps: [], body: [] };
      sections.push(current);
    }
    current.body.push(s);
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;

    const h = line.match(headingRe);
    if (h) {
      const title = line
        .replace(/^#{1,6}\s+/, "")
        .replace(/\*\*/g, "")
        .replace(/:$/, "")
        .trim();
      current = { title, steps: [], body: [] };
      sections.push(current);
      continue;
    }

    const n = line.match(numberedRe);
    if (n && n[1]) {
      if (!current) {
        current = { title: "Call Flow", steps: [], body: [] };
        sections.push(current);
      }
      current.steps.push(n[1].trim());
      continue;
    }

    pushBody(line.trim());
  }

  return sections.length ? sections : [{ title: "Prompt", steps: [], body: [text] }];
}

function StatusBanner({ status }: { status: UploadStatus }) {
  if (status.kind === "idle") return null;
  if (status.kind === "uploading") {
    return (
      <div className="flex items-center gap-3 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span>Uploading & extracting <span className="font-mono">{status.filename}</span>…</span>
      </div>
    );
  }
  if (status.kind === "success") {
    return (
      <div className="flex items-center gap-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm">
        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
        <div className="flex-1">
          <span className="font-semibold text-emerald-500">Uploaded.</span>{" "}
          <span className="text-muted-foreground">
            <span className="font-mono">{status.detail.filename}</span> is now <strong>v{status.detail.version}</strong> and active.
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
      <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
      <div className="flex-1">
        <div className="font-semibold text-destructive">Upload failed</div>
        <div className="text-muted-foreground text-xs mt-0.5">{status.message}</div>
      </div>
    </div>
  );
}

function CallFlowView({ sections }: { sections: CallFlowSection[] }) {
  return (
    <div className="space-y-4">
      {sections.map((sec, i) => (
        <div key={i} className="rounded-md border border-border bg-muted/30 overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-2">
            <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary/15 text-primary text-[10px] font-bold font-mono">
              {i + 1}
            </span>
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground">
              {sec.title}
            </span>
          </div>
          <div className="p-3 space-y-2">
            {sec.body.length > 0 && (
              <div className="text-xs text-muted-foreground space-y-1">
                {sec.body.map((b, bi) => (
                  <p key={bi}>{b}</p>
                ))}
              </div>
            )}
            {sec.steps.length > 0 && (
              <ol className="space-y-1.5">
                {sec.steps.map((s, si) => (
                  <li key={si} className="flex items-start gap-2 text-xs">
                    <ArrowRight className="h-3 w-3 text-primary mt-0.5 shrink-0" />
                    <span className="text-foreground">{s}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PromptTemplatePage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<UploadStatus>({ kind: "idle" });
  const [selected, setSelected] = useState<TemplateDetail | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewSections, setPreviewSections] = useState<CallFlowSection[] | null>(null);
  const [previewMeta, setPreviewMeta] = useState<{ version: number; filename: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isUploading = status.kind === "uploading";
  const hasActiveTemplate = !loading && rows.some((r) => r.isActive);
  const showBanner = !loading && !hasActiveTemplate;

  async function load() {
    setLoading(true);
    try {
      const data = await adminFetch<TemplateRow[]>("/prompt-templates");
      setRows(data);
    } catch (err) {
      toast({ title: "Failed to load templates", description: formatAdminError(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function uploadFile(file: File) {
    setStatus({ kind: "uploading", filename: file.name });
    try {
      const fd = new FormData();
      fd.append("file", file);
      const token = localStorage.getItem("adminToken") ?? "";
      const res = await fetch(`${BASE}/prompt-templates`, {
        method: "POST",
        headers: { "X-Admin-Token": token },
        body: fd,
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${txt || res.statusText}`);
      }
      const created = (await res.json()) as TemplateRow & { extractedTextLength: number };
      // fetch full detail to show extracted text preview
      const detail = await adminFetch<TemplateDetail>(`/prompt-templates/${created.id}`);
      setStatus({ kind: "success", detail });
      setSelected(detail);
      toast({ title: "Template uploaded", description: `v${detail.version} is now active.` });
      void load();
    } catch (err) {
      const message = formatAdminError(err);
      setStatus({ kind: "error", message, filename: file.name });
      toast({ title: "Upload failed", description: message, variant: "destructive" });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function activate(id: number) {
    try {
      await adminFetch(`/prompt-templates/${id}/activate`, { method: "POST" });
      toast({ title: "Activated", description: `Template #${id} is now active.` });
      void load();
    } catch (err) {
      toast({ title: "Activation failed", description: formatAdminError(err), variant: "destructive" });
    }
  }

  async function viewDetail(id: number) {
    try {
      const detail = await adminFetch<TemplateDetail>(`/prompt-templates/${id}`);
      setSelected(detail);
    } catch (err) {
      toast({ title: "Load failed", description: formatAdminError(err), variant: "destructive" });
    }
  }

  async function runPreview() {
    setPreviewLoading(true);
    setPreviewSections(null);
    setPreviewMeta(null);
    try {
      const result = await adminFetch<{
        prompt: string;
        templateVersion: number;
        filename: string;
      }>("/prompt-templates/preview", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setPreviewSections(parseCallFlow(result.prompt));
      setPreviewMeta({ version: result.templateVersion, filename: result.filename });
    } catch (err) {
      toast({ title: "Preview failed", description: formatAdminError(err), variant: "destructive" });
    } finally {
      setPreviewLoading(false);
    }
  }

  const selectedSnippet = useMemo(() => {
    if (!selected) return "";
    const t = selected.extractedText;
    return t.length > 4000 ? t.slice(0, 4000) + "\n\n…(truncated)" : t;
  }, [selected]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Prompt Template</h1>
        <p className="text-muted-foreground mt-1">
          Upload the master prompt template (PDF or Word). The active version is used to generate every new agent's system prompt via Qwen.
        </p>
      </div>

      {showBanner && <NoActiveTemplateBanner linkTo={null} />}

      <Card id="upload">
        <CardHeader>
          <CardTitle>Upload new version</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            disabled={isUploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadFile(f);
            }}
            className="hidden"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => fileRef.current?.click()}
              disabled={isUploading}
              className="gap-2"
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading…
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" />
                  Choose PDF or DOCX
                </>
              )}
            </Button>
            <Button
              variant="outline"
              disabled={previewLoading || !hasActiveTemplate}
              onClick={runPreview}
              className="gap-2"
            >
              {previewLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {previewLoading ? "Generating…" : "Preview with dummy inputs"}
            </Button>
            <p className="text-xs text-muted-foreground">PDF or DOCX. Max 5 MB. Upload immediately becomes the active template.</p>
          </div>

          <StatusBanner status={status} />
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 min-w-0">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="truncate">v{selected.version} — {selected.filename}</span>
                {selected.isActive && <Badge>Active</Badge>}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>Close</Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Extracted text ({selected.extractedText.length.toLocaleString()} chars). Review to confirm parsing looks correct.
            </p>
            <pre className="text-xs whitespace-pre-wrap bg-muted p-3 rounded max-h-96 overflow-y-auto font-mono">{selectedSnippet}</pre>
          </CardContent>
        </Card>
      )}

      {previewSections && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Generated call flow
              {previewMeta && (
                <span className="text-xs font-normal text-muted-foreground ml-2">
                  from v{previewMeta.version} · {previewMeta.filename}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CallFlowView sections={previewSections} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Versions</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No templates uploaded yet.</p>
          ) : (
            <div className="space-y-2">
              {rows.map((r) => (
                <div
                  key={r.id}
                  className={`flex items-center gap-3 rounded-md border px-3 py-2.5 ${
                    r.isActive
                      ? "border-primary/40 bg-primary/5"
                      : "border-border bg-muted/20"
                  }`}
                >
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-muted-foreground">v{r.version}</span>
                      <span className="text-sm truncate">{r.filename}</span>
                      {r.isActive && <Badge>Active</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {new Date(r.uploadedAt).toLocaleString()} · {r.uploadedBy}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => viewDetail(r.id)}>View</Button>
                    {!r.isActive && (
                      <Button size="sm" variant="outline" onClick={() => activate(r.id)}>Activate</Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
