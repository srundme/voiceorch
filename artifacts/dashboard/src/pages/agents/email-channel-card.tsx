import React, { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";
import { cn } from "@/lib/utils";

const _DASH_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DASH_API = `${_DASH_BASE}/api`;

type EmailMode = "managed" | "brevo_byo";

type EmailTemplate = {
  subject: string;
  body: string;
  wrapManagedShell?: boolean;
};

type EmailChannel = {
  id: number;
  mode: EmailMode;
  fromName: string | null;
  fromEmail: string | null;
  hasBrevoKey: boolean;
  brevoApiKeyLast4: string | null;
  defaultTemplate: EmailTemplate;
  active: boolean;
  lastError: string | null;
  lastSentAt: string | null;
  updatedAt?: string | null;
};

type EmailChannelResponse = {
  channel: EmailChannel;
  variables: Array<{ key: string; label: string }>;
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

function insertAtCursor(
  value: string,
  insert: string,
  el: HTMLInputElement | HTMLTextAreaElement | null,
): string {
  if (!el) return `${value}${insert}`;
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? value.length;
  return `${value.slice(0, start)}${insert}${value.slice(end)}`;
}

export function EmailChannelCard({
  compact = false,
  forceExpanded = false,
}: {
  compact?: boolean;
  forceExpanded?: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<EmailMode>("managed");
  const [fromName, setFromName] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [brevoKey, setBrevoKey] = useState("");
  const [subject, setSubject] = useState("Thanks {{name}} — following up from our call");
  const [body, setBody] = useState("<p>Hi {{name}},</p><p>{{summary}}</p><p>— {{agent_name}}</p>");
  const [active, setActive] = useState(true);
  const [testTo, setTestTo] = useState("");
  const [expanded, setExpanded] = useState(!compact);
  const [insertTarget, setInsertTarget] = useState<"subject" | "body">("body");
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["email-channel"],
    queryFn: () => customFetch<EmailChannelResponse>(`${DASH_API}/email/channel`),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!data?.channel) return;
    const ch = data.channel;
    setMode(ch.mode);
    setFromName(ch.fromName ?? "");
    setFromEmail(ch.fromEmail ?? "");
    setSubject(ch.defaultTemplate?.subject ?? subject);
    setBody(ch.defaultTemplate?.body ?? body);
    setActive(ch.active);
  }, [data?.channel?.id, data?.channel?.updatedAt]);

  useEffect(() => {
    if (!forceExpanded) return;
    setExpanded(true);
    requestAnimationFrame(() => {
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [forceExpanded]);

  const save = useMutation({
    mutationFn: async () =>
      customFetch<EmailChannelResponse>(`${DASH_API}/email/channel`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          active,
          fromName: mode === "brevo_byo" ? fromName : undefined,
          fromEmail: mode === "brevo_byo" ? fromEmail : undefined,
          brevoApiKey: mode === "brevo_byo" && brevoKey.trim() ? brevoKey.trim() : undefined,
          defaultTemplate: {
            subject,
            body,
            wrapManagedShell: true,
          },
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-channel"] });
      setBrevoKey("");
      toast({ title: "Email channel saved" });
    },
    onError: (err) => toast({ title: "Save failed", description: formatApiError(err), variant: "destructive" }),
  });

  const testSend = useMutation({
    mutationFn: async () =>
      customFetch(`${DASH_API}/email/channel/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toEmail: testTo.trim() }),
      }),
    onSuccess: () => toast({ title: "Test email sent" }),
    onError: (err) => toast({ title: "Test failed", description: formatApiError(err), variant: "destructive" }),
  });

  if (isLoading) return <Skeleton className="h-28 w-full rounded-xl" />;

  const ch = data?.channel;
  const ready = !!ch?.active && (ch.mode === "managed" || (ch.hasBrevoKey && !!ch.fromEmail));
  const variables = data?.variables?.length
    ? data.variables
    : [
        { key: "name", label: "Lead name" },
        { key: "summary", label: "Summary" },
        { key: "email", label: "Email" },
        { key: "phone", label: "Phone" },
        { key: "agent_name", label: "Agent" },
      ];

  const insertVariable = (key: string) => {
    const token = `{{${key}}}`;
    if (insertTarget === "subject") {
      const next = insertAtCursor(subject, token, subjectRef.current);
      setSubject(next);
      requestAnimationFrame(() => subjectRef.current?.focus());
    } else {
      const next = insertAtCursor(body, token, bodyRef.current);
      setBody(next);
      requestAnimationFrame(() => bodyRef.current?.focus());
    }
  };

  return (
    <div ref={rootRef} className="rounded-xl border border-border/60 bg-card/20 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Mail className="h-4 w-4 text-sky-400" />
            Email
          </h3>
          <p className="text-[11px] text-muted-foreground">
            Use SnapServe-managed mail, or bring your own Brevo API key and paste content with {"{{variables}}"}.
          </p>
        </div>
        <StatusPill ready={ready} label={ready ? (ch?.mode === "managed" ? "SnapServe" : "BYO Brevo") : "Needs setup"} />
      </div>

      {!expanded ? (
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setExpanded(true)}>
          Configure email
        </Button>
      ) : (
        <div className="space-y-3">
          <ol className="rounded-lg border border-border/40 bg-background/40 px-3 py-2 space-y-1 text-[11px] text-muted-foreground">
            <li><span className="font-medium text-foreground/80">1.</span> Choose SnapServe managed or paste your Brevo API key</li>
            <li><span className="font-medium text-foreground/80">2.</span> For BYO: use a sender email verified in your Brevo dashboard</li>
            <li><span className="font-medium text-foreground/80">3.</span> Edit the template — click variable chips to insert</li>
            <li><span className="font-medium text-foreground/80">4.</span> Save, then send a test</li>
            <li><span className="font-medium text-foreground/80">5.</span> Turn on Journey → Email after call and/or Tools → Send email</li>
          </ol>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode("managed")}
              className={cn(
                "rounded-lg border px-3 py-2 text-left transition-colors",
                mode === "managed" ? "border-primary/40 bg-primary/5" : "border-border/40 bg-background/40",
              )}
            >
              <p className="text-xs font-semibold">SnapServe managed</p>
              <p className="text-[10px] text-muted-foreground">Sends as SnapServe brand</p>
            </button>
            <button
              type="button"
              onClick={() => setMode("brevo_byo")}
              className={cn(
                "rounded-lg border px-3 py-2 text-left transition-colors",
                mode === "brevo_byo" ? "border-primary/40 bg-primary/5" : "border-border/40 bg-background/40",
              )}
            >
              <p className="text-xs font-semibold">Bring your Brevo</p>
              <p className="text-[10px] text-muted-foreground">Your API key + sender</p>
            </button>
          </div>

          {mode === "brevo_byo" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">From name</Label>
                <Input className="h-8 text-xs" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Acme Events" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">From email (must be verified in Brevo)</Label>
                <Input className="h-8 text-xs" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="hello@acme.com" />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-[10px] text-muted-foreground">
                  Brevo API key {ch?.hasBrevoKey ? `(saved ···${ch.brevoApiKeyLast4})` : ""}
                </Label>
                <Input
                  className="h-8 text-xs font-mono"
                  type="password"
                  value={brevoKey}
                  onChange={(e) => setBrevoKey(e.target.value)}
                  placeholder={ch?.hasBrevoKey ? "Leave blank to keep current key" : "xkeysib-…"}
                />
                <p className="text-[10px] text-muted-foreground">
                  Create an SMTP API key in Brevo → Settings → SMTP & API. Verify the from-address under Senders before testing.
                </p>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Email subject (supports {"{{variables}}"})</Label>
            <Input
              ref={subjectRef}
              className="h-8 text-xs"
              value={subject}
              onFocus={() => setInsertTarget("subject")}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Email content — paste what should be sent</Label>
            <Textarea
              ref={bodyRef}
              className="min-h-[110px] text-xs font-mono"
              value={body}
              onFocus={() => setInsertTarget("body")}
              onChange={(e) => setBody(e.target.value)}
              placeholder="<p>Hi {{name}},</p><p>{{summary}}</p>"
            />
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {variables.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  title={`Insert {{${v.key}}} into ${insertTarget}`}
                  onClick={() => insertVariable(v.key)}
                  className="rounded-md border border-border/50 bg-background/60 px-2 py-0.5 text-[10px] font-mono text-muted-foreground hover:border-sky-500/40 hover:text-sky-300 transition-colors"
                >
                  {`{{${v.key}}}`}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/40 px-3 py-2">
            <div>
              <p className="text-xs font-medium">Channel active</p>
              <p className="text-[10px] text-muted-foreground">Journeys and the Send email tool can send when this is on</p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>

          {ch?.lastError && (
            <p className="text-[11px] text-destructive">{ch.lastError}</p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" className="h-8 text-xs" disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Save email channel
            </Button>
          </div>

          <div className="flex gap-2 pt-1">
            <Input
              className="h-8 text-xs"
              placeholder="test@example.com"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs shrink-0"
              disabled={!testTo.includes("@") || testSend.isPending}
              onClick={() => testSend.mutate()}
            >
              {testSend.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Send test
            </Button>
          </div>
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
  const ch = data?.channel;
  return !!ch?.active && (ch.mode === "managed" || (ch.hasBrevoKey && !!ch.fromEmail));
}
