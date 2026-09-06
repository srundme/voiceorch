import { Link } from "wouter";
import { SectionSubNav } from "@/components/section-subnav";
import { PRODUCT_TABS } from "@/lib/nav-config";
import { useProductIntegrations, useProductOverview } from "@/hooks/use-admin-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  VoicesIcon,
  PromptIcon,
  AmbientIcon,
  GCalIcon,
  ManagedKeysIcon,
  ManagedNumbersIcon,
} from "@workspace/brand-icons";

const LINKS = [
  { href: "/product/voices", title: "Voices", body: "List, unlist, preview TTS catalogue", icon: VoicesIcon },
  { href: "/product/prompt-templates", title: "Prompt templates", body: "Upload and activate builder templates", icon: PromptIcon },
  { href: "/product/system-prompts", title: "System prompts", body: "Versioned domain prompts", icon: PromptIcon },
  { href: "/product/ambient-sounds", title: "Ambient sounds", body: "Hold / office beds for the builder", icon: AmbientIcon },
  { href: "/product/integrations", title: "Integrations", body: "Calendar, CRM, Sheets, WhatsApp, email", icon: GCalIcon },
  { href: "/managed-keys", title: "Managed keys", body: "Provider credentials health", icon: ManagedKeysIcon },
  { href: "/managed-numbers", title: "Managed numbers", body: "Platform DIDs", icon: ManagedNumbersIcon },
  { href: "/product/providers", title: "Providers", body: "Infra providers + usage", icon: ManagedKeysIcon },
];

export default function ProductHubPage() {
  const { data: overview } = useProductOverview();
  const { data: integrations } = useProductIntegrations();

  return (
    <div className="space-y-6">
      <SectionSubNav tabs={PRODUCT_TABS} />
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Product & Infrastructure</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Voices, prompts, ambient, integrations — controls that shape the user builder.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Listed voices</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold font-mono">{overview?.voicesListed ?? "…"}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Ambient sounds</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold font-mono">{overview?.ambientSounds ?? "…"}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Prompt templates</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold font-mono">
            {overview?.promptTemplates ?? "…"}
            <span className="text-xs text-muted-foreground font-normal ml-2">
              {overview?.activePromptTemplates ?? 0} active
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Integrations</CardTitle></CardHeader>
          <CardContent className="text-2xl font-bold font-mono">
            {integrations?.totals?.connected ?? "…"}
            {(integrations?.totals?.failed ?? 0) > 0 && (
              <Badge variant="destructive" className="ml-2 text-[10px]">{integrations?.totals?.failed} failed</Badge>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {LINKS.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href}>
              <Card className="h-full border-border shadow-none cursor-pointer transition-colors hover:border-muted-foreground/40">
                <CardHeader className="pb-1 pt-3 px-4">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    {item.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3">
                  <p className="text-xs text-muted-foreground">{item.body}</p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
