import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandMark, PoweredBySarvam } from "@/components/logo";
import { AlertCircle, CheckCircle, Loader2, Plus, Trash2 } from "lucide-react";

type PublicEvent = {
  slug: string;
  title: string;
  tagline: string | null;
  description: string | null;
  mode: string;
  venue: string | null;
  status: string;
  registrationOpen: boolean;
  minTeamSize: number;
  maxTeamSize: number;
  rules: string | null;
  eligibility: string | null;
  prizes: Array<{ place: string; title: string; description?: string }>;
  faq: Array<{ question: string; answer: string }>;
  registrationClosesAt: string | null;
  eventStartsAt: string | null;
  submissionClosesAt: string | null;
  teamCount: number;
  spotsRemaining: number | null;
  leaderboard: Array<{ rank: number; teamName: string; averageScore: number | null; placement: string }> | null;
};

type MemberDraft = { name: string; email: string; phone: string; linkedinUrl: string };

export default function PublicEventPage() {
  const [, params] = useRoute("/events/:slug");
  const slug = params?.slug ?? "";

  const [meta, setMeta] = useState<PublicEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState<{ referenceCode: string; teamName: string } | null>(null);

  const [teamName, setTeamName] = useState("");
  const [institution, setInstitution] = useState("");
  const [city, setCity] = useState("");
  const [leaderName, setLeaderName] = useState("");
  const [leaderEmail, setLeaderEmail] = useState("");
  const [leaderPhone, setLeaderPhone] = useState("");
  const [leaderLinkedinUrl, setLeaderLinkedinUrl] = useState("");
  const [members, setMembers] = useState<MemberDraft[]>([]);
  const [otpChallengeToken, setOtpChallengeToken] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [phoneVerificationToken, setPhoneVerificationToken] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/voiceathon/public/${encodeURIComponent(slug)}`)
      .then(async (res) => {
        if (!active) return;
        if (res.status === 404) { setLoadError("notfound"); return; }
        if (!res.ok) { setLoadError("error"); return; }
        setMeta(await res.json());
      })
      .catch(() => { if (active) setLoadError("error"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug]);

  useEffect(() => {
    document.title = meta?.title ? `${meta.title} — Voice-a-thon` : "Voice-a-thon";
    return () => { document.title = "SnapServe"; };
  }, [meta?.title]);

  const handleSubmit = async () => {
    setSubmitError(null);
    if (!teamName.trim() || !leaderName.trim() || !leaderEmail.trim() || !leaderPhone.trim() || !leaderLinkedinUrl.trim()) {
      setSubmitError("Team name and all leader profile fields are required.");
      return;
    }
    if (!phoneVerificationToken) {
      setSubmitError("Verify the leader mobile number before registering.");
      return;
    }
    if (members.some((m) => !m.name.trim() || !m.email.trim() || !m.phone.trim() || !m.linkedinUrl.trim())) {
      setSubmitError("Name, email, mobile, and LinkedIn profile are required for every team member.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/voiceathon/public/${encodeURIComponent(slug)}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamName: teamName.trim(),
          institution: institution.trim() || undefined,
          city: city.trim() || undefined,
          leaderName: leaderName.trim(),
          leaderEmail: leaderEmail.trim(),
          leaderPhone: leaderPhone.trim(),
          leaderLinkedinUrl: leaderLinkedinUrl.trim(),
          phoneVerificationToken,
          members: members.filter((m) => m.name.trim()).map((m) => ({
            name: m.name.trim(),
            email: m.email.trim(),
            phone: m.phone.trim(),
            linkedinUrl: m.linkedinUrl.trim(),
          })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubmitError(body?.error ?? "Registration failed");
        return;
      }
      setDone({ referenceCode: body.referenceCode, teamName: body.teamName });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const sendOtp = async () => {
    setSubmitError(null);
    setOtpBusy(true);
    try {
      const res = await fetch(`/api/voiceathon/public/${encodeURIComponent(slug)}/otp/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: leaderPhone.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setSubmitError(body.error ?? "Could not send OTP"); return; }
      setOtpChallengeToken(body.challengeToken);
      setPhoneVerificationToken("");
      setOtpCode("");
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setOtpBusy(false);
    }
  };

  const verifyOtp = async () => {
    if (!otpChallengeToken) return;
    setSubmitError(null);
    setOtpBusy(true);
    try {
      const res = await fetch(`/api/voiceathon/public/${encodeURIComponent(slug)}/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: leaderPhone.trim(), challengeToken: otpChallengeToken, code: otpCode.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setSubmitError(body.error ?? "OTP verification failed"); return; }
      setPhoneVerificationToken(body.verificationToken);
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setOtpBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-muted/30">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError || !meta) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-3 bg-muted/30 px-6 text-center">
        <AlertCircle className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-xl font-semibold">{loadError === "notfound" ? "Event not found" : "Couldn't load this event"}</h1>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4 bg-muted/30 px-6 text-center pb-safe">
        <CheckCircle className="h-14 w-14 text-emerald-500" />
        <h1 className="text-2xl font-bold">Registration submitted</h1>
        <p className="text-sm text-muted-foreground max-w-md">
          Team <span className="font-medium text-foreground">{done.teamName}</span> is pending SnapServe review for {meta.title}.
        </p>
        <p className="text-sm font-mono bg-muted rounded px-3 py-2">Reference: {done.referenceCode}</p>
        <p className="text-sm text-muted-foreground max-w-md">
          We will verify your team details. Once approved, an official event ticket containing the venue and date will be emailed to the leader.
        </p>
        <BrandMark className="mt-4 opacity-70" />
        <PoweredBySarvam className="mt-2" />
      </div>
    );
  }

  const extraSlots = Math.max(0, meta.maxTeamSize - 1);
  const currentExtra = members.length;
  const teamSize = 1 + members.filter((m) => m.name.trim()).length;

  return (
    <div className="min-h-dvh bg-muted/30 pb-safe">
      <div className="bg-primary/5 border-b border-border">
        <div className="mx-auto max-w-2xl px-4 py-6 sm:py-8">
          <BrandMark className="mb-4" />
          <PoweredBySarvam className="mb-3 justify-start" />
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{meta.title}</h1>
          {meta.tagline && <p className="text-sm text-muted-foreground mt-1">{meta.tagline}</p>}
          <p className="text-xs text-muted-foreground mt-2">
            {[meta.mode, meta.venue, meta.eventStartsAt ? new Date(meta.eventStartsAt).toLocaleString() : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-4 py-6 space-y-8">
        {meta.description && (
          <section>
            <h2 className="text-sm font-semibold mb-2">About</h2>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{meta.description}</p>
          </section>
        )}
        {meta.eligibility && (
          <section>
            <h2 className="text-sm font-semibold mb-2">Eligibility</h2>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{meta.eligibility}</p>
          </section>
        )}
        {meta.rules && (
          <section>
            <h2 className="text-sm font-semibold mb-2">Rules</h2>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{meta.rules}</p>
          </section>
        )}
        {meta.prizes?.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold mb-2">Prizes</h2>
            <ul className="text-sm text-muted-foreground space-y-1">
              {meta.prizes.map((p, i) => (
                <li key={i}><span className="font-medium text-foreground">{p.place}:</span> {p.title}{p.description ? ` — ${p.description}` : ""}</li>
              ))}
            </ul>
          </section>
        )}
        {meta.leaderboard && meta.leaderboard.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold mb-2">Leaderboard</h2>
            <ol className="text-sm space-y-1">
              {meta.leaderboard.slice(0, 20).map((r) => (
                <li key={r.rank} className="flex justify-between border-b border-border/40 py-1">
                  <span>#{r.rank} {r.teamName}</span>
                  <span className="text-muted-foreground">{r.averageScore ?? "—"} · {r.placement}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="rounded-xl border border-border bg-card p-4 sm:p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Team registration</h2>
            <p className="text-xs text-muted-foreground mt-1">
              One leader registers the whole team ({meta.minTeamSize}–{meta.maxTeamSize} people including the leader).
              {meta.spotsRemaining != null ? ` ${meta.spotsRemaining} spots left.` : ""}
            </p>
          </div>

          {!meta.registrationOpen ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> Registration is closed.
            </div>
          ) : (
            <>
              {submitError && <p className="text-sm text-destructive">{submitError}</p>}
              <Field label="Team name" required>
                <Input value={teamName} onChange={(e) => setTeamName(e.target.value)} />
              </Field>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Institution / college">
                  <Input value={institution} onChange={(e) => setInstitution(e.target.value)} />
                </Field>
                <Field label="City">
                  <Input value={city} onChange={(e) => setCity(e.target.value)} />
                </Field>
              </div>
              <div className="rounded-lg border border-border/60 p-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Team leader (will sign in later)</p>
                <Field label="Full name" required>
                  <Input value={leaderName} onChange={(e) => setLeaderName(e.target.value)} />
                </Field>
                <Field label="Email" required>
                  <Input type="email" value={leaderEmail} onChange={(e) => setLeaderEmail(e.target.value)} />
                </Field>
                <Field label="LinkedIn profile URL" required>
                  <Input
                    type="url"
                    placeholder="https://www.linkedin.com/in/..."
                    value={leaderLinkedinUrl}
                    onChange={(e) => setLeaderLinkedinUrl(e.target.value)}
                  />
                </Field>
                <Field label="Mobile number" required>
                  <div className="flex gap-2">
                    <Input
                      inputMode="tel"
                      placeholder="+91 98765 43210"
                      value={leaderPhone}
                      disabled={!!phoneVerificationToken}
                      onChange={(e) => {
                        setLeaderPhone(e.target.value);
                        setOtpChallengeToken("");
                        setPhoneVerificationToken("");
                      }}
                    />
                    {phoneVerificationToken ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-600 whitespace-nowrap">
                        <CheckCircle className="w-4 h-4" /> Verified
                      </span>
                    ) : (
                      <Button type="button" variant="outline" disabled={otpBusy || leaderPhone.trim().length < 10} onClick={() => void sendOtp()}>
                        {otpBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send OTP"}
                      </Button>
                    )}
                  </div>
                </Field>
                {otpChallengeToken && !phoneVerificationToken && (
                  <Field label="6-digit OTP" required>
                    <div className="flex gap-2">
                      <Input
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="000000"
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                      />
                      <Button type="button" disabled={otpBusy || otpCode.length !== 6} onClick={() => void verifyOtp()}>
                        Verify
                      </Button>
                    </div>
                  </Field>
                )}
              </div>

              {members.map((m, i) => (
                <div key={i} className="rounded-lg border border-border/60 p-3 space-y-2">
                  <div className="flex justify-between">
                    <p className="text-xs font-medium text-muted-foreground">Member {i + 2}</p>
                    <button type="button" onClick={() => setMembers((prev) => prev.filter((_, idx) => idx !== i))}>
                      <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                  </div>
                  <Input placeholder="Full name *" value={m.name} onChange={(e) => setMembers((prev) => prev.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} />
                  <Input type="email" placeholder="Email *" value={m.email} onChange={(e) => setMembers((prev) => prev.map((x, idx) => idx === i ? { ...x, email: e.target.value } : x))} />
                  <Input inputMode="tel" placeholder="Mobile number *" value={m.phone} onChange={(e) => setMembers((prev) => prev.map((x, idx) => idx === i ? { ...x, phone: e.target.value } : x))} />
                  <Input type="url" placeholder="LinkedIn profile URL *" value={m.linkedinUrl} onChange={(e) => setMembers((prev) => prev.map((x, idx) => idx === i ? { ...x, linkedinUrl: e.target.value } : x))} />
                </div>
              ))}

              {currentExtra < extraSlots && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setMembers((prev) => [...prev, { name: "", email: "", phone: "", linkedinUrl: "" }])}
                >
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add teammate ({teamSize}/{meta.maxTeamSize})
                </Button>
              )}

              <p className="text-[11px] text-muted-foreground">
                All registrations are reviewed by SnapServe. Team names must be unique. Approved teams receive a ticket by email.
              </p>
              <Button className="w-full" disabled={submitting || !phoneVerificationToken} onClick={() => void handleSubmit()}>
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Register team"}
              </Button>
            </>
          )}
        </section>

        {meta.faq?.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold mb-2">FAQ</h2>
            <div className="space-y-3">
              {meta.faq.map((f, i) => (
                <div key={i}>
                  <p className="text-sm font-medium">{f.question}</p>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{f.answer}</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
    </div>
  );
}
