import { useEffect, useMemo, useState } from "react";
import { useRoute } from "wouter";
import { AlertCircle, Briefcase, ClipboardList, FileText, Loader2, Mic, UserRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  DND_OPTIONS,
  ENGLISH_OPTIONS,
  GENDER_OPTIONS,
  INDUSTRY_OPTIONS,
  QUALIFICATION_OPTIONS,
  SHIFT_BASE_OPTIONS,
  SKILL_OPTIONS,
  SKILL_ROLE_OPTIONS,
  WORK_STATUS_OPTIONS,
  cityOptionsWith,
  fieldToInputValue,
  intakeProgress,
  isFieldFilled,
  type IntakeDisposition,
  type IntakeDispositionField,
  type IntakeFieldKey,
} from "./intake-contract";
import { useIntakeLive } from "./use-intake-live";

const PROFILE_ROWS: ReadonlyArray<[label: string, key: string]> = [
  ["Name", "name"],
  ["Mobile", "phone"],
  ["Email", "email"],
  ["Gender", "gender"],
  ["Date of birth", "dateOfBirth"],
  ["Lives in", "city"],
  ["Pincode", "pincode"],
  ["Work city", "jobCity"],
  ["Work status", "workStatus"],
  ["Companies", "totalCompanies"],
  ["Qualification", "qualification"],
  ["Shift", "shiftBase"],
  ["English", "englishCommunication"],
  ["Role", "skillRole"],
  ["Skill", "skill"],
  ["Industry", "industry"],
  ["DND", "dnd"],
];

/**
 * The record the recruiter keeps once the call is over.
 *
 * Recording and transcript land a moment after hangup, so this renders as soon
 * as the form closes and fills in the two artifacts when they arrive rather
 * than waiting for everything at once.
 */
function CandidateProfileCard({ profile }: { profile: Record<string, unknown> }) {
  const text = (key: string): string => {
    if (key === "name") {
      return [profile["firstName"], profile["lastName"]].filter(Boolean).join(" ") || "—";
    }
    const value = profile[key];
    return value === null || value === undefined || value === "" ? "—" : String(value);
  };

  const recordingUrl = typeof profile["recordingUrl"] === "string" ? profile["recordingUrl"] : null;
  const transcript = typeof profile["transcript"] === "string" ? profile["transcript"] : null;
  const outcomes = Array.isArray(profile["dispositionIds"])
    ? (profile["dispositionIds"] as unknown[]).map(String)
    : [];
  const evidence = Array.isArray(profile["englishEvidence"])
    ? (profile["englishEvidence"] as unknown[]).map(String)
    : [];

  return (
    <div className="mt-5 overflow-hidden rounded-2xl border border-indigo-100 bg-white p-1.5 shadow-sm">
      <div className="rounded-xl bg-gradient-to-r from-slate-300 to-slate-300/70 px-5 py-3.5">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-indigo-700" />
          <h1 className="text-[15px] font-bold text-slate-900">Candidate profile</h1>
        </div>
        <p className="mt-0.5 text-[11.5px] text-slate-600">
          Created when the form closed — everything captured on this call
        </p>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-6 md:grid-cols-4 md:px-5">
        {PROFILE_ROWS.map(([label, key]) => (
          <div key={key}>
            <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
            <p className="text-[13px] font-medium text-slate-800">{text(key)}</p>
          </div>
        ))}
      </div>

      {outcomes.length > 0 ? (
        <div className="border-t border-slate-100 px-4 py-4 md:px-5">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">Outcomes</p>
          <p className="mt-1 text-[13px] text-slate-800">{outcomes.join(", ")}</p>
        </div>
      ) : null}

      {evidence.length > 0 ? (
        <div className="border-t border-slate-100 px-4 py-4 md:px-5">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">English assessment notes</p>
          <p className="mt-1 text-[12.5px] text-slate-700">{evidence.join(" · ")}</p>
        </div>
      ) : null}

      <div className="border-t border-slate-100 px-4 py-4 md:px-5">
        <p className="text-[11px] uppercase tracking-wide text-slate-400">Call recording</p>
        {recordingUrl ? (
          <audio controls preload="none" src={recordingUrl} className="mt-2 w-full max-w-md" />
        ) : (
          <p className="mt-1 text-[12.5px] text-slate-500">
            Not attached yet — it appears a few seconds after the call ends.
          </p>
        )}
      </div>

      <div className="border-t border-slate-100 px-4 py-4 md:px-5">
        <p className="text-[11px] uppercase tracking-wide text-slate-400">Transcript</p>
        {transcript ? (
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-slate-700">
            {transcript}
          </pre>
        ) : (
          <p className="mt-1 text-[12.5px] text-slate-500">
            Not attached yet — it appears a few seconds after the call ends.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Live candidate intake form.
 *
 * Opened on a screen during an inbound call: the voice agent asks each question
 * and writes the answer, which appears here without a reload. Operators can
 * still correct any field by hand. English communication is scored after the
 * call, so it is the one field the agent never fills.
 */

// ── Field chrome ─────────────────────────────────────────────────────────────

const FIELD_BASE =
  "h-11 rounded-xl border border-slate-200 bg-white text-[13px] font-medium text-slate-800 shadow-none";
const FIELD_FILLED = "border-l-4 border-l-indigo-500";
const FIELD_FLASH = "ring-2 ring-indigo-400/70 border-indigo-300";
const FIELD_ERROR = "border-red-300 ring-2 ring-red-200";

function fieldClass(opts: { filled: boolean; flashing: boolean; invalid: boolean }): string {
  return cn(
    FIELD_BASE,
    "transition-shadow duration-200",
    opts.filled && FIELD_FILLED,
    opts.flashing && FIELD_FLASH,
    opts.invalid && FIELD_ERROR,
  );
}

function Field({
  label,
  htmlFor,
  error,
  hint,
  required = true,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="flex items-center gap-1 text-[12.5px] font-medium text-slate-700">
        <span>{label}</span>
        {required ? <span aria-hidden className="text-red-500">*</span> : null}
      </label>
      {children}
      {error ? (
        <p role="alert" className="flex items-center gap-1 text-[11.5px] font-medium text-red-600">
          <AlertCircle className="h-3 w-3" />
          {error}
        </p>
      ) : hint ? (
        <p className="text-[11.5px] text-slate-400">{hint}</p>
      ) : null}
    </div>
  );
}

function SectionCard({
  icon,
  title,
  subtitle = "All fields are required",
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-indigo-100 bg-white p-1.5 shadow-sm">
      <div className="rounded-xl bg-gradient-to-r from-slate-300 to-slate-300/70 px-5 py-3.5">
        <div className="flex items-center gap-2">
          {icon}
          <h1 className="text-[15px] font-bold text-slate-900">{title}</h1>
        </div>
        <p className="mt-0.5 text-[11.5px] text-slate-600">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function selectOptionsWith(options: readonly string[], current: string): string[] {
  if (!current || options.includes(current)) return [...options];
  return [current, ...options];
}

function RadioPills({
  fieldId,
  options,
  value,
  flashing,
  disabled,
  onPick,
}: {
  fieldId: string;
  options: readonly string[];
  value: string;
  flashing: boolean;
  disabled: boolean;
  onPick: (value: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={fieldId}
      className={cn("mt-1 flex flex-wrap gap-3 rounded-xl", flashing && "ring-2 ring-indigo-400/70")}
    >
      {options.map((option) => {
        const selected = value === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onPick(option)}
            className={cn(
              "flex items-center gap-2 rounded-full border px-4 py-2.5 text-[13px] font-medium transition-colors disabled:opacity-60",
              selected
                ? "border-indigo-400 bg-indigo-50 text-indigo-900"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "grid h-4 w-4 place-items-center rounded-full border-2",
                selected ? "border-indigo-600" : "border-slate-300",
              )}
            >
              {selected ? <span className="h-2 w-2 rounded-full bg-indigo-600" /> : null}
            </span>
            {option}
          </button>
        );
      })}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function IntakeFormPage() {
  const [, params] = useRoute("/intake/:token");
  const token = params?.token ?? "";

  const {
    intake,
    dispositions,
    loading,
    loadError,
    connection,
    flash,
    fieldErrors,
    saving,
    markEditing,
    writeField,
    writeExtra,
    setDispositionIds,
    complete,
  } = useIntakeLive(token);

  /** Text inputs are buffered locally and committed on blur / Enter. */
  const [drafts, setDrafts] = useState<Partial<Record<IntakeFieldKey, string>>>({});
  const [extraDrafts, setExtraDrafts] = useState<Record<string, string>>({});
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Candidate intake · SnapServe";
    return () => {
      document.title = "SnapServe";
    };
  }, []);

  const fields = intake?.fields;
  const selectedIds = intake?.dispositionIds ?? [];
  const selectedDispositions: IntakeDisposition[] = selectedIds
    .map((id) => dispositions.find((d) => d.id === id))
    .filter((d): d is IntakeDisposition => d != null);

  const progress = useMemo(
    () => intakeProgress(
      fields ?? {},
      selectedDispositions.length > 0
        ? {
            // Namespaced so `reason` under two outcomes counts twice, which is
            // what the recruiter actually has to fill.
            requiredIds: selectedDispositions.flatMap((d) =>
              d.fields.filter((f) => f.required).map((f) => `${d.id}.${f.id}`),
            ),
            answers: Object.fromEntries(
              Object.entries(intake?.dispositionAnswers ?? {}).flatMap(([dispId, bucket]) =>
                Object.entries(bucket).map(([fieldId, value]) => [`${dispId}.${fieldId}`, value]),
              ),
            ),
          }
        : undefined,
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fields, selectedIds.join(","), intake?.dispositionAnswers],
  );

  const valueOf = (key: IntakeFieldKey): string =>
    drafts[key] ?? fieldToInputValue(fields?.[key] ?? null);

  const textProps = (key: IntakeFieldKey) => ({
    value: valueOf(key),
    onFocus: () => markEditing(key, true),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setDrafts((d) => ({ ...d, [key]: e.target.value })),
    onBlur: () => {
      markEditing(key, false);
      const next = drafts[key];
      setDrafts((d) => {
        const { [key]: _drop, ...rest } = d;
        return rest;
      });
      if (next === undefined) return;
      if (next === fieldToInputValue(fields?.[key] ?? null)) return;
      void writeField(key, next.trim() === "" ? null : next);
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") e.currentTarget.blur();
    },
    className: fieldClass({
      filled: isFieldFilled(fields?.[key] ?? null),
      flashing: Boolean(flash[key]),
      invalid: Boolean(fieldErrors[key]),
    }),
  });

  const selectClass = (key: IntakeFieldKey) =>
    cn(
      fieldClass({
        filled: isFieldFilled(fields?.[key] ?? null),
        flashing: Boolean(flash[key]),
        invalid: Boolean(fieldErrors[key]),
      }),
      "px-3",
    );

  /** Every disposition answer is addressed as `<disposition>.<field>`. */
  const answerAt = (key: string): string | number | null => {
    if (key === "pincode") return intake?.pincode ?? null;
    const dot = key.indexOf(".");
    if (dot <= 0) return null;
    return intake?.dispositionAnswers?.[key.slice(0, dot)]?.[key.slice(dot + 1)] ?? null;
  };

  const extraValueOf = (key: string): string =>
    extraDrafts[key] ?? fieldToInputValue(answerAt(key));

  const extraChrome = (key: string) =>
    fieldClass({
      filled: isFieldFilled(answerAt(key)),
      flashing: Boolean(flash[key]),
      invalid: Boolean(fieldErrors[key]),
    });

  const commitExtra = (key: string) => {
    markEditing(key, false);
    const next = extraDrafts[key];
    setExtraDrafts((d) => {
      const { [key]: _drop, ...rest } = d;
      return rest;
    });
    if (next === undefined) return;
    if (next === fieldToInputValue(answerAt(key))) return;
    void writeExtra(key, next.trim() === "" ? null : next);
  };

  const extraTextProps = (key: string) => ({
    value: extraValueOf(key),
    onFocus: () => markEditing(key, true),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setExtraDrafts((d) => ({ ...d, [key]: e.target.value })),
    onBlur: () => commitExtra(key),
    className: extraChrome(key),
  });

  const renderDispositionField = (dispositionId: string, spec: IntakeDispositionField) => {
    const key = `${dispositionId}.${spec.id}`;
    const current = fieldToInputValue(answerAt(key));
    const options = spec.options ?? [];
    const freeText = spec.type === "text" || spec.type === "textarea"
      || (spec.type === "select" && options.length === 0);

    if (spec.type === "radio" && options.length > 0) {
      return (
        <Field key={key} label={spec.label} error={fieldErrors[key]} required={spec.required}>
          <RadioPills
            fieldId={key}
            options={options}
            value={current}
            flashing={Boolean(flash[key])}
            disabled={Boolean(saving[key])}
            onPick={(v) => void writeExtra(key, v)}
          />
        </Field>
      );
    }

    if (spec.type === "select" && !freeText) {
      return (
        <Field key={key} label={spec.label} error={fieldErrors[key]} required={spec.required}>
          <Select
            value={current || undefined}
            onValueChange={(v) => void writeExtra(key, v)}
          >
            <SelectTrigger className={cn(extraChrome(key), "px-3")} aria-label={spec.label}>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {selectOptionsWith(options, current).map((option) => (
                <SelectItem key={option} value={option}>{option}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      );
    }

    if (spec.type === "date") {
      return (
        <Field key={key} label={spec.label} htmlFor={key} error={fieldErrors[key]} required={spec.required}>
          <Input
            id={key}
            type="date"
            value={current}
            onChange={(e) => void writeExtra(key, e.target.value || null)}
            className={extraChrome(key)}
          />
        </Field>
      );
    }

    if (spec.type === "time") {
      return (
        <Field key={key} label={spec.label} htmlFor={key} error={fieldErrors[key]} required={spec.required}>
          <Input
            id={key}
            type="time"
            value={current}
            onChange={(e) => void writeExtra(key, e.target.value || null)}
            className={extraChrome(key)}
          />
        </Field>
      );
    }

    if (spec.type === "textarea") {
      return (
        <Field key={key} label={spec.label} htmlFor={key} error={fieldErrors[key]} required={spec.required}>
          <Textarea
            id={key}
            rows={3}
            {...extraTextProps(key)}
            className={cn(extraChrome(key), "min-h-[88px] py-2")}
          />
        </Field>
      );
    }

    return (
      <Field key={key} label={spec.label} htmlFor={key} error={fieldErrors[key]} required={spec.required}>
        <Input
          id={key}
          inputMode={spec.type === "number" ? "numeric" : "text"}
          autoComplete="off"
          {...extraTextProps(key)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      </Field>
    );
  };

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f5f6fb]">
        <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
      </main>
    );
  }

  if (loadError || !intake) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f5f6fb] px-4">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <AlertCircle className="mx-auto h-8 w-8 text-red-500" />
          <h1 className="mt-3 text-lg font-semibold text-slate-900">Form unavailable</h1>
          <p className="mt-1 text-sm text-slate-500">{loadError ?? "This intake link is not valid."}</p>
        </div>
      </main>
    );
  }

  const isCompleted = intake.status === "completed";
  const english = fieldToInputValue(intake.fields.englishCommunication ?? null);

  const onCloseForm = async () => {
    setClosing(true);
    setCloseError(null);
    try {
      await complete(english || null);
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : "Could not close the form");
    } finally {
      setClosing(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#f5f6fb] px-4 py-6 md:py-10">
      <div className="mx-auto max-w-5xl">
        {/* Live status strip */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[12.5px] font-medium">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                connection === "live" ? "bg-emerald-500" : "bg-amber-500",
              )}
              aria-hidden
            />
            <span className="text-slate-600" aria-live="polite">
              {connection === "live"
                ? isCompleted
                  ? "Call ended · form closed"
                  : "Live — filling from the call"
                : "Reconnecting…"}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[12.5px] text-slate-500">
            <span className="font-mono">
              {progress.filled}/{progress.total} captured
            </span>
            {intake.callId ? <span className="font-mono">call #{intake.callId}</span> : null}
          </div>
        </div>

        <div className="space-y-5">
        <SectionCard icon={<UserRound className="h-4 w-4 text-indigo-700" />} title="Customer Details">
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 px-4 py-6 md:grid-cols-3 md:px-5">
            <Field label="First Name" htmlFor="firstName" error={fieldErrors["firstName"]}>
              <Input id="firstName" autoComplete="off" {...textProps("firstName")} />
            </Field>

            <Field label="Last Name" htmlFor="lastName" error={fieldErrors["lastName"]}>
              <Input id="lastName" autoComplete="off" {...textProps("lastName")} />
            </Field>

            <Field label="Phone" htmlFor="phone" error={fieldErrors["phone"]}>
              <Input id="phone" inputMode="tel" autoComplete="off" {...textProps("phone")} />
            </Field>

            <Field label="Email" htmlFor="email" error={fieldErrors["email"]}>
              <Input id="email" inputMode="email" autoComplete="off" {...textProps("email")} />
            </Field>

            <Field label="Gender" error={fieldErrors["gender"]}>
              <Select
                value={fieldToInputValue(intake.fields.gender ?? null) || undefined}
                onValueChange={(v) => void writeField("gender", v)}
              >
                <SelectTrigger className={selectClass("gender")} aria-label="Gender">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {GENDER_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Date of Birth" htmlFor="dateOfBirth" error={fieldErrors["dateOfBirth"]}>
              {/* A picked date never blurs the input, so commit on change. */}
              <Input
                id="dateOfBirth"
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={fieldToInputValue(intake.fields.dateOfBirth ?? null)}
                onChange={(e) => void writeField("dateOfBirth", e.target.value || null)}
                className={fieldClass({
                  filled: isFieldFilled(intake.fields.dateOfBirth ?? null),
                  flashing: Boolean(flash["dateOfBirth"]),
                  invalid: Boolean(fieldErrors["dateOfBirth"]),
                })}
              />
            </Field>

            <Field label="Work Status" error={fieldErrors["workStatus"]}>
              <Select
                value={fieldToInputValue(intake.fields.workStatus ?? null) || undefined}
                onValueChange={(v) => void writeField("workStatus", v)}
              >
                <SelectTrigger className={selectClass("workStatus")} aria-label="Work Status">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {WORK_STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Total Companies"
              htmlFor="totalCompanies"
              error={fieldErrors["totalCompanies"]}
            >
              <Input
                id="totalCompanies"
                inputMode="numeric"
                autoComplete="off"
                {...textProps("totalCompanies")}
              />
            </Field>

            <Field label="City" error={fieldErrors["city"]} hint="Where the candidate lives">
              <Select
                value={fieldToInputValue(intake.fields.city ?? null) || undefined}
                onValueChange={(v) => void writeField("city", v)}
              >
                <SelectTrigger className={selectClass("city")} aria-label="City">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {cityOptionsWith(intake.fields.city ?? null).map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Pincode"
              htmlFor="pincode"
              error={fieldErrors["pincode"]}
              hint="Hiring zone is read from this PIN"
            >
              <Input
                id="pincode"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                {...extraTextProps("pincode")}
              />
            </Field>

            <Field label="Job City" error={fieldErrors["jobCity"]} hint="Where the job is offered">
              <Select
                value={fieldToInputValue(intake.fields.jobCity ?? null) || undefined}
                onValueChange={(v) => void writeField("jobCity", v)}
              >
                <SelectTrigger className={selectClass("jobCity")} aria-label="Job City">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {cityOptionsWith(intake.fields.jobCity ?? null).map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="border-t border-slate-100 px-4 pb-6 pt-5 md:px-5">
            <div className="flex items-center gap-1 text-[12.5px] font-medium text-slate-700">
              <Mic className="h-3.5 w-3.5 text-indigo-600" />
              <span>English Communication</span>
              <span aria-hidden className="text-red-500">*</span>
            </div>
            <div
              role="radiogroup"
              aria-label="English Communication"
              className={cn(
                "mt-3 flex flex-wrap gap-3 rounded-xl",
                flash["englishCommunication"] && "ring-2 ring-indigo-400/70",
              )}
            >
              {ENGLISH_OPTIONS.map((o) => {
                const selected = english === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={Boolean(saving["englishCommunication"])}
                    onClick={() => void writeField("englishCommunication", o.value)}
                    className={cn(
                      "flex items-center gap-2 rounded-full border px-4 py-2.5 text-[13px] font-medium transition-colors disabled:opacity-60",
                      selected
                        ? "border-indigo-400 bg-indigo-50 text-indigo-900"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "grid h-4 w-4 place-items-center rounded-full border-2",
                        selected ? "border-indigo-600" : "border-slate-300",
                      )}
                    >
                      {selected ? <span className="h-2 w-2 rounded-full bg-indigo-600" /> : null}
                    </span>
                    {o.label}
                  </button>
                );
              })}
            </div>
            {intake.english && intake.english.samples > 0 ? (
              <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/50 px-3.5 py-2.5">
                <p className="text-[12px] font-medium text-indigo-900">
                  Live read: {intake.english.rating}
                  <span className="font-normal text-indigo-700">
                    {" "}· {intake.english.samples} turn{intake.english.samples === 1 ? "" : "s"} heard
                    {intake.english.confidence < 1 ? " · still settling" : ""}
                  </span>
                </p>
                {intake.english.evidence.length > 0 ? (
                  <p className="mt-1 text-[11.5px] text-indigo-800/80">
                    {intake.english.evidence.join(" · ")}
                  </p>
                ) : null}
              </div>
            ) : null}
            <p className="mt-2 text-[11.5px] text-slate-400">
              Judged from how the candidate speaks during the call — the agent never asks. Override it here if you disagree.
            </p>
            {fieldErrors["englishCommunication"] ? (
              <p role="alert" className="mt-1 text-[11.5px] font-medium text-red-600">
                {fieldErrors["englishCommunication"]}
              </p>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard icon={<Briefcase className="h-4 w-4 text-indigo-700" />} title="Job Information">
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 px-4 py-6 md:grid-cols-3 md:px-5">
            <Field label="Skill Role" hint="Fixed for this campaign">
              <Select value={fieldToInputValue(intake.fields.skillRole ?? null) || undefined} disabled>
                <SelectTrigger className={selectClass("skillRole")} aria-label="Skill Role">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {SKILL_ROLE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Skill" hint="Fixed for this campaign">
              <Select value={fieldToInputValue(intake.fields.skill ?? null) || undefined} disabled>
                <SelectTrigger className={selectClass("skill")} aria-label="Skill">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {SKILL_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Industry" hint="Fixed for this campaign">
              <Select value={fieldToInputValue(intake.fields.industry ?? null) || undefined} disabled>
                <SelectTrigger className={selectClass("industry")} aria-label="Industry">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {INDUSTRY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Qualification" error={fieldErrors["qualification"]}>
              <Select
                value={fieldToInputValue(intake.fields.qualification ?? null) || undefined}
                onValueChange={(v) => void writeField("qualification", v)}
              >
                <SelectTrigger className={selectClass("qualification")} aria-label="Qualification">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {QUALIFICATION_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Shift Base" error={fieldErrors["shiftBase"]}>
              <Select
                value={fieldToInputValue(intake.fields.shiftBase ?? null) || undefined}
                onValueChange={(v) => void writeField("shiftBase", v)}
              >
                <SelectTrigger className={selectClass("shiftBase")} aria-label="Shift Base">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {SHIFT_BASE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="DND"
              error={fieldErrors["dnd"]}
              hint="Marked after the call if the candidate is no longer interested"
            >
              <Select
                value={fieldToInputValue(intake.fields.dnd ?? null) || undefined}
                onValueChange={(v) => void writeField("dnd", v)}
              >
                <SelectTrigger className={selectClass("dnd")} aria-label="DND">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {DND_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </SectionCard>

        <SectionCard
          icon={<ClipboardList className="h-4 w-4 text-indigo-700" />}
          title="Dispositions"
          subtitle="A candidate can have more than one — tick every outcome that applies"
        >
          <div className="flex flex-wrap gap-2 px-4 py-5 md:px-5">
            {dispositions.map((d) => {
              const on = selectedIds.includes(d.id);
              return (
                <button
                  key={d.id}
                  type="button"
                  title={d.meaning ?? undefined}
                  aria-pressed={on}
                  onClick={() => {
                    setExtraDrafts({});
                    void setDispositionIds(
                      on ? selectedIds.filter((id) => id !== d.id) : [...selectedIds, d.id],
                    );
                  }}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition",
                    on
                      ? "border-indigo-500 bg-indigo-600 text-white shadow-sm"
                      : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-700",
                    flash["disposition"] && on ? "ring-2 ring-indigo-300" : "",
                  )}
                >
                  {d.name}
                </button>
              );
            })}
          </div>

          {fieldErrors["disposition"] ? (
            <p className="px-4 pb-4 text-[12px] font-medium text-red-600 md:px-5">
              {fieldErrors["disposition"]}
            </p>
          ) : null}

          {selectedDispositions.length === 0 ? (
            <p className="px-4 pb-6 text-[12.5px] text-slate-500 md:px-5">
              No outcome recorded yet. The agent marks these during the call.
            </p>
          ) : (
            selectedDispositions.map((d) => (
              <div key={d.id} className="border-t border-slate-100">
                <div className="flex flex-wrap items-baseline gap-x-2 px-4 pt-5 md:px-5">
                  <h2 className="text-[13.5px] font-semibold text-slate-900">{d.name}</h2>
                  {d.meaning ? (
                    <p className="text-[11.5px] text-slate-500">{d.meaning}</p>
                  ) : null}
                </div>

                {d.warning ? (
                  <div className="mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] font-medium text-amber-900 md:mx-5">
                    {d.warning}
                  </div>
                ) : null}

                {d.fields.length > 0 ? (
                  <div className="grid grid-cols-1 gap-x-6 gap-y-5 px-4 py-5 md:grid-cols-3 md:px-5">
                    {d.fields.map((spec) => renderDispositionField(d.id, spec))}
                  </div>
                ) : (
                  <p className="px-4 pb-5 pt-2 text-[12.5px] text-slate-500 md:px-5">
                    No extra fields for {d.name}.
                  </p>
                )}
              </div>
            ))
          )}
        </SectionCard>
        </div>

        {isCompleted ? (
          <div className="mt-5 overflow-hidden rounded-2xl border border-indigo-100 bg-white p-1.5 shadow-sm">
            <div className="rounded-xl bg-gradient-to-r from-slate-300 to-slate-300/70 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-indigo-700" />
                <h1 className="text-[15px] font-bold text-slate-900">Proposed job</h1>
              </div>
              <p className="mt-0.5 text-[11.5px] text-slate-600">
                Matched on close — this is what the agent should pitch
              </p>
            </div>
            {intake.proposedJob ? (
              <div className="space-y-4 px-4 py-6 md:px-5">
                <div>
                  <p className="text-[15px] font-semibold text-slate-900">{intake.proposedJob.title}</p>
                  <p className="text-[13px] text-slate-600">
                    {intake.proposedJob.company} · {intake.proposedJob.area} · {intake.proposedJob.process}
                  </p>
                  <p className="mt-1 text-[13px] font-medium text-slate-800">
                    ₹{intake.proposedJob.salaryMin.toLocaleString("en-IN")} – ₹{intake.proposedJob.salaryMax.toLocaleString("en-IN")} / month
                    {intake.proposedJob.weekendOff ? " · Weekend off" : ""}
                    {intake.proposedJob.workFromHome ? " · Work from home" : ""}
                  </p>
                </div>
                {intake.talkingPoints.length > 0 ? (
                  <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3">
                    <p className="text-[11.5px] font-medium uppercase tracking-wide text-indigo-700">
                      What the agent pitches from
                    </p>
                    <ul className="mt-1.5 space-y-0.5 text-[13px] leading-relaxed text-slate-800">
                      {intake.talkingPoints.map((point) => (
                        <li key={point}>{point}</li>
                      ))}
                    </ul>
                  </div>
                ) : intake.speakScript ? (
                  <blockquote className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-[13px] leading-relaxed text-slate-800">
                    {intake.speakScript}
                  </blockquote>
                ) : null}
                <p className="text-[12.5px] text-slate-600">{intake.proposedJob.description}</p>
                {intake.alternatives.length > 0 ? (
                  <div>
                    <p className="text-[12px] font-medium text-slate-500">Also matching</p>
                    <ul className="mt-1 space-y-1 text-[12.5px] text-slate-700">
                      {intake.alternatives.map((job) => (
                        <li key={job.id}>
                          {job.company} — {job.title} (₹{job.salaryMin.toLocaleString("en-IN")}–₹{job.salaryMax.toLocaleString("en-IN")})
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="px-4 py-6 text-[13px] text-slate-600 md:px-5">
                {intake.matchNote ?? "No Bangalore JD was attached to this candidate."}
              </p>
            )}
          </div>
        ) : null}

        {isCompleted && intake.profile ? <CandidateProfileCard profile={intake.profile} /> : null}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11.5px] text-slate-400">
            {intake.missingFields.length === 0 && (intake.missingDispositionFields?.length ?? 0) === 0
              ? "All call fields captured."
              : `Still to capture: ${intake.missingFields.length + (intake.missingDispositionFields?.length ?? 0)}`}
          </p>
          <div className="flex items-center gap-3">
            {closeError ? <span className="text-[11.5px] text-red-600">{closeError}</span> : null}
            <Button
              type="button"
              onClick={() => void onCloseForm()}
              disabled={closing || isCompleted}
              className="rounded-xl bg-indigo-600 text-white hover:bg-indigo-700"
            >
              {closing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {isCompleted ? "Form closed" : "Close form"}
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
