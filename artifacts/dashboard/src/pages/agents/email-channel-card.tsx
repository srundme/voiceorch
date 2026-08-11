import React, { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail, Plus, Star, Trash2 } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";
import { cn } from "@/lib/utils";
import { defaultEmailDesign, type EmailDesignDoc } from "@/lib/email-design";
import { EmailDesigner } from "@/pages/agents/email-designer";

const _DASH_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DASH_API = `${_DASH_BASE}/api`;

type EmailTemplate = {
  id: number;
  name: string;
  subject: string;
  bodyHtml: string;
  designJson: EmailDesignDoc | null;
  fromIdentityId: number | null;
  isDefault: boolean;
  updatedAt?: string | null;
};

type FromIdentity = {
  id: number;
  fromName: string;
  fromEmail: string;
  isDefault: boolean;
};

type EmailChannel = {
  id: number;
  mode: "managed" | "brevo_byo";
  fromName: string | null;
  fromEmail: string | null;
  hasBrevoKey: boolean;
  brevoApiKeyLast4: string | null;
  defaultTemplateId: number | null;
  defaultFromIdentityId: number | null;
  active: boolean;
  lastError: string | null;
  lastSentAt: string | null;
  updatedAt?: string | null;
};

type EmailChannelResponse = {
  channel: EmailChannel;
  identities?: FromIdentity[];
  templates?: EmailTemplate[];
  variables: Array<{ key: string; label: string }>;
  defaultDesign?: EmailDesignDoc;
};

function StatusPill({ ready, label }: { ready: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
        ready
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
          : "border-amber-500/25 bg-amber-500/10 text-amber-400",
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", ready ? "bg-emerald-400" : "bg-amber-400")} />
      {label}
    </span>
  );
}

function isEmailReady(ch: EmailChannel | null | undefined, identities?: FromIdentity[]): boolean {
  const hasFrom = !!ch?.fromEmail || (identities?.some((i) => !!i.fromEmail) ?? false);
  return !!ch?.active && ch.mode === "brevo_byo" && ch.hasBrevoKey && hasFrom;
}

export function EmailChannelCard({
  compact = false,
  forceExpanded = false,
  setupMode = false,
}: {
  compact?: boolean;
  forceExpanded?: boolean;
  setupMode?: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [brevoKey, setBrevoKey] = useState("");
  const [active, setActive] = useState(true);
  const [testTo, setTestTo] = useState("");
  const [expanded, setExpanded] = useState(!compact);
  const [showStudio, setShowStudio] = useState(!setupMode);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [tplName, setTplName] = useState("");
  const [tplSubject, setTplSubject] = useState("");
  const [tplHtml, setTplHtml] = useState("");
  const [tplDesign, setTplDesign] = useState<EmailDesignDoc | null>(null);
  const [tplFromId, setTplFromId] = useState<number | null>(null);
  const [newFromName, setNewFromName] = useState("");
  const [newFromEmail, setNewFromEmail] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["email-channel"],
    queryFn: () => customFetch<EmailChannelResponse>(`${DASH_API}/email/channel`),
    staleTime: 30_000,
  });

  const identities = data?.identities ?? [];
  const templates = data?.templates ?? [];
  const variables = data?.variables?.length
    ? data.variables
    : [
        { key: "name", label: "Lead name" },
        { key: "summary", label: "Summary" },
        { key: "meet_link", label: "Meet link" },
        { key: "agent_name", label: "Agent" },
      ];

  useEffect(() => {
    if (!data?.channel) return;
    setActive(data.channel.active);
  }, [data?.channel?.id, data?.channel?.updatedAt]);

  useEffect(() => {
    if (!templates.length) return;
    const preferred =
      templates.find((t) => t.id === selectedTemplateId)
      || templates.find((t) => t.isDefault)
      || templates[0];
    if (!preferred) return;
    if (preferred.id !== selectedTemplateId) setSelectedTemplateId(preferred.id);
    setTplName(preferred.name);
    setTplSubject(preferred.subject);
    setTplHtml(preferred.bodyHtml);
    setTplDesign(preferred.designJson ?? (data?.defaultDesign ? { ...data.defaultDesign } : defaultEmailDesign()));
    setTplFromId(preferred.fromIdentityId);
  }, [templates, selectedTemplateId, data?.defaultDesign]);

  useEffect(() => {
    if (!forceExpanded) return;
    setExpanded(true);
    requestAnimationFrame(() => {
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [forceExpanded]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["email-channel"] });

  const saveChannel = useMutation({
    mutationFn: async () => {
      const primary = identities.find((i) => i.isDefault) || identities[0];
      return customFetch<EmailChannelResponse>(`${DASH_API}/email/channel`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "brevo_byo",
          active,
          fromName: primary?.fromName,
          fromEmail: primary?.fromEmail,
          brevoApiKey: brevoKey.trim() ? brevoKey.trim() : undefined,
          defaultTemplateId: selectedTemplateId,
          defaultFromIdentityId: primary?.id ?? null,
        }),
      });
    },
    onSuccess: () => {
      invalidate();
      setBrevoKey("");
      toast({ title: "Email channel saved" });
    },
    onError: (err) => toast({ title: "Save failed", description: formatApiError(err), variant: "destructive" }),
  });

  const saveIdentity = useMutation({
    mutationFn: async () =>
      customFetch(`${DASH_API}/email/identities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromName: newFromName.trim(),
          fromEmail: newFromEmail.trim(),
          isDefault: identities.length === 0,
        }),
      }),
    onSuccess: () => {
      setNewFromName("");
      setNewFromEmail("");
      invalidate();
      toast({ title: "From address added" });
    },
    onError: (err) => toast({ title: "Could not add From", description: formatApiError(err), variant: "destructive" }),
  });

  const setDefaultIdentity = useMutation({
    mutationFn: async (id: number) => {
      const row = identities.find((i) => i.id === id);
      if (!row) throw new Error("Identity not found");
      return customFetch(`${DASH_API}/email/identities/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromName: row.fromName,
          fromEmail: row.fromEmail,
          isDefault: true,
        }),
      });
    },
    onSuccess: () => invalidate(),
    onError: (err) => toast({ title: "Update failed", description: formatApiError(err), variant: "destructive" }),
  });

  const deleteIdentity = useMutation({
    mutationFn: async (id: number) =>
      customFetch(`${DASH_API}/email/identities/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidate(),
    onError: (err) => toast({ title: "Delete failed", description: formatApiError(err), variant: "destructive" }),
  });

  const saveTemplate = useMutation({
    mutationFn: async (asDefault?: boolean) =>
      customFetch(`${DASH_API}/email/templates${selectedTemplateId ? `/${selectedTemplateId}` : ""}`, {
        method: selectedTemplateId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: tplName.trim() || "Untitled template",
          subject: tplSubject.trim(),
          bodyHtml: tplHtml,
          designJson: tplDesign,
          fromIdentityId: tplFromId,
          isDefault: asDefault || templates.find((t) => t.id === selectedTemplateId)?.isDefault,
        }),
      }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Template saved" });
    },
    onError: (err) => toast({ title: "Template save failed", description: formatApiError(err), variant: "destructive" }),
  });

  const createTemplate = useMutation({
    mutationFn: async () => {
      const design = defaultEmailDesign();
      return customFetch<{ template: EmailTemplate }>(`${DASH_API}/email/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Template ${templates.length + 1}`,
          subject: "Thanks {{name}} — following up from our call",
          designJson: design,
          isDefault: templates.length === 0,
        }),
      });
    },
    onSuccess: (res) => {
      invalidate();
      setSelectedTemplateId(res.template.id);
      setShowStudio(true);
      toast({ title: "Template created — design it below" });
    },
    onError: (err) => toast({ title: "Create failed", description: formatApiError(err), variant: "destructive" }),
  });

  const deleteTemplate = useMutation({
    mutationFn: async (id: number) =>
      customFetch(`${DASH_API}/email/templates/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setSelectedTemplateId(null);
      invalidate();
    },
    onError: (err) => toast({ title: "Delete failed", description: formatApiError(err), variant: "destructive" }),
  });

  const testSend = useMutation({
    mutationFn: async () =>
      customFetch(`${DASH_API}/email/channel/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toEmail: testTo.trim(),
          templateId: selectedTemplateId,
          fromIdentityId: tplFromId,
        }),
      }),
    onSuccess: () => toast({ title: "Test email sent" }),
    onError: (err) => toast({ title: "Test failed", description: formatApiError(err), variant: "destructive" }),
  });

  if (isLoading) return <Skeleton className="h-28 w-full rounded-xl" />;

  const ch = data?.channel;
  const ready = isEmailReady(ch, identities);

  return (
    <div ref={rootRef} className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Mail className="h-4 w-4 text-sky-400" />
            Email
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Connect Brevo once, then add multiple verified From addresses and design as many templates as you need.
          </p>
        </div>
        <StatusPill ready={ready} label={ready ? "Brevo connected" : "Needs setup"} />
      </div>

      {!expanded ? (
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setExpanded(true)}>
          Configure email
        </Button>
      ) : (
        <div className="space-y-4">
          <ol className="space-y-1 rounded-lg border border-border/40 bg-background/40 px-3 py-2 text-[11px] text-muted-foreground">
            <li><span className="font-medium text-foreground/80">1.</span> Paste Brevo API key</li>
            <li><span className="font-medium text-foreground/80">2.</span> Add one or more verified From emails</li>
            <li><span className="font-medium text-foreground/80">3.</span> Create & design templates, then test-send</li>
          </ol>

          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">
              Brevo API key {ch?.hasBrevoKey ? `(saved ···${ch.brevoApiKeyLast4})` : ""}
            </Label>
            <Input
              className="h-8 font-mono text-xs"
              type="password"
              value={brevoKey}
              onChange={(e) => setBrevoKey(e.target.value)}
              placeholder={ch?.hasBrevoKey ? "Leave blank to keep current key" : "xkeysib-…"}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/40 px-3 py-2">
            <div>
              <p className="text-xs font-medium">Channel active</p>
              <p className="text-[10px] text-muted-foreground">After-call messages and Send email need this on</p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>

          {ch?.lastError && <p className="text-[11px] text-destructive">{ch.lastError}</p>}

          <div className="space-y-2 rounded-lg border border-border/40 bg-background/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold">From addresses</p>
              <p className="text-[10px] text-muted-foreground">Must be verified in Brevo</p>
            </div>
            <div className="space-y-1.5">
              {identities.map((id) => (
                <div key={id.id} className="flex items-center gap-2 rounded-md border border-border/40 bg-background/50 px-2.5 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-medium">{id.fromName}</p>
                    <p className="truncate font-mono text-[10px] text-muted-foreground">{id.fromEmail}</p>
                  </div>
                  {id.isDefault ? (
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400">
                      <Star className="h-2.5 w-2.5" /> Default
                    </span>
                  ) : (
                    <Button type="button" variant="ghost" size="sm" className="h-7 text-[10px]" onClick={() => setDefaultIdentity.mutate(id.id)}>
                      Make default
                    </Button>
                  )}
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteIdentity.mutate(id.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input className="h-8 text-xs" placeholder="From name" value={newFromName} onChange={(e) => setNewFromName(e.target.value)} />
              <Input className="h-8 text-xs" placeholder="verified@yourdomain.com" value={newFromEmail} onChange={(e) => setNewFromEmail(e.target.value)} />
              <Button
                type="button"
                size="sm"
                className="h-8 text-xs"
                disabled={!newFromName.trim() || !newFromEmail.includes("@") || saveIdentity.isPending}
                onClick={() => saveIdentity.mutate()}
              >
                {saveIdentity.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Add
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" className="h-8 text-xs" disabled={saveChannel.isPending} onClick={() => saveChannel.mutate()}>
              {saveChannel.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Save connection
            </Button>
          </div>

          <div className="flex gap-2">
            <Input className="h-8 text-xs" placeholder="test@example.com" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 text-xs"
              disabled={!testTo.includes("@") || testSend.isPending}
              onClick={() => testSend.mutate()}
            >
              {testSend.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Send test
            </Button>
          </div>

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              className="text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              onClick={() => setShowStudio((v) => !v)}
            >
              {showStudio ? "Hide template studio" : "Open template studio"}
            </button>
            <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => createTemplate.mutate()} disabled={createTemplate.isPending}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              New template
            </Button>
          </div>

          {showStudio && (
            <div className="space-y-3 rounded-xl border border-border/50 bg-background/30 p-3">
              <div className="flex flex-wrap gap-1.5">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedTemplateId(t.id)}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-[11px]",
                      selectedTemplateId === t.id
                        ? "border-sky-500/50 bg-sky-500/10 text-sky-200"
                        : "border-border/50 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t.name}{t.isDefault ? " · default" : ""}
                  </button>
                ))}
              </div>

              {selectedTemplateId && (
                <>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Template name</Label>
                      <Input className="h-8 text-xs" value={tplName} onChange={(e) => setTplName(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Send from</Label>
                      <select
                        className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                        value={tplFromId ?? ""}
                        onChange={(e) => setTplFromId(e.target.value ? Number(e.target.value) : null)}
                      >
                        <option value="">Channel default</option>
                        {identities.map((i) => (
                          <option key={i.id} value={i.id}>{i.fromName} &lt;{i.fromEmail}&gt;</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <Label className="text-[10px] text-muted-foreground">Subject</Label>
                      <Input className="h-8 text-xs" value={tplSubject} onChange={(e) => setTplSubject(e.target.value)} />
                    </div>
                  </div>

                  <EmailDesigner
                    design={tplDesign}
                    htmlFallback={tplHtml}
                    variables={variables}
                    onChangeDesign={setTplDesign}
                    onChangeHtml={setTplHtml}
                  />

                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" className="h-8 text-xs" disabled={saveTemplate.isPending} onClick={() => saveTemplate.mutate(false)}>
                      {saveTemplate.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                      Save template
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled={saveTemplate.isPending} onClick={() => saveTemplate.mutate(true)}>
                      Save as default
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-destructive"
                      disabled={templates.length <= 1 || deleteTemplate.isPending}
                      onClick={() => selectedTemplateId && deleteTemplate.mutate(selectedTemplateId)}
                    >
                      Delete
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function useEmailChannelReady() {
  const { data } = useQuery({
    queryKey: ["email-channel"],
    queryFn: () => customFetch<EmailChannelResponse>(`${DASH_API}/email/channel`),
    staleTime: 30_000,
  });
  return isEmailReady(data?.channel, data?.identities);
}
