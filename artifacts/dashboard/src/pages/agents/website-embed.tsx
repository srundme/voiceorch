import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Code2, Copy, ExternalLink, Globe, Loader2, RefreshCw } from "lucide-react";
import { ApiError, customFetch } from "@workspace/api-client-react";
import { formatApiError } from "@/lib/format-api-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const DASH_API = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

type EmbedPayload = {
  id: number;
  token: string;
  agentId: number;
  agentName: string;
  active: boolean;
  useCount: number;
  joinUrl: string;
  widgetScriptSrc: string;
  iframeSrc: string;
};

function attrEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function CopyBlock({ label, code, hint }: { label: string; code: string; hint?: string }) {
  const { toast } = useToast();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() => {
            void navigator.clipboard.writeText(code);
            toast({ title: "Copied to clipboard" });
          }}
        >
          <Copy className="size-3" />
          Copy
        </button>
      </div>
      {hint ? <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p> : null}
      <pre className="overflow-x-auto whitespace-pre rounded-lg border border-border bg-muted/40 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
        {code}
      </pre>
    </div>
  );
}

export function AgentWebsiteEmbedPanel({
  agentId,
  agentName,
}: {
  agentId: number;
  agentName: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const qk = [`${DASH_API}/agents/${agentId}/webcall-links/embed`];
  const [color, setColor] = useState("#0ea5e9");
  const [position, setPosition] = useState("bottom-right");

  const embedQuery = useQuery({
    queryKey: qk,
    queryFn: () => customFetch<EmbedPayload>(`${DASH_API}/agents/${agentId}/webcall-links/embed`),
    enabled: Number.isFinite(agentId) && agentId > 0,
    retry: (count, err) => (err instanceof ApiError && err.status === 404 ? false : count < 2),
  });

  const createEmbed = useMutation({
    mutationFn: (regenerate: boolean) =>
      customFetch<EmbedPayload>(`${DASH_API}/agents/${agentId}/webcall-links/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerate }),
      }),
    onSuccess: (data, regenerate) => {
      qc.setQueryData(qk, data);
      toast({
        title: regenerate ? "New embed token" : "Embed ready",
        description: "Copy a snippet below onto your website.",
      });
    },
    onError: (err: unknown) => {
      toast({ title: "Could not create embed", description: formatApiError(err), variant: "destructive" });
    },
  });

  // Older APIs 404 until POST — mint once so copy blocks always appear.
  const autoMinted = useRef(false);
  useEffect(() => {
    if (autoMinted.current) return;
    if (embedQuery.isLoading || createEmbed.isPending || embedQuery.data) return;
    if (embedQuery.error instanceof ApiError && embedQuery.error.status === 404) {
      autoMinted.current = true;
      createEmbed.mutate(false);
    }
  }, [embedQuery.isLoading, embedQuery.data, embedQuery.error, createEmbed]);

  const embed = embedQuery.data ?? null;
  const displayName = (agentName || embed?.agentName || "Voice assistant").trim() || "Voice assistant";
  const safeColor = /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#0ea5e9";

  const snippets = useMemo(() => {
    if (!embed) return null;
    const script = `<script src="${embed.widgetScriptSrc}"
        data-agent-id="${embed.agentId}"
        data-share="${embed.token}"
        data-name="${attrEscape(displayName)}"
        data-color="${safeColor}"
        data-position="${position}"></script>`;
    const iframe = `<iframe
  src="${embed.iframeSrc}"
  allow="microphone"
  title="${attrEscape(displayName)}"
  style="border:0;width:380px;height:560px"></iframe>`;
    const button = `<a href="${embed.joinUrl}" target="_blank" rel="noopener">Talk to ${attrEscape(displayName)}</a>`;
    return { script, iframe, button, joinUrl: embed.joinUrl };
  }, [embed, displayName, safeColor, position]);

  return (
    <div className="space-y-5">
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        Let visitors talk to this agent from your own site — a floating call button, an inline frame,
        or a “talk to us” link. Calls use your wallet minutes, same as Live test.
      </p>

      {embedQuery.isLoading || createEmbed.isPending ? (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Loading embed…
        </div>
      ) : !embed || !snippets ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-center space-y-3">
          <Globe className="mx-auto size-5 text-muted-foreground" />
          <p className="text-[13px] text-foreground">No website embed for this agent yet.</p>
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            disabled={createEmbed.isPending}
            onClick={() => createEmbed.mutate(false)}
          >
            {createEmbed.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Code2 className="size-3.5" />}
            Generate embed code
          </Button>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Button color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={safeColor}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-9 w-10 cursor-pointer rounded-md border border-border bg-background p-0.5"
                  aria-label="Widget color"
                />
                <Input
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-9 font-mono text-[12px]"
                  spellCheck={false}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Bubble position</Label>
              <Select value={position} onValueChange={setPosition}>
                <SelectTrigger className="h-9 text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bottom-right">Bottom right</SelectItem>
                  <SelectItem value="bottom-left">Bottom left</SelectItem>
                  <SelectItem value="top-right">Top right</SelectItem>
                  <SelectItem value="top-left">Top left</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <CopyBlock
            label="1. Floating widget (recommended)"
            hint="Paste once before </body> on any page. Visitors click the mic, allow the microphone, and talk."
            code={snippets.script}
          />
          <CopyBlock
            label="2. Inline iframe"
            hint="Use when you want a fixed panel. The iframe must include allow=&quot;microphone&quot;."
            code={snippets.iframe}
          />
          <CopyBlock
            label="3. Direct link"
            hint="Open a full-page call (same as sharing a join link). Good for a button or QR code."
            code={snippets.button}
          />

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
            <p className={cn("text-[11px] text-muted-foreground", !embed.active && "text-amber-600")}>
              {embed.active ? `${embed.useCount} visitor call${embed.useCount === 1 ? "" : "s"} started from this embed.` : "This embed is turned off."}
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-[11px]" asChild>
                <a href={snippets.joinUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-3" /> Preview
                </a>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-[11px]"
                disabled={createEmbed.isPending}
                onClick={() => {
                  if (!confirm("Generate a new token? The old snippet on your website will stop working until you replace it.")) return;
                  createEmbed.mutate(true);
                }}
              >
                {createEmbed.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3" />}
                New token
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
