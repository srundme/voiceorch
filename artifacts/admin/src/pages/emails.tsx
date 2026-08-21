import { useState } from "react";
import { format } from "date-fns";
import { Link } from "wouter";
import { usePlatformEmails, usePlatformEmailDetail, useSendManualEmail, useEmailOpsSummary } from "@/hooks/use-admin-api";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, Mail, Send, Eye } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";
import { SectionSubNav } from "@/components/section-subnav";
import { EMAIL_TABS, OPERATIONS_TABS } from "@/lib/nav-config";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const TYPE_COLORS: Record<string, string> = {
  manual: "secondary",
  onboarding_d1: "default",
  onboarding_d3: "default",
  monthly_summary: "outline",
  welcome: "default",
  password_reset: "outline",
  wallet_topup: "outline",
  noagent_d2: "secondary",
  noagent_d4: "secondary",
  noagent_d7: "secondary",
  noagent_d14: "secondary",
  noagent_d21: "secondary",
};

function StatusDot({ status }: { status: string }) {
  if (status === "sent") return <span className="inline-flex items-center gap-1.5 text-emerald-400 text-xs"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />Sent</span>;
  return <span className="inline-flex items-center gap-1.5 text-destructive text-xs"><span className="w-1.5 h-1.5 rounded-full bg-destructive inline-block" />Failed</span>;
}

export default function EmailsPage() {
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);

  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");

  const { data, isLoading } = usePlatformEmails({ page, search: appliedSearch || undefined });
  const { data: previewEmail } = usePlatformEmailDetail(previewId);
  const sendEmail = useSendManualEmail();
  const { data: summary } = useEmailOpsSummary(30);

  const rows: any[] = data?.data ?? [];
  const total: number = data?.total ?? 0;
  const pageSize: number = data?.pageSize ?? 50;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function applySearch() {
    setPage(1);
    setAppliedSearch(search);
  }

  function handleCompose() {
    if (!composeTo || !composeSubject || !composeBody) {
      toast({ title: "All fields required", variant: "destructive" });
      return;
    }
    sendEmail.mutate(
      {
        toEmail: composeTo,
        subject: composeSubject,
        htmlBody: composeBody.includes("<") ? composeBody : composeBody.split("\n").map(l => `<p>${l}</p>`).join(""),
        emailType: "manual",
      },
      {
        onSuccess: () => {
          toast({ title: "Email sent" });
          setComposeOpen(false);
          setComposeTo("");
          setComposeSubject("");
          setComposeBody("");
        },
        onError: (e) => toast({ title: "Failed to send", description: formatApiError(e), variant: "destructive" }),
      },
    );
  }

  return (
    <div className="space-y-6">
      <SectionSubNav tabs={OPERATIONS_TABS} />
      <SectionSubNav tabs={EMAIL_TABS} />
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Mail className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-3xl font-bold tracking-tight">Emails</h1>
          <Badge variant="outline" className="font-mono">{total.toLocaleString()} logged</Badge>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setComposeOpen(true)}>
          <Send className="h-3.5 w-3.5" />
          Compose
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Sent (30d)</CardTitle></CardHeader>
          <CardContent className="text-xl font-bold font-mono">{summary?.kpis?.sent ?? "…"}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Delivered</CardTitle></CardHeader>
          <CardContent className="text-xl font-bold font-mono">{summary?.kpis?.delivered ?? "…"}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Failed</CardTitle></CardHeader>
          <CardContent className="text-xl font-bold font-mono text-destructive">{summary?.kpis?.failed ?? "…"}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground uppercase">Bounced</CardTitle></CardHeader>
          <CardContent className="text-xl font-bold font-mono">{summary?.kpis?.bounced ?? "…"}</CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="flex gap-2 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground uppercase tracking-wider">Search</label>
          <Input
            placeholder="Email, subject, or type…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applySearch()}
            className="w-72 h-9 text-sm"
          />
        </div>
        <Button size="sm" onClick={applySearch} className="h-9">Filter</Button>
        {appliedSearch && (
          <Button size="sm" variant="ghost" onClick={() => { setSearch(""); setAppliedSearch(""); setPage(1); }} className="h-9">
            Clear
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="text-xs uppercase tracking-wider font-semibold text-muted-foreground w-8">#</TableHead>
              <TableHead className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">To</TableHead>
              <TableHead className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Subject</TableHead>
              <TableHead className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Type</TableHead>
              <TableHead className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Status</TableHead>
              <TableHead className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Sent By</TableHead>
              <TableHead className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Date</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 8 }).map((__, j) => (
                    <TableCell key={j}><div className="h-4 bg-muted/40 rounded animate-pulse" /></TableCell>
                  ))}
                </TableRow>
              ))
            )}
            {!isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                  No emails sent yet.
                </TableCell>
              </TableRow>
            )}
            {!isLoading && rows.map((row) => (
              <TableRow key={row.id} className="hover:bg-muted/30 cursor-pointer" onClick={() => setPreviewId(row.id)}>
                <TableCell className="font-mono text-xs text-muted-foreground">{row.id}</TableCell>
                <TableCell>
                  <div className="text-sm font-medium">{row.toEmail}</div>
                  {row.toName && <div className="text-xs text-muted-foreground">{row.toName}</div>}
                  {row.toUserId && (
                    <Link
                      href={`/users/${row.toUserId}`}
                      className="text-[10px] text-primary hover:underline font-mono"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {row.toUserId.slice(0, 20)}…
                    </Link>
                  )}
                </TableCell>
                <TableCell className="max-w-xs">
                  <span className="text-sm line-clamp-1">{row.subject}</span>
                </TableCell>
                <TableCell>
                  <Badge variant={(TYPE_COLORS[row.emailType] as any) ?? "outline"} className="text-xs">
                    {row.emailType}
                  </Badge>
                </TableCell>
                <TableCell><StatusDot status={row.status} /></TableCell>
                <TableCell className="text-xs text-muted-foreground">{row.sentBy}</TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {format(new Date(row.sentAt), "MMM d, HH:mm")}
                </TableCell>
                <TableCell>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setPreviewId(row.id); }}>
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/20 text-xs text-muted-foreground">
            <span>Page {page} of {totalPages} ({total.toLocaleString()} total)</span>
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Email Preview Dialog */}
      <Dialog open={previewId !== null} onOpenChange={(o) => !o && setPreviewId(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-base">Email Preview</DialogTitle>
          </DialogHeader>
          {previewEmail && (
            <div className="flex-1 overflow-auto space-y-3 text-sm">
              <div className="grid grid-cols-[80px_1fr] gap-1 text-xs">
                <span className="text-muted-foreground">To:</span><span className="font-medium">{previewEmail.toEmail}{previewEmail.toName ? ` (${previewEmail.toName})` : ""}</span>
                <span className="text-muted-foreground">Subject:</span><span className="font-medium">{previewEmail.subject}</span>
                <span className="text-muted-foreground">Type:</span><Badge variant="outline" className="text-xs w-fit">{previewEmail.emailType}</Badge>
                <span className="text-muted-foreground">Sent by:</span><span>{previewEmail.sentBy}</span>
                <span className="text-muted-foreground">Date:</span><span>{format(new Date(previewEmail.sentAt), "PPP HH:mm")}</span>
                <span className="text-muted-foreground">Status:</span><StatusDot status={previewEmail.status} />
              </div>
              {previewEmail.errorMessage && (
                <div className="text-xs bg-destructive/10 border border-destructive/20 rounded p-2 text-destructive font-mono">
                  {previewEmail.errorMessage}
                </div>
              )}
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="text-xs text-muted-foreground bg-muted/30 px-3 py-1.5 border-b border-border">HTML Body</div>
                <div
                  className="p-4 prose prose-sm max-w-none overflow-auto"
                  dangerouslySetInnerHTML={{ __html: previewEmail.htmlBody }}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPreviewId(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Compose Dialog */}
      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Compose Email</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label>To (email address)</Label>
              <Input placeholder="user@example.com" value={composeTo} onChange={(e) => setComposeTo(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Subject</Label>
              <Input placeholder="Subject…" value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Body <span className="text-muted-foreground text-xs">(plain text or HTML)</span></Label>
              <Textarea
                placeholder="Write your message here. Plain text is auto-wrapped in <p> tags. Paste HTML for rich formatting."
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
                className="min-h-[180px] font-mono text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setComposeOpen(false)}>Cancel</Button>
            <Button onClick={handleCompose} disabled={sendEmail.isPending} className="gap-1.5">
              <Send className="h-3.5 w-3.5" />
              {sendEmail.isPending ? "Sending…" : "Send Email"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
