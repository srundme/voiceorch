import { useMemo } from "react";
import { Link, useParams } from "wouter";
import { useWorkshopAnalytics, useWorkshopResponses } from "@/hooks/use-admin-api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { ArrowLeft, Download, Star, ThumbsUp, ThumbsDown, Trophy, TriangleAlert } from "lucide-react";

function Kpi({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold font-mono tabular-nums ${accent ?? ""}`}>{value}</div>
        {hint ? <p className="text-[11px] text-muted-foreground mt-1">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

type Tally = { label: string; count: number };

function TallyBars({ title, description, data, color = "#a78bfa" }: {
  title: string;
  description?: string;
  data: Tally[];
  color?: string;
}) {
  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No responses yet.</p>
        </CardContent>
      </Card>
    );
  }
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-2.5">
        {data.map((d) => (
          <div key={d.label} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="truncate pr-2">{d.label}</span>
              <span className="font-mono text-muted-foreground">{d.count}</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${(d.count / max) * 100}%`, background: color }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

const nf = (n: number | null | undefined, suffix = "") =>
  n == null ? "—" : `${n}${suffix}`;

function toCsv(rows: any[]): string {
  if (!rows.length) return "";
  const flat = rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    name: r.name ?? "",
    email: r.email ?? "",
    phone: r.phone ?? "",
    college: r.college ?? "",
    department: r.department ?? "",
    yearOrExperience: r.yearOrExperience ?? "",
    city: r.city ?? "",
    describesYou: r.audienceProfile?.describesYou ?? "",
    aiExperience: r.audienceProfile?.aiExperience ?? "",
    overallSatisfaction: r.eventExperience?.overallSatisfaction ?? "",
    nps: r.nps ?? "",
    careerHelp: r.careerImpact?.careerHelp ?? "",
    canContact: r.futureEngagement?.canContact ?? "",
    futureInterests: (r.futureEngagement?.interests ?? []).join(" | "),
    futureTopics: (r.futureTopics ?? []).join(" | "),
    outcomes: (r.outcomes ?? []).join(" | "),
    productTryLikelihood: r.productFeedback?.tryLikelihood ?? "",
    liked: r.openFeedback?.liked ?? "",
    improve: r.openFeedback?.improve ?? "",
    suggestions: r.openFeedback?.suggestions ?? "",
  }));
  const headers = Object.keys(flat[0]);
  const escape = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...flat.map((row) => headers.map((h) => escape((row as any)[h])).join(","))].join(
    "\n",
  );
}

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const eventId = Number(id);
  const { data, isLoading, error } = useWorkshopAnalytics(Number.isInteger(eventId) ? eventId : null);
  const { data: responses } = useWorkshopResponses(Number.isInteger(eventId) ? eventId : null);

  const ev = data?.event;
  const s = data?.summary;

  const sessionChart = useMemo(
    () => (data?.sessions ?? []).map((x: any) => ({ name: x.name, avg: x.avg ?? 0, count: x.count })),
    [data],
  );

  const exportCsv = () => {
    const csv = toCsv(responses ?? []);
    if (!csv) return;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workshop-${ev?.slug ?? eventId}-responses.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (error) {
    return (
      <div className="space-y-4">
        <Link href="/events" className="text-sm text-primary hover:underline inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Back to workshops
        </Link>
        <Card>
          <CardContent className="py-8 text-center text-destructive">
            Failed to load analytics.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/events"
            className="text-sm text-primary hover:underline inline-flex items-center gap-1 mb-2"
          >
            <ArrowLeft className="h-4 w-4" /> Back to workshops
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">
            {isLoading ? "…" : ev?.title ?? "Workshop"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {ev?.college ? `${ev.college} · ` : ""}
            {ev?.eventDate ? new Date(ev.eventDate).toLocaleDateString("en-IN") : "no date"} · {ev?.mode}
            {ev ? (
              <>
                {" · "}
                <Badge variant={ev.status === "open" ? "default" : "secondary"}>{ev.status}</Badge>
              </>
            ) : null}
          </p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={!responses?.length}>
          <Download className="h-4 w-4 mr-1.5" /> Export CSV
        </Button>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Kpi label="Responses" value={isLoading ? "…" : String(s?.responseCount ?? 0)} />
        <Kpi
          label="Attendance rate"
          value={isLoading ? "…" : nf(s?.attendanceRate, "%")}
          hint={`${ev?.attendeesCount ?? 0} / ${ev?.registrationsCount ?? 0}`}
        />
        <Kpi
          label="Feedback rate"
          value={isLoading ? "…" : nf(s?.feedbackResponseRate, "%")}
          hint="responses / attendees"
        />
        <Kpi
          label="Avg satisfaction"
          value={isLoading ? "…" : nf(s?.avgSatisfaction, " / 5")}
          accent="text-amber-500"
        />
        <Kpi
          label="NPS"
          value={isLoading ? "…" : s?.npsScore == null ? "—" : String(s.npsScore)}
          hint={
            s
              ? `${s.promoters}P · ${s.passives}N · ${s.detractors}D (${s.npsRespondents})`
              : undefined
          }
          accent={(s?.npsScore ?? 0) >= 0 ? "text-emerald-500" : "text-destructive"}
        />
        <Kpi
          label="Speaker rating"
          value={isLoading ? "…" : nf(s?.speakerRating, " / 5")}
        />
      </div>

      {/* Learning + lead-gen KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Kpi label="Learning impact" value={isLoading ? "…" : nf(s?.learningImpactAvg, " / 5")} />
        <Kpi label="Career relevance" value={isLoading ? "…" : nf(s?.careerRelevancePct, "%")} hint="helps career" />
        <Kpi label="Confidence to try" value={isLoading ? "…" : nf(s?.confidencePct, "%")} />
        <Kpi label="Follow-up OK" value={isLoading ? "…" : nf(s?.followUpPct, "%")} hint="can contact" />
        <Kpi
          label="Internship / placement"
          value={isLoading ? "…" : nf(s?.internshipPlacementPct, "%")}
        />
        <Kpi label="Product interest" value={isLoading ? "…" : nf(s?.productInterestPct, "%")} hint="would try SnapServe" />
      </div>

      {/* Session ratings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Session ratings</CardTitle>
          <CardDescription>Average rating (1-5) per session.</CardDescription>
        </CardHeader>
        <CardContent>
          {sessionChart.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No sessions configured, or no ratings yet.
            </p>
          ) : (
            <>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sessionChart} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis type="number" domain={[0, 5]} tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Bar dataKey="avg" name="Avg rating" radius={[0, 4, 4, 0]}>
                      {sessionChart.map((_: any, i: number) => (
                        <Cell key={i} fill="#a78bfa" />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                {data?.topSession ? (
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                    <Trophy className="h-4 w-4 text-emerald-500 shrink-0" />
                    <div className="text-sm">
                      <span className="text-muted-foreground">Top rated: </span>
                      <span className="font-medium">{data.topSession.name}</span>{" "}
                      <span className="font-mono">({data.topSession.avg} / 5)</span>
                    </div>
                  </div>
                ) : null}
                {data?.lowestSession ? (
                  <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                    <TriangleAlert className="h-4 w-4 text-amber-500 shrink-0" />
                    <div className="text-sm">
                      <span className="text-muted-foreground">Lowest rated: </span>
                      <span className="font-medium">{data.lowestSession.name}</span>{" "}
                      <span className="font-mono">({data.lowestSession.avg} / 5)</span>
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Event experience + learning impact breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-1.5">
              <Star className="h-4 w-4" /> Event experience
            </CardTitle>
            <CardDescription>Average rating (1-5) per metric.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {(data?.eventExperience ?? []).map((m: any) => (
              <div key={m.key} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="truncate pr-2">{m.label}</span>
                  <span className="font-mono text-muted-foreground">{m.avg ?? "—"} / 5</span>
                </div>
                <Progress value={((m.avg ?? 0) / 5) * 100} />
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Learning impact</CardTitle>
            <CardDescription>Average agreement (1-5) per statement.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {(data?.learningImpact ?? []).map((m: any) => (
              <div key={m.key} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="truncate pr-2">{m.label}</span>
                  <span className="font-mono text-muted-foreground">{m.avg ?? "—"} / 5</span>
                </div>
                <Progress value={((m.avg ?? 0) / 5) * 100} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Interests / topics / outcomes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TallyBars
          title="Top requested future topics"
          description="What attendees want next."
          data={data?.topFutureTopics ?? []}
          color="#34d399"
        />
        <TallyBars
          title="Workshop outcomes"
          description="What attendees say they got out of it."
          data={data?.outcomes ?? []}
          color="#fbbf24"
        />
        <TallyBars
          title="Career & business interests"
          data={data?.careerInterests ?? []}
          color="#60a5fa"
        />
        <TallyBars
          title="Future engagement interest"
          description="Internships, placements, projects, hackathons…"
          data={data?.futureEngagementInterests ?? []}
          color="#f472b6"
        />
        <TallyBars
          title="Audience — who attended"
          data={data?.audienceProfile?.describesYou ?? []}
          color="#a78bfa"
        />
        <TallyBars
          title="Audience — AI experience"
          data={data?.audienceProfile?.aiExperience ?? []}
          color="#c084fc"
        />
      </div>

      {/* Product feedback */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">SnapServe product feedback</CardTitle>
          <CardDescription>Interest signal from attendees for the product.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Kpi label="Would try" value={nf(data?.productFeedback?.tryLikelihoodAvg, " / 5")} />
            <Kpi label="Looked easy" value={nf(data?.productFeedback?.easeLookedAvg, " / 5")} />
            <Kpi label="Would recommend" value={nf(data?.productFeedback?.wouldRecommendAvg, " / 5")} />
            <Kpi label="Product interest" value={nf(data?.productFeedback?.productInterestPct, "%")} />
          </div>
          {(data?.productFeedback?.featureInterest ?? []).length > 0 ? (
            <div className="mt-4">
              <p className="text-xs text-muted-foreground mb-2">Most-wanted features</p>
              <div className="flex flex-wrap gap-2">
                {(data?.productFeedback?.featureInterest ?? []).map((f: Tally) => (
                  <Badge key={f.label} variant="secondary">
                    {f.label} · {f.count}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Open feedback */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Open feedback</CardTitle>
          <CardDescription>Verbatim comments from attendees.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(data?.openFeedback ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No written feedback yet.</p>
          ) : (
            (data?.openFeedback ?? []).map((f: any, i: number) => (
              <div key={i} className="rounded-lg border border-border p-3 space-y-1.5 text-sm">
                <div className="text-[11px] text-muted-foreground">
                  {f.name || "Anonymous"} · {new Date(f.createdAt).toLocaleDateString("en-IN")}
                </div>
                {f.liked ? (
                  <p className="flex gap-1.5">
                    <ThumbsUp className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                    <span>{f.liked}</span>
                  </p>
                ) : null}
                {f.improve ? (
                  <p className="flex gap-1.5">
                    <ThumbsDown className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                    <span>{f.improve}</span>
                  </p>
                ) : null}
                {f.suggestions ? (
                  <p className="text-muted-foreground pl-5">{f.suggestions}</p>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Responses / leads table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Responses & leads</CardTitle>
            <CardDescription>Every submission with contact details for follow-up.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!responses?.length}>
            <Download className="h-4 w-4 mr-1.5" /> CSV
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>College / Dept</TableHead>
                <TableHead className="text-center">NPS</TableHead>
                <TableHead className="text-center">Contact OK</TableHead>
                <TableHead className="text-right">Submitted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(responses ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No responses yet.
                  </TableCell>
                </TableRow>
              ) : (
                (responses ?? []).map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.email}</TableCell>
                    <TableCell className="font-mono text-xs">{r.phone || "—"}</TableCell>
                    <TableCell className="text-xs">
                      {[r.college, r.department].filter(Boolean).join(" · ") || "—"}
                    </TableCell>
                    <TableCell className="text-center font-mono">{r.nps ?? "—"}</TableCell>
                    <TableCell className="text-center">
                      {r.futureEngagement?.canContact === "Yes" ? (
                        <Badge variant="default">Yes</Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleString("en-IN")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
