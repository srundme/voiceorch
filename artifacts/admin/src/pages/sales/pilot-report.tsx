import { Link } from "wouter";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBlock, LoadingBlock, touch } from "@/components/sales/sales-ui";
import { usePilotReport } from "@/hooks/use-sales-api";
import { formatCount, formatDateTimeIST, formatPercent } from "@/lib/sales-format";
import type { ReportMetric, ReportRate } from "@/lib/sales-types";

const METRIC_LABELS: Record<string, string> = {
  attempts: "Call attempts",
  distinctRecords: "Distinct records dialled",
  answered: "Answered calls",
  meaningfulConversations: "Meaningful conversations",
  qualifiedPeople: "Qualified people",
  acceptedOutcomes: "Accepted outcomes",
  callbackRequests: "Callback requests",
  confirmedAppointments: "Confirmed appointments",
  connectedMinutes: "Connected minutes",
};

const RATE_LABELS: Record<string, string> = {
  answerRate: "Answer rate",
  meaningfulRate: "Meaningful conversation rate",
  qualifiedRate: "Qualified rate",
  acceptedRate: "Accepted outcome rate",
  callbackRate: "Callback request rate",
  appointmentRate: "Confirmed appointment rate",
};

function metricText(m: ReportMetric | undefined) {
  if (!m || m.insufficientData || m.value == null) return "Insufficient data";
  return formatCount(m.value);
}

function rateText(r: ReportRate | undefined) {
  if (!r || r.insufficientData || r.value == null) return { main: "Insufficient data", sub: r ? `${formatCount(r.numerator)} / ${formatCount(r.denominator)}` : "" };
  return { main: formatPercent(r.value, 1), sub: `${formatCount(r.numerator)} / ${formatCount(r.denominator)}` };
}

export default function PilotReportPage({ id }: { id: number }) {
  const report = usePilotReport(id);

  if (report.isLoading) return <LoadingBlock rows={8} className="mx-auto max-w-3xl p-6" />;
  if (report.error) return <ErrorBlock error={report.error} onRetry={() => report.refetch()} className="mx-auto max-w-3xl p-6" />;
  const r = report.data;
  if (!r) return null;

  return (
    <div className="min-h-dvh bg-background print:bg-white">
      <div className="sales-no-print sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-background/95 px-4 py-2 backdrop-blur">
        <Link href={`/sales/pilots/${id}`} className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to pilot
        </Link>
        <Button className={touch} onClick={() => window.print()}>
          <Printer className="mr-1.5 h-4 w-4" /> Print / Save PDF
        </Button>
      </div>

      <article className="sales-report mx-auto max-w-3xl space-y-6 p-6 text-sm">
        <header className="space-y-1 border-b border-border pb-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">SnapServe pilot report</p>
          <h1 className="text-2xl font-semibold">{r.company.name}</h1>
          <p className="text-muted-foreground">{[r.company.sector, r.company.city].filter(Boolean).join(" · ")}</p>
          <p className="text-xs text-muted-foreground">
            Status: {r.pilot.status} · Data as of {r.dataAsOf ? formatDateTimeIST(r.dataAsOf) : "— (no data yet)"} · Generated {formatDateTimeIST(r.generatedAt)} IST
          </p>
        </header>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Pilot scope</h2>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {(
              [
                ["Use case", r.pilot.useCase],
                ["Language", r.pilot.language],
                ["Qualification criteria", r.pilot.qualificationCriteria],
                ["Leads provided", r.pilot.leadCount != null ? formatCount(r.pilot.leadCount) : null],
                ["Calling started", r.pilot.campaignStartedAt ? formatDateTimeIST(r.pilot.campaignStartedAt) : null],
                ["Calling window", r.pilot.windowStart ? `${formatDateTimeIST(r.pilot.windowStart)} → ${formatDateTimeIST(r.pilot.windowEnd)}` : null],
                ["Review", r.pilot.reviewAt ? formatDateTimeIST(r.pilot.reviewAt) : null],
                ["Completed", r.pilot.completedAt ? formatDateTimeIST(r.pilot.completedAt) : null],
              ] as Array<[string, string | null]>
            ).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="whitespace-pre-wrap">{v ?? "—"}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Results</h2>
          {!r.hasData && <p className="rounded-md border border-dashed border-border p-3 text-muted-foreground">Insufficient data — no calling results have been recorded yet.</p>}
          <table className="w-full border-collapse text-left">
            <tbody>
              {Object.entries(METRIC_LABELS).map(([k, label]) => (
                <tr key={k} className="border-b border-border">
                  <td className="py-1.5">{label}</td>
                  <td className="py-1.5 text-right tabular-nums">{metricText(r.metrics[k])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Rates</h2>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="py-1.5 font-normal">Rate</th>
                <th className="py-1.5 text-right font-normal">Value</th>
                <th className="py-1.5 text-right font-normal">Numerator / denominator</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(RATE_LABELS).map(([k, label]) => {
                const t = rateText(r.rates[k]);
                return (
                  <tr key={k} className="border-b border-border">
                    <td className="py-1.5">
                      {label}
                      {r.rates[k]?.label && <div className="text-[11px] text-muted-foreground">{r.rates[k]!.label}</div>}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{t.main}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">{t.sub}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-[11px] text-muted-foreground">{r.rules.rates}</p>
          <p className="text-[11px] text-muted-foreground">{r.rules.callbacksAndAppointments}</p>
        </section>

        <section className="space-y-1">
          <h2 className="text-base font-semibold">Attempt allowance</h2>
          <p>
            {r.allowance.attemptsUsed == null ? "Insufficient data" : formatCount(r.allowance.attemptsUsed)} of {formatCount(r.allowance.revisedAllowance)} attempts used
            {r.allowance.extensionAttempts ? ` (base ${formatCount(r.allowance.baseAllowance)} + extension ${formatCount(r.allowance.extensionAttempts)})` : ""}.
          </p>
          {r.allowance.overAllowance && <p>Over the allowance by {formatCount(r.allowance.overBy)} attempts.</p>}
          {r.extension?.reviewAt && <p className="text-xs text-muted-foreground">Extension review: {formatDateTimeIST(r.extension.reviewAt)}</p>}
          <p className="text-[11px] text-muted-foreground">{r.allowance.note}</p>
        </section>

        {(r.buyerFeedback || r.acceptedOutcomes || r.proposedNextStep || r.notes) && (
          <section className="space-y-2">
            <h2 className="text-base font-semibold">Review</h2>
            {(
              [
                ["Your feedback", r.buyerFeedback],
                ["Accepted outcomes", r.acceptedOutcomes],
                ["Proposed next step", r.proposedNextStep],
                ["Notes", r.notes],
              ] as Array<[string, string | null]>
            )
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k}>
                  <p className="text-xs text-muted-foreground">{k}</p>
                  <p className="whitespace-pre-wrap">{v}</p>
                </div>
              ))}
          </section>
        )}

        {r.recordingLinks.length > 0 && (
          <section className="space-y-1">
            <h2 className="text-base font-semibold">Call recordings</h2>
            <ul className="list-disc pl-5">
              {r.recordingLinks.map((l) => (
                <li key={l.url}>
                  <a href={l.url} className="underline" target="_blank" rel="noopener noreferrer">
                    {l.label || l.url}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="border-t border-border pt-3 text-[11px] text-muted-foreground">All times are India Standard Time (IST). Figures come from the latest calling-system snapshot.</footer>
      </article>
    </div>
  );
}
