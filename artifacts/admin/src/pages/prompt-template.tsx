import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, BASE, formatAdminError } from "@/lib/api";

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

export default function PromptTemplatePage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<TemplateDetail | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewText, setPreviewText] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

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
    setUploading(true);
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
      toast({ title: "Template uploaded", description: "It is now the active master template." });
      void load();
    } catch (err) {
      toast({ title: "Upload failed", description: formatAdminError(err), variant: "destructive" });
    } finally {
      setUploading(false);
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
      setPreviewText("");
    } catch (err) {
      toast({ title: "Load failed", description: formatAdminError(err), variant: "destructive" });
    }
  }

  async function runPreview() {
    setPreviewLoading(true);
    setPreviewText("");
    try {
      const result = await adminFetch<{ prompt: string }>("/prompt-templates/preview", {
        method: "POST",
        body: JSON.stringify({}), // server uses dummy payload when wizardInputs absent
      });
      setPreviewText(result.prompt);
    } catch (err) {
      toast({ title: "Preview failed", description: formatAdminError(err), variant: "destructive" });
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Prompt Template</h1>
        <p className="text-muted-foreground mt-1">
          Upload the master prompt template (PDF or Word). The active version is used to generate every new agent's system prompt via Gemini.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload new version</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadFile(f);
            }}
            className="block text-sm"
          />
          <p className="text-xs text-muted-foreground">PDF or DOCX. Max 5 MB. Upload immediately becomes the active template.</p>
          <Button variant="outline" size="sm" disabled={previewLoading} onClick={runPreview}>
            {previewLoading ? "Generating…" : "Preview with dummy inputs"}
          </Button>
          {previewText && (
            <pre className="mt-3 text-xs whitespace-pre-wrap bg-muted p-3 rounded max-h-80 overflow-y-auto">{previewText}</pre>
          )}
        </CardContent>
      </Card>

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
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground border-b border-border">
                <tr>
                  <th className="py-2 pr-3">Ver</th>
                  <th className="py-2 pr-3">File</th>
                  <th className="py-2 pr-3">Uploaded by</th>
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/50">
                    <td className="py-2 pr-3 font-mono">v{r.version}</td>
                    <td className="py-2 pr-3 truncate max-w-xs">{r.filename}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{r.uploadedBy}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{new Date(r.uploadedAt).toLocaleString()}</td>
                    <td className="py-2 pr-3">{r.isActive ? <Badge>Active</Badge> : <Badge variant="outline">Inactive</Badge>}</td>
                    <td className="py-2 space-x-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => viewDetail(r.id)}>View</Button>
                      {!r.isActive && (
                        <Button size="sm" variant="outline" onClick={() => activate(r.id)}>Activate</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>v{selected.version} — {selected.filename}</span>
              <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>Close</Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs whitespace-pre-wrap bg-muted p-3 rounded max-h-96 overflow-y-auto">{selected.extractedText}</pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
