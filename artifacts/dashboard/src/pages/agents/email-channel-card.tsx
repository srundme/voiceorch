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

type EmailTemplate = {
  subject: string;
  body: string;
  wrapManagedShell?: boolean;
};

type EmailChannel = {
  id: number;
  mode: "managed" | "brevo_byo";
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

function isEmailReady(ch: EmailChannel | null | undefined): boolean {
  return !!ch?.active && ch.mode === "brevo_byo" && ch.hasBrevoKey && !!ch.fromEmail;
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
  const [fromName, setFromName] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [brevoKey, setBrevoKey] = useState("");
  const [subject, setSubject] = useState("Thanks {{name}} — following up from our call");
  const [body, setBody] = useState("<p>Hi {{name}},</p><p>{{summary}}</p><p>— {{agent_name}}</p>");
  const [active, setActive] = useState(true);
  const [testTo, setTestTo] = useState("");
  const [expanded, setExpanded] = useState(!compact);
  const [insertTarget, setInsertTarget] = useState<"subject" | "body">("subject");
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
          mode: "brevo_byo",
          active,
          fromName,
          fromEmail,
          brevoApiKey: brevoKey.trim() ? brevoKey.trim() : undefined,
          defaultTemplate: {
            subject,
            body,
            wrapManagedShell: false,
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
  const ready = isEmailReady(ch);
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
    <div ref={rootRef} className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Mail className="h-4 w-4 text-sky-400" />
            Email
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Connect your Brevo account. SnapServe does not send email for you — you bring the API key and verified sender.
          </p>
        </div>
        <StatusPill ready={ready} label={ready ? "Brevo connected" : "Needs setup"} />
      </div>

      {!expanded ? (
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setExpanded(true)}>
          Configure email
        </Button>
      ) : (
        <div className="space-y-3">
          <ol className="space-y-1 rounded-lg border border-border/40 bg-background/40 px-3 py-2 text-[11px] text-muted-foreground">
            <li><span className="font-medium text-foreground/80">1.</span> Paste your Brevo API key</li>
            <li><span className="font-medium text-foreground/80">2.</span> Use a sender email verified in your Brevo dashboard</li>
            <li><span className="font-medium text-foreground/80">3.</span> Edit the template — click variable chips to insert</li>
            <li><span className="font-medium text-foreground/80">4.</span> Save, then send a test</li>
            <li><span className="font-medium text-foreground/80">5.</span> Turn on Journey → Email after call and/or Tools → Send email</li>
          </ol>

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
                className="h-8 font-mono text-xs"
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
              className="min-h-[110px] font-mono text-xs"
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
                  className="rounded-md border border-border/50 bg-background/60 px-2 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-sky-500/40 hover:text-sky-300"
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
              {save.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
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
              className="h-8 shrink-0 text-xs"
              disabled={!testTo.includes("@") || testSend.isPending}
              onClick={() => testSend.mutate()}
            >
              {testSend.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
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
  return isEmailReady(data?.channel);
}
