/**
 * /app/api-keys — Developers hub: recipes + API keys | Event subscriptions
 */
import { Link } from "wouter";
import { Key, BookOpen, Phone, Layers, Inbox, FileJson, Webhook, Code2 } from "lucide-react";
import { StripeTabPage } from "@/components/stripe-tab-page";
import { PageHero, SnapBarsVisual } from "@/components/page-hero";
import { Button } from "@/components/ui/button";
import ApiKeysPage from "@/pages/api-keys";
import WebhooksPage from "@/pages/webhooks";
import { hostProductName, isDirectSnapServeHost } from "@/lib/white-label";
import { publicApiBase } from "@/lib/public-urls";

const RECIPES = [
  {
    title: "Instant outbound",
    description: "Place a single outbound call with one API request.",
    icon: Phone,
    href: "/docs/api-reference",
  },
  {
    title: "Batch campaigns",
    description: "Run outbound calling campaigns at scale from your CRM or CSV.",
    icon: Layers,
    href: "/docs/campaigns",
  },
  {
    title: "Inbound on a number",
    description: "Assign a DID so your agent answers inbound calls.",
    icon: Inbox,
    href: "/app/phone-numbers",
  },
  {
    title: "Fetch outcomes",
    description: "Pull call status, recordings, and transcripts after dials.",
    icon: FileJson,
    href: "/docs/api-reference",
  },
  {
    title: "Event subscriptions",
    description: "Push call events to your webhook URL.",
    icon: Webhook,
    href: "?tab=webhooks",
  },
  {
    title: "Claude skill / MCP",
    description: "Build agents from your coding tools.",
    icon: Code2,
    href: "/docs/claude-skill",
  },
] as const;

function DevelopersRecipes() {
  const product = hostProductName();
  const apiBase = publicApiBase();
  const showDocs = isDirectSnapServeHost();

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8 pb-16">
      <PageHero
        title={`Build with ${product} APIs`}
        description="Generate a key, then place calls or subscribe to events. Docs stay one click away."
        primary={{ label: "Generate API key", href: "?tab=api-keys", icon: <Key className="h-3.5 w-3.5" /> }}
        secondary={showDocs ? { label: "Read docs", href: "/docs/quick-start" } : undefined}
        visual={<SnapBarsVisual />}
      />
      <div className="rounded-2xl border border-border bg-muted/30 px-5 py-4">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">API base</p>
        <code className="mt-1.5 block text-xs font-mono text-foreground break-all">{apiBase}</code>
      </div>
      <div className="space-y-4">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">Recipes</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {RECIPES.map((r) => {
            const Icon = r.icon;
            const internal = r.href.startsWith("?") || r.href.startsWith("/app");
            const docsHref = r.href.startsWith("/docs") && !showDocs ? undefined : r.href;
            if (!docsHref && r.href.startsWith("/docs")) {
              return (
                <div key={r.title} className="rounded-2xl border border-border bg-card p-5 opacity-60 flex flex-col justify-between">
                  <div>
                    <div className="h-9 w-9 rounded-xl bg-muted/60 border border-border/50 flex items-center justify-center mb-3">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-semibold text-foreground">{r.title}</p>
                    <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">{r.description}</p>
                  </div>
                </div>
              );
            }
            return (
              <Link
                key={r.title}
                href={docsHref!}
                className="group rounded-2xl border border-border bg-card p-5 transition-all hover:bg-muted/30 hover:border-border/90 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring flex flex-col justify-between min-h-[140px]"
              >
                <div>
                  <div className="h-9 w-9 rounded-xl bg-muted/60 border border-border/50 flex items-center justify-center mb-3 group-hover:bg-primary/10 group-hover:border-primary/20 transition-colors">
                    <Icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                  <p className="text-sm font-semibold text-foreground group-hover:text-foreground/90">{r.title}</p>
                  <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">{r.description}</p>
                </div>
                {!internal && showDocs ? (
                  <span className="mt-4 inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/80 group-hover:text-primary transition-colors">
                    <BookOpen className="h-3 w-3" /> Docs →
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      </div>
      <div className="flex justify-end pt-2">
        <Button asChild variant="outline" size="sm" className="h-8 text-xs gap-1.5">
          <Link href="?tab=api-keys">
            <Key className="h-3.5 w-3.5" />
            Manage keys
          </Link>
        </Button>
      </div>
    </div>
  );
}

export default function ApiKeysTabPage() {
  const product = hostProductName();
  return (
    <StripeTabPage
      title="Developers"
      description={`API keys, recipes, and workspace event subscriptions (${product} → your app).`}
      defaultTab="overview"
      tabs={[
        { key: "overview", label: "Overview", content: <DevelopersRecipes /> },
        { key: "api-keys", label: "API keys", content: <ApiKeysPage /> },
        { key: "webhooks", label: "Event subscriptions", content: <WebhooksPage /> },
      ]}
    />
  );
}
