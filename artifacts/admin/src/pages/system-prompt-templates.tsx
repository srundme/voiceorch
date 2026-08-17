import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, BASE, formatAdminError } from "@/lib/api";
import { SectionSubNav } from "@/components/section-subnav";
import { PROMPT_TABS } from "@/lib/nav-config";
import {
  Upload,
  FileText,
  Loader2,
  Layers,
  Building2,
  UserSquare,
  Plus,
  Pencil,
  Trash2,
  History,
  Eye,
} from "lucide-react";

type VersionRow = {
  id: number;
  version: number;
  filename: string;
  mimeType: string;
  uploadedBy: string;
  uploadedAt: string;
  isActive: boolean;
};

type SingletonGroup = { versions: VersionRow[]; activeVersion: number | null };
type DomainGroup = {
  id: number;
  name: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  versions: VersionRow[];
  activeVersion: number | null;
};
type GroupedTemplates = {
  foundation: SingletonGroup;
  clientDetails: SingletonGroup;
  domains: DomainGroup[];
};

type VersionDetail = VersionRow & { extractedText: string };

function activeVersionRow(g: SingletonGroup | DomainGroup): VersionRow | null {
  return g.versions.find((v) => v.isActive) ?? null;
}

/** Multipart POST helper (adminFetch is JSON-only). */
async function uploadMultipart(path: string, formData: FormData): Promise<void> {
  const token = localStorage.getItem("adminToken") ?? "";
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "X-Admin-Token": token },
    body: formData,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${txt || res.statusText}`);
  }
}

const ACCEPT = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function VersionHistory({
  versions,
  onActivate,
  onView,
  busy,
}: {
  versions: VersionRow[];
  onActivate: (id: number) => void;
  onView: (id: number) => void;
  busy: boolean;
}) {
  if (versions.length === 0) {
    return <p className="text-xs text-muted-foreground">No versions uploaded yet.</p>;
  }
  return (
    <div className="space-y-1.5">
      {versions.map((r) => (
        <div
          key={r.id}
          className={`flex items-center gap-3 rounded-md border px-3 py-2 ${
            r.isActive ? "border-primary/40 bg-primary/5" : "border-border bg-muted/20"
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
            <Button size="sm" variant="ghost" onClick={() => onView(r.id)} className="gap-1.5">
              <Eye className="h-3.5 w-3.5" />
              View
            </Button>
            {!r.isActive && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onActivate(r.id)}>
                Activate
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A single template card (used for Foundation and Client Details singletons). */
function SingletonCard({
  title,
  description,
  icon: Icon,
  group,
  uploadPath,
  onChanged,
  onView,
}: {
  title: string;
  description: string;
  icon: React.ElementType;
  group: SingletonGroup;
  uploadPath: string;
  onChanged: () => void;
  onView: (id: number) => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const active = activeVersionRow(group);

  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await uploadMultipart(uploadPath, fd);
      toast({ title: `${title} updated`, description: `New active version uploaded.` });
      onChanged();
    } catch (err) {
      toast({ title: "Upload failed", description: formatAdminError(err), variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function activate(id: number) {
    setBusy(true);
    try {
      await adminFetch(`/system-prompt-templates/versions/${id}/activate`, { method: "POST" });
      toast({ title: "Activated", description: `Version #${id} is now active.` });
      onChanged();
    } catch (err) {
      toast({ title: "Activation failed", description: formatAdminError(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-4.5 w-4.5 text-primary" />
          {title}
          {active ? (
            <Badge variant="secondary" className="ml-1">
              v{active.version} Active
            </Badge>
          ) : (
            <Badge variant="outline" className="ml-1 text-muted-foreground">
              No active version
            </Badge>
          )}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        {active ? (
          <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-sm">
            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="truncate">{active.filename}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Uploaded {new Date(active.uploadedAt).toLocaleString()} · {active.uploadedBy}
              </div>
            </div>
            <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => onView(active.id)}>
              <Eye className="h-3.5 w-3.5" />
              Preview
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No {title.toLowerCase()} uploaded yet. Upload a PDF or DOCX to create version 1.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => fileRef.current?.click()} disabled={uploading} className="gap-2">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? "Uploading…" : active ? "Upload new version" : "Upload template"}
          </Button>
          {group.versions.length > 0 && (
            <Button variant="outline" className="gap-2" onClick={() => setShowHistory((s) => !s)}>
              <History className="h-4 w-4" />
              {showHistory ? "Hide history" : `Version history (${group.versions.length})`}
            </Button>
          )}
          <p className="text-xs text-muted-foreground">PDF or DOCX. Max 5 MB.</p>
        </div>

        {showHistory && (
          <div className="pt-1">
            <VersionHistory versions={group.versions} onActivate={activate} onView={onView} busy={busy} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** A dynamic domain card. */
function DomainCard({
  domain,
  onChanged,
  onView,
}: {
  domain: DomainGroup;
  onChanged: () => void;
  onView: (id: number) => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(domain.name);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const active = activeVersionRow(domain);

  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await uploadMultipart(`/system-prompt-templates/domains/${domain.id}/versions`, fd);
      toast({ title: `${domain.name} updated`, description: "New active version uploaded." });
      onChanged();
    } catch (err) {
      toast({ title: "Upload failed", description: formatAdminError(err), variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function activate(id: number) {
    setBusy(true);
    try {
      await adminFetch(`/system-prompt-templates/versions/${id}/activate`, { method: "POST" });
      toast({ title: "Activated", description: `Version #${id} is now active.` });
      onChanged();
    } catch (err) {
      toast({ title: "Activation failed", description: formatAdminError(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function rename() {
    const name = renameValue.trim();
    if (!name) return;
    setBusy(true);
    try {
      await adminFetch(`/system-prompt-templates/domains/${domain.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      toast({ title: "Renamed", description: `Domain is now "${name}".` });
      setRenameOpen(false);
      onChanged();
    } catch (err) {
      toast({ title: "Rename failed", description: formatAdminError(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await adminFetch(`/system-prompt-templates/domains/${domain.id}`, { method: "DELETE" });
      toast({ title: "Deleted", description: `Domain "${domain.name}" removed.` });
      setDeleteOpen(false);
      onChanged();
    } catch (err) {
      toast({ title: "Delete failed", description: formatAdminError(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-start gap-3 px-4 py-3 border-b border-border">
        <Building2 className="h-4.5 w-4.5 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold truncate">{domain.name}</span>
            {active ? (
              <Badge variant="secondary">v{active.version} (Active)</Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                No active version
              </Badge>
            )}
          </div>
          {active && (
            <div className="text-xs text-muted-foreground mt-0.5 truncate">
              {active.filename} · {new Date(active.uploadedAt).toLocaleString()}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5"
            onClick={() => {
              setRenameValue(domain.name);
              setRenameOpen(true);
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
            Rename
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 text-destructive hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
        </div>
      </div>

      <div className="px-4 py-3 space-y-3">
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={uploading} className="gap-2">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? "Uploading…" : "Upload new version"}
          </Button>
          {active && (
            <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => onView(active.id)}>
              <Eye className="h-3.5 w-3.5" />
              Preview
            </Button>
          )}
          {domain.versions.length > 0 && (
            <Button size="sm" variant="outline" className="gap-2" onClick={() => setShowHistory((s) => !s)}>
              <History className="h-4 w-4" />
              {showHistory ? "Hide history" : `History (${domain.versions.length})`}
            </Button>
          )}
        </div>

        {showHistory && (
          <VersionHistory versions={domain.versions} onActivate={activate} onView={onView} busy={busy} />
        )}
      </div>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename domain</DialogTitle>
            <DialogDescription>Update the display name for this domain template.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rename-domain">Domain name</Label>
            <Input
              id="rename-domain"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void rename();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy || !renameValue.trim()} onClick={() => void rename()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{domain.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the domain and its entire version history ({domain.versions.length}{" "}
              version{domain.versions.length === 1 ? "" : "s"}). This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void remove();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete domain
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function NewDomainDialog({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setName("");
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function create() {
    if (!name.trim() || !file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("name", name.trim());
      fd.append("file", file);
      await uploadMultipart("/system-prompt-templates/domains", fd);
      toast({ title: "Domain created", description: `"${name.trim()}" added with version 1.` });
      setOpen(false);
      reset();
      onCreated();
    } catch (err) {
      toast({ title: "Create failed", description: formatAdminError(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <Button className="gap-2" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        New Domain Template
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New domain template</DialogTitle>
          <DialogDescription>
            Name the domain (e.g. Real Estate, Insurance) and upload its first template version.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-domain-name">Domain name</Label>
            <Input
              id="new-domain-name"
              placeholder="e.g. Real Estate"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Template file</Label>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground">PDF or DOCX. Max 5 MB.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !name.trim() || !file} onClick={() => void create()} className="gap-2">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Create domain
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function SystemPromptTemplatesPage() {
  const { toast } = useToast();
  const [data, setData] = useState<GroupedTemplates | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<VersionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  async function load() {
    try {
      const grouped = await adminFetch<GroupedTemplates>("/system-prompt-templates");
      setData(grouped);
    } catch (err) {
      toast({ title: "Failed to load templates", description: formatAdminError(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function viewVersion(id: number) {
    setDetailLoading(true);
    try {
      const d = await adminFetch<VersionDetail>(`/system-prompt-templates/versions/${id}`);
      setDetail(d);
    } catch (err) {
      toast({ title: "Load failed", description: formatAdminError(err), variant: "destructive" });
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <SectionSubNav tabs={PROMPT_TABS} />
      <div>
        <h1 className="text-3xl font-bold tracking-tight">System Prompt Templates</h1>
        <p className="text-muted-foreground mt-1">
          The three reusable layers of the SnapServe Prompting Framework. Together — Foundation + a selected
          Domain + Client Details — these are the future source of truth for generating every agent's system
          prompt.
        </p>
      </div>

      {loading || !data ? (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading templates…
        </div>
      ) : (
        <>
          <SingletonCard
            title="Foundation Template"
            description="The shared base that anchors every generated prompt. Exactly one, versioned."
            icon={Layers}
            group={data.foundation}
            uploadPath="/system-prompt-templates/singleton/foundation"
            onChanged={load}
            onView={viewVersion}
          />

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Building2 className="h-4.5 w-4.5 text-primary" />
                  Domain Templates
                </h2>
                <p className="text-sm text-muted-foreground">
                  A fully dynamic list of domains, each with its own independent version history. Add, rename,
                  and remove domains without any code changes.
                </p>
              </div>
              <NewDomainDialog onCreated={load} />
            </div>

            {data.domains.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center">
                  <Building2 className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">
                    No domain templates yet. Use “New Domain Template” to add your first one (e.g. Real Estate,
                    Insurance, Education).
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {data.domains.map((d) => (
                  <DomainCard key={d.id} domain={d} onChanged={load} onView={viewVersion} />
                ))}
              </div>
            )}
          </div>

          <SingletonCard
            title="Client Details Template"
            description="Per-client specifics layered on top of Foundation + Domain. Exactly one, versioned."
            icon={UserSquare}
            group={data.clientDetails}
            uploadPath="/system-prompt-templates/singleton/client_details"
            onChanged={load}
            onView={viewVersion}
          />
        </>
      )}

      <Dialog open={!!detail || detailLoading} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              {detail ? `v${detail.version} — ${detail.filename}` : "Loading…"}
              {detail?.isActive && <Badge>Active</Badge>}
            </DialogTitle>
            {detail && (
              <DialogDescription>
                Extracted text ({detail.extractedText.length.toLocaleString()} chars). Review to confirm
                parsing looks correct.
              </DialogDescription>
            )}
          </DialogHeader>
          {detailLoading ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground py-8">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading extracted text…
            </div>
          ) : detail ? (
            <pre className="text-xs whitespace-pre-wrap bg-muted p-3 rounded max-h-[60vh] overflow-y-auto font-mono">
              {detail.extractedText.length > 8000
                ? detail.extractedText.slice(0, 8000) + "\n\n…(truncated)"
                : detail.extractedText}
            </pre>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
