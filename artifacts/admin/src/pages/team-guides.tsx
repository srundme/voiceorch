import { useState } from "react";
import { BookOpen, Download, FileText, MessageCircleQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { BASE } from "@/lib/api";

const GUIDES = [
  {
    id: "portal-button-guide",
    title: "Portal Button Guide",
    filename: "SnapServe-Portal-Button-Guide.pdf",
    description:
      "Plain-English reference for every customer portal page and button. Use it when someone asks, “What does this button do?”",
    icon: FileText,
  },
  {
    id: "team-qa-prep",
    title: "Team Q&A Prep",
    filename: "SnapServe-Team-QA-Prep.pdf",
    description:
      "Webinar and Voiceathon answers for how the product works, where settings live, and how integrations connect.",
    icon: MessageCircleQuestion,
  },
  {
    id: "architecture-cheat-sheet",
    title: "Architecture Cheat Sheet",
    filename: "SnapServe-Webinar-Architecture-Cheat-Sheet.pdf",
    description:
      "Code-verified webinar answers for architecture, agent settings, webhooks, WhatsApp, and demo warnings.",
    icon: BookOpen,
  },
] as const;

async function downloadAdminGuide(id: string, filename: string): Promise<void> {
  const token = localStorage.getItem("adminToken") ?? "";
  const response = await fetch(`${BASE}/team-guides/${id}.pdf`, {
    headers: { "X-Admin-Token": token },
  });

  if (response.status === 401 || response.status === 403) {
    localStorage.removeItem("adminToken");
    window.location.href = `${import.meta.env.BASE_URL}login`;
    throw new Error("Admin session expired");
  }
  if (!response.ok) {
    const message = (await response.text().catch(() => "")).trim();
    throw new Error(message || `Download failed (HTTP ${response.status})`);
  }

  const blobUrl = URL.createObjectURL(await response.blob());
  try {
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

export default function TeamGuidesPage() {
  const { toast } = useToast();
  const [downloading, setDownloading] = useState<string | null>(null);

  const download = async (id: string, filename: string) => {
    setDownloading(id);
    try {
      await downloadAdminGuide(id, filename);
      toast({ title: "Download started", description: filename });
    } catch (error) {
      toast({
        title: "Could not download guide",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <BookOpen className="text-primary" size={28} />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Team Guides</h1>
          <p className="text-sm text-muted-foreground">
            Admin-only webinar and Voiceathon references. Download and share them with the team.
          </p>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {GUIDES.map((guide) => {
          const Icon = guide.icon;
          const isDownloading = downloading === guide.id;
          return (
            <Card key={guide.id} className="flex flex-col">
              <CardHeader>
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="text-primary" size={22} />
                </div>
                <CardTitle>{guide.title}</CardTitle>
                <CardDescription className="leading-6">{guide.description}</CardDescription>
              </CardHeader>
              <CardContent className="mt-auto">
                <p className="font-mono text-xs text-muted-foreground">{guide.filename}</p>
              </CardContent>
              <CardFooter>
                <Button
                  className="w-full"
                  disabled={downloading !== null}
                  onClick={() => void download(guide.id, guide.filename)}
                >
                  <Download size={16} />
                  {isDownloading ? "Downloading…" : "Download PDF"}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        These files are not exposed on the customer portal. The download API checks the admin token
        before returning either PDF.
      </div>
    </div>
  );
}
