import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Copy, ExternalLink, Link2, Loader2, Trash2 } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import { formatApiError } from "@/lib/format-api-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const DASH_API = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

/** Same marker the server stores on the website-widget link (lib/db webcall-links). */
const WEBSITE_EMBED_PURPOSE = "website-embed";

type WebcallLink = {
  id: number;
  token: string;
  label: string | null;
  purpose: string | null;
  active: boolean;
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
  lastUsedAt: string | null;
  createdAt: string;
};

const EXPIRY_OPTIONS = [
  { value: "never", label: "Never", days: 0 },
  { value: "1", label: "1 day", days: 1 },
  { value: "7", label: "7 days", days: 7 },
  { value: "30", label: "30 days", days: 30 },
] as const;

function joinUrl(token: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}/join/${token}`;
}

function linkStatus(link: WebcallLink): { text: string; live: boolean } {
  if (!link.active) return { text: "Turned off", live: false };
  if (link.expiresAt && new Date(link.expiresAt).getTime() <= Date.now()) return { text: "Expired", live: false };
  if (link.maxUses != null && link.useCount >= link.maxUses) return { text: "Used up", live: false };
  return { text: "Live", live: true };
}

/**
 * Shareable web call links for one agent: anyone with the link can talk to the
 * agent in their browser without logging in. Minutes come from the owner's wallet.
 */
export function AgentShareLinksDialog({
  agentId,
  agentName,
  open,
  onOpenChange,
  readOnly,
}: {
  agentId: number;
  agentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  readOnly?: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const qk = [`${DASH_API}/agents/${agentId}/webcall-links`];
  const [label, setLabel] = useState("");
  const [purpose, setPurpose] = useState("");
  const [expiry, setExpiry] = useState<string>("never");
  const [maxUses, setMaxUses] = useState("");

  const linksQuery = useQuery({
    queryKey: qk,
    queryFn: () => customFetch<WebcallLink[]>(`${DASH_API}/agents/${agentId}/webcall-links`),
    enabled: open && Number.isFinite(agentId) && agentId > 0,
  });
  const links = (linksQuery.data ?? []).filter((l) => l.purpose !== WEBSITE_EMBED_PURPOSE);

  const copy = (token: string) => {
    void navigator.clipboard.writeText(joinUrl(token));
    toast({ title: "Link copied", description: "Send it on WhatsApp, email or SMS." });
  };

  const createLink = useMutation({
    mutationFn: () => {
      const days = EXPIRY_OPTIONS.find((o) => o.value === expiry)?.days ?? 0;
      const uses = parseInt(maxUses, 10);
      return customFetch<WebcallLink>(`${DASH_API}/agents/${agentId}/webcall-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim() || undefined,
          purpose: purpose.trim() || undefined,
          expiresAt: days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : undefined,
          maxUses: Number.isFinite(uses) && uses > 0 ? uses : undefined,
        }),
      });
    },
    onSuccess: (row) => {
      void qc.invalidateQueries({ queryKey: qk });
      setLabel("");
      setPurpose("");
      setExpiry("never");
      setMaxUses("");
      copy(row.token);
    },
    onError: (err: unknown) => {
      toast({ title: "Could not create link", description: formatApiError(err), variant: "destructive" });
    },
  });

  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      customFetch<WebcallLink>(`${DASH_API}/webcall-links/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk }),
    onError: (err: unknown) => {
      toast({ title: "Could not update link", description: formatApiError(err), variant: "destructive" });
    },
  });

  const deleteLink = useMutation({
    mutationFn: (id: number) => customFetch<void>(`${DASH_API}/webcall-links/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk });
      toast({ title: "Link deleted", description: "Anyone who has it can no longer call." });
    },
    onError: (err: unknown) => {
      toast({ title: "Could not delete link", description: formatApiError(err), variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="size-4" /> Share {agentName}
          </DialogTitle>
          <DialogDescription>
            Anyone with the link can talk to this agent in their browser — no app, no login, no phone call.
            Minutes come from your wallet, same as Live test.
          </DialogDescription>
        </DialogHeader>

        {!readOnly && (
          <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="share-label" className="text-xs">Name (shown to the caller)</Label>
                <Input
                  id="share-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={agentName}
                  maxLength={120}
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="share-purpose" className="text-xs">Note for the caller (optional)</Label>
                <Input
                  id="share-purpose"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder="e.g. Policy renewal help"
                  maxLength={200}
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Link expires</Label>
                <Select value={expiry} onValueChange={setExpiry}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EXPIRY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="share-max" className="text-xs">Max calls (blank = no limit)</Label>
                <Input
                  id="share-max"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={maxUses}
                  onChange={(e) => setMaxUses(e.target.value)}
                  placeholder="No limit"
                  className="h-9"
                />
              </div>
            </div>
            <Button
              type="button"
              className="w-full gap-1.5"
              onClick={() => createLink.mutate()}
              disabled={createLink.isPending}
            >
              {createLink.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
              Create link and copy
            </Button>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Your links</p>
          {linksQuery.isLoading ? (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Loading…
            </div>
          ) : links.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">No links yet.</p>
          ) : (
            links.map((link) => {
              const status = linkStatus(link);
              const url = joinUrl(link.token);
              return (
                <div key={link.id} className="space-y-2 rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[13px] font-medium">{link.label || agentName}</p>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                        status.live
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {status.text}
                    </span>
                  </div>
                  <code className="block break-all rounded-md bg-muted/40 px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                    {url}
                  </code>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] text-muted-foreground">
                      {link.useCount}{link.maxUses != null ? ` / ${link.maxUses}` : ""} calls
                      {link.lastUsedAt ? ` · last ${formatDistanceToNow(new Date(link.lastUsedAt), { addSuffix: true })}` : ""}
                      {link.expiresAt ? ` · expires ${formatDistanceToNow(new Date(link.expiresAt), { addSuffix: true })}` : ""}
                    </p>
                    <div className="flex items-center gap-1">
                      <Button type="button" size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" onClick={() => copy(link.token)}>
                        <Copy className="size-3" /> Copy
                      </Button>
                      <Button type="button" size="sm" variant="ghost" className="h-7 px-2" asChild>
                        <a href={url} target="_blank" rel="noopener noreferrer" title="Open link">
                          <ExternalLink className="size-3.5" />
                        </a>
                      </Button>
                      {!readOnly && (
                        <>
                          <Switch
                            checked={link.active}
                            onCheckedChange={(active) => setActive.mutate({ id: link.id, active })}
                            aria-label={link.active ? "Turn link off" : "Turn link on"}
                            title={link.active ? "Turn off" : "Turn on"}
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-destructive hover:text-destructive"
                            title="Delete link"
                            onClick={() => {
                              if (window.confirm("Delete this link? Anyone who has it will no longer be able to call.")) {
                                deleteLink.mutate(link.id);
                              }
                            }}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
