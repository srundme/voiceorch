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
  const selectedDisposition: IntakeDisposition | undefined = dispositions.find(
    (d) => d.id === intake?.dispositionId,
  );
  const progress = useMemo(
    () => intakeProgress(
      fields ?? {},
      selectedDisposition
        ? {
            requiredIds: selectedDisposition.fields.filter((f) => f.required).map((f) => f.id),
            answers: intake?.dispositionAnswers ?? {},
          }
        : undefined,
    ),
    [fields, selectedDisposition, intake?.dispositionAnswers],
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

  const extraValueOf = (key: string): string =>
    extraDrafts[key] ?? fieldToInputValue(intake?.dispositionAnswers?.[key] ?? null);

  const extraChrome = (key: string) =>
    fieldClass({
      filled: isFieldFilled(intake?.dispositionAnswers?.[key] ?? null),
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
    if (next === fieldToInputValue(intake?.dispositionAnswers?.[key] ?? null)) return;
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

  const renderDispositionField = (spec: IntakeDispositionField) => {
    const current = fieldToInputValue(intake?.dispositionAnswers?.[spec.id] ?? null);
    const options = spec.options ?? [];
    const freeText = spec.type === "text" || spec.type === "textarea"
      || (spec.type === "select" && options.length === 0);

    if (spec.type === "radio" && options.length > 0) {
      return (
        <Field key={spec.id} label={spec.label} error={fieldErrors[spec.id]} required={spec.required}>
          <RadioPills
            fieldId={spec.id}
            options={options}
            value={current}
            flashing={Boolean(flash[spec.id])}
            disabled={Boolean(saving[spec.id])}
            onPick={(v) => void writeExtra(spec.id, v)}
          />
        </Field>
      );
    }

    if (spec.type === "select" && !freeText) {
      return (
        <Field key={spec.id} label={spec.label} error={fieldErrors[spec.id]} required={spec.required}>
          <Select
            value={current || undefined}
            onValueChange={(v) => void writeExtra(spec.id, v)}
          >
            <SelectTrigger className={cn(extraChrome(spec.id), "px-3")} aria-label={spec.label}>
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
        <Field key={spec.id} label={spec.label} htmlFor={spec.id} error={fieldErrors[spec.id]} required={spec.required}>
          <Input
            id={spec.id}
            type="date"
            value={current}
            onChange={(e) => void writeExtra(spec.id, e.target.value || null)}
            className={extraChrome(spec.id)}
          />
        </Field>
      );
    }

    if (spec.type === "time") {
      return (
        <Field key={spec.id} label={spec.label} htmlFor={spec.id} error={fieldErrors[spec.id]} required={spec.required}>
          <Input
            id={spec.id}
            type="time"
            value={current}
            onChange={(e) => void writeExtra(spec.id, e.target.value || null)}
            className={extraChrome(spec.id)}
          />
        </Field>
      );
    }

    if (spec.type === "textarea") {
      return (
        <Field key={spec.id} label={spec.label} htmlFor={spec.id} error={fieldErrors[spec.id]} required={spec.required}>
          <Textarea
            id={spec.id}
            rows={3}
            {...extraTextProps(spec.id)}
            className={cn(extraChrome(spec.id), "min-h-[88px] py-2")}
          />
        </Field>
      );
    }

    return (
      <Field key={spec.id} label={spec.label} htmlFor={spec.id} error={fieldErrors[spec.id]} required={spec.required}>
        <Input
          id={spec.id}
          inputMode={spec.type === "number" ? "numeric" : "text"}
          autoComplete="off"
          {...extraTextProps(spec.id)}
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
            <p className="mt-2 text-[11.5px] text-slate-400">
              Scored after the call from how the candidate spoke — the agent does not ask this.
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
          title="Disposition"
          subtitle="Pick an outcome to reveal the extra fields for it"
        >
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 px-4 py-6 md:grid-cols-3 md:px-5">
            <Field label="Disposition" error={fieldErrors["disposition"]}>
              <Select
                value={intake.dispositionId ?? undefined}
                onValueChange={(v) => {
                  setExtraDrafts({});
                  void writeExtra("disposition", v);
                }}
              >
                <SelectTrigger
                  className={cn(
                    fieldClass({
                      filled: Boolean(intake.dispositionId),
                      flashing: Boolean(flash["disposition"]),
                      invalid: Boolean(fieldErrors["disposition"]),
                    }),
                    "px-3",
                  )}
                  aria-label="Disposition"
                >
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {dispositions.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {selectedDisposition?.warning ? (
            <div className="mx-4 mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] font-medium text-amber-900 md:mx-5">
              {selectedDisposition.warning}
            </div>
          ) : null}

          {selectedDisposition && selectedDisposition.fields.length > 0 ? (
            <div className="grid grid-cols-1 gap-x-6 gap-y-5 border-t border-slate-100 px-4 py-6 md:grid-cols-3 md:px-5">
              {selectedDisposition.fields.map(renderDispositionField)}
            </div>
          ) : selectedDisposition ? (
            <p className="px-4 pb-6 text-[12.5px] text-slate-500 md:px-5">
              No extra fields for {selectedDisposition.name}.
            </p>
          ) : null}
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
                {intake.speakScript ? (
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
