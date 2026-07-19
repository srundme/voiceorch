import { useState } from "react";
import { format } from "date-fns";
import { Link } from "wouter";
import { useEmailReport } from "@/hooks/use-admin-api";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mail, AlertTriangle } from "lucide-react";

const DAY_OPTIONS = [7, 30, 90] as const;

const TYPE_LABELS: Record<string, string> = {
  welcome: "Welcome",
  welcome_back: "Welcome back",
  password_reset: "Password reset OTP",
  password_changed: "Password changed",
  onboarding_d1: "Onboarding day 1",
  onboarding_d3: "Onboarding day 3",
  noagent_d2: "No-agent day 2",
  noagent_d4: "No-agent day 4",
  noagent_d7: "No-agent day 7",
  noagent_d14: "No-agent day 14",
  noagent_d21: "No-agent day 21",
  monthly_summary: "Monthly summary",
  invoice: "Tax invoice",
  manual: "Admin manual",
  transactional: "Other",
};

function typeLabel(t: string) {
  return TYPE_LABELS[t] ?? t.replace(/_/g, " ");
}

export default function EmailsReportPage() {
  const [days, setDays] = useState<(typeof DAY_OPTIONS)[number]>(30);
  const { data, isLoading, error } = useEmailReport(days);

  const totals = data?.totals ?? { total: 0, sent: 0, failed: 0 };
  const byType = data?.byType ?? [];
  const byDay = data?.byDay ?? [];
  const failures = data?.recentFailures ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Mail className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Email Reports</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Brevo transactional sends logged to the platform — welcome, onboarding, invoices, resets, admin.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {DAY_OPTIONS.map((d) => (
            <Button
              key={d}
              size="sm"
              variant={days === d ? "default" : "outline"}
              onClick={() => setDays(d)}
            >
              {d}d
            </Button>
          ))}
          <Button size="sm" variant="ghost" asChild>
            <Link href="/emails">View all sends →</Link>
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Failed to load email report.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Total sent (period)</p>
            <p className="text-3xl font-bold tabular-nums mt-1">{isLoading ? "—" : totals.total.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Delivered OK</p>
            <p className="text-3xl font-bold tabular-nums mt-1 text-emerald-500">
              {isLoading ? "—" : totals.sent.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Failed</p>
            <p className="text-3xl font-bold tabular-nums mt-1 text-destructive">
              {isLoading ? "—" : totals.failed.toLocaleString()}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="pt-5 space-y-3">
            <h2 className="text-sm font-semibold">By email type</h2>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : byType.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No logged sends in this period yet. New Brevo emails (welcome, onboarding, invoices, etc.) will appear here after deploy.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">OK</TableHead>
                    <TableHead className="text-right">Failed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byType.map((row) => (
                    <TableRow key={row.emailType}>
                      <TableCell>
                        <Badge variant="outline" className="font-normal">
                          {typeLabel(row.emailType)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.total}</TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-500">{row.sent}</TableCell>
                      <TableCell className="text-right tabular-nums text-destructive">{row.failed}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 space-y-3">
            <h2 className="text-sm font-semibold">Sends per day</h2>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : byDay.length === 0 ? (
              <p className="text-sm text-muted-foreground">No daily data yet.</p>
            ) : (
              <div className="max-h-[360px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Day</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">OK</TableHead>
                      <TableHead className="text-right">Failed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...byDay].reverse().map((row) => (
                      <TableRow key={row.day}>
                        <TableCell className="text-sm">{row.day}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.total}</TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-500">{row.sent}</TableCell>
                        <TableCell className="text-right tabular-nums text-destructive">{row.failed}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-5 space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <h2 className="text-sm font-semibold">Recent failures</h2>
          </div>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : failures.length === 0 ? (
            <p className="text-sm text-muted-foreground">No failures in this period.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failures.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {f.sentAt ? format(new Date(f.sentAt), "MMM d · HH:mm") : "—"}
                    </TableCell>
                    <TableCell className="text-xs font-mono">{f.toEmail}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal text-xs">
                        {typeLabel(f.emailType)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate">{f.subject}</TableCell>
                    <TableCell className="text-xs text-destructive max-w-[280px] truncate">
                      {f.errorMessage ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
