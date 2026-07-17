import { useState, useEffect } from "react";
import { useRoute } from "wouter";
import { Star, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/logo";

// ─── Fixed form template (contract must match the server + analytics) ─────────

const EVENT_EXPERIENCE_METRICS: Array<[string, string]> = [
  ["overallSatisfaction", "Overall satisfaction"],
  ["eventOrganization", "Event organization"],
  ["speakerCommunication", "Speaker communication"],
  ["speakerKnowledge", "Speaker knowledge"],
  ["sessionPace", "Session pace"],
  ["audienceInteraction", "Interaction with the audience"],
  ["qaQuality", "Q&A quality"],
  ["timeManagement", "Time management"],
  ["venueExperience", "Venue / Online experience"],
  ["avQuality", "Audio & Visual quality"],
];

const LEARNING_METRICS: Array<[string, string]> = [
  ["learnedSomethingNew", "I learned something new"],
  ["increasedUnderstanding", "My understanding of AI increased"],
  ["understandVoiceAgents", "I now understand AI Voice Agents"],
  ["confidentToTry", "I feel confident trying it myself"],
  ["examplesPractical", "The examples were practical"],
  ["easyToFollow", "The content was easy to follow"],
];

const DESCRIBES_YOU = [
  "Student",
  "Working Professional",
  "Founder / Entrepreneur",
  "Freelancer",
  "Faculty",
  "Other",
];
const AI_EXPERIENCE = ["Beginner", "Intermediate", "Advanced"];
const YES_NO = ["Yes", "No"];
const CAREER_INTERESTS = [
  "AI Careers",
  "AI Entrepreneurship",
  "Product Building",
  "Voice AI",
  "Automation",
  "Generative AI",
];
const CAREER_HELP = ["Definitely", "Probably", "Maybe", "No"];
const FUTURE_INTERESTS = [
  "Internship",
  "Placement",
  "Live Projects",
  "Hackathons",
  "Mentorship",
  "Community",
];
const STAY_CONNECTED = ["WhatsApp", "Email", "LinkedIn"];
const FUTURE_TOPICS = [
  "Building AI Voice Agents",
  "Generative AI",
  "AI Automation",
  "Agentic AI",
  "Prompt Engineering",
  "AI for Business",
  "Career in AI",
  "No-code AI tools",
];
const OUTCOMES = [
  "Learned something new",
  "Got hands-on experience",
  "Networked with others",
  "Inspired to build something",
  "Considering an AI career",
  "Interested in an internship",
];
const FEATURE_INTEREST = [
  "AI Calling",
  "Voice Agents",
  "Workflow Builder",
  "Integrations",
  "Dashboard",
  "Analytics",
];

interface WorkshopMeta {
  slug: string;
  title: string;
  college: string | null;
  eventDate: string | null;
  mode: string;
  sessions: Array<{ id: string; name: string }>;
  status: "open" | "closed";
}

// ─── Small inputs ─────────────────────────────────────────────────────────────

function StarRating({ value, onChange }: { value?: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          className="p-0.5 touch-manipulation"
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
        >
          <Star
            className={cn(
              "h-7 w-7 transition-colors",
              (hover || value || 0) >= n
                ? "fill-amber-400 text-amber-400"
                : "text-muted-foreground/40",
            )}
          />
        </button>
      ))}
    </div>
  );
}

function ChoiceGroup({
  options,
  value,
  onChange,
}: {
  options: string[];
  value?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={cn(
            "rounded-full border px-3.5 py-2 text-sm transition-colors touch-manipulation",
            value === opt
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background hover:bg-muted",
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function MultiChoice({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (opt: string) =>
    onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt]);
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => toggle(opt)}
          className={cn(
            "rounded-full border px-3.5 py-2 text-sm transition-colors touch-manipulation",
            value.includes(opt)
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background hover:bg-muted",
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function RatingRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between py-2 border-b border-border/60 last:border-0">
      <span className="text-sm">{label}</span>
      <StarRating value={value} onChange={onChange} />
    </div>
  );
}

function Section({
  n,
  title,
  subtitle,
  children,
}: {
  n: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-5 sm:p-6 space-y-4">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
              {n}
            </span>
            {title}
          </h2>
          {subtitle ? <p className="text-xs text-muted-foreground mt-1 ml-8">{subtitle}</p> : null}
        </div>
        <div className="space-y-4">{children}</div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div className="space-y-2">
      <Label className="text-sm">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WorkshopFormPage() {
  const [, params] = useRoute("/workshop/:slug");
  const slug = params?.slug ?? "";

  const [meta, setMeta] = useState<WorkshopMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Section 1 — participant identity
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [college, setCollege] = useState("");
  const [department, setDepartment] = useState("");
  const [yearOrExperience, setYearOrExperience] = useState("");
  const [city, setCity] = useState("");
  // Section 2 — audience profile
  const [describesYou, setDescribesYou] = useState<string>();
  const [aiExperience, setAiExperience] = useState<string>();
  const [builtAiBefore, setBuiltAiBefore] = useState<string>();
  const [usedVoiceAgentsBefore, setUsedVoiceAgentsBefore] = useState<string>();
  // Section 3 — event experience
  const [eventExperience, setEventExperience] = useState<Record<string, number>>({});
  // Section 4 — session ratings
  const [sessionRatings, setSessionRatings] = useState<Record<string, number>>({});
  // Section 5 — learning impact
  const [learningImpact, setLearningImpact] = useState<Record<string, number>>({});
  // Section 6 — career & business impact
  const [careerInterests, setCareerInterests] = useState<string[]>([]);
  const [careerHelp, setCareerHelp] = useState<string>();
  // Section 7 — future engagement
  const [futureInterests, setFutureInterests] = useState<string[]>([]);
  const [stayConnected, setStayConnected] = useState<string[]>([]);
  const [canContact, setCanContact] = useState<string>();
  // Section 8 — future topics
  const [futureTopics, setFutureTopics] = useState<string[]>([]);
  // Section 9 — open feedback
  const [liked, setLiked] = useState("");
  const [improve, setImprove] = useState("");
  const [suggestions, setSuggestions] = useState("");
  // Section 10 — NPS
  const [nps, setNps] = useState<number>();
  // Section 11 — outcomes
  const [outcomes, setOutcomes] = useState<string[]>([]);
  // Section 12 — product feedback
  const [tryLikelihood, setTryLikelihood] = useState<number>();
  const [easeLooked, setEaseLooked] = useState<number>();
  const [wouldRecommend, setWouldRecommend] = useState<number>();
  const [featureInterest, setFeatureInterest] = useState<string>();

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/workshop/${encodeURIComponent(slug)}`)
      .then(async (res) => {
        if (!active) return;
        if (res.status === 404) {
          setLoadError("notfound");
          return;
        }
        if (!res.ok) {
          setLoadError("error");
          return;
        }
        const data: WorkshopMeta = await res.json();
        setMeta(data);
      })
      .catch(() => {
        if (active) setLoadError("error");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [slug]);

  useEffect(() => {
    document.title = meta?.title ? `${meta.title} — Feedback` : "Workshop Feedback";
    return () => {
      document.title = "SnapServe";
    };
  }, [meta?.title]);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const setRating = (
    setter: React.Dispatch<React.SetStateAction<Record<string, number>>>,
    key: string,
    v: number,
  ) => setter((prev) => ({ ...prev, [key]: v }));

  const handleSubmit = async () => {
    setSubmitError(null);
    if (!emailValid) {
      setSubmitError("Please enter a valid email so we can reach you.");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setSubmitting(true);
    const clean = <T extends Record<string, unknown>>(obj: T): T | undefined => {
      const entries = Object.entries(obj).filter(([, v]) =>
        Array.isArray(v) ? v.length > 0 : v !== undefined && v !== "" && v !== null,
      );
      return entries.length ? (Object.fromEntries(entries) as T) : undefined;
    };
    const payload: Record<string, unknown> = {
      name: name.trim() || undefined,
      email: email.trim(),
      phone: phone.trim() || undefined,
      college: college.trim() || undefined,
      department: department.trim() || undefined,
      yearOrExperience: yearOrExperience.trim() || undefined,
      city: city.trim() || undefined,
      audienceProfile: clean({ describesYou, aiExperience, builtAiBefore, usedVoiceAgentsBefore }),
      eventExperience: Object.keys(eventExperience).length ? eventExperience : undefined,
      sessionRatings: Object.keys(sessionRatings).length ? sessionRatings : undefined,
      learningImpact: Object.keys(learningImpact).length ? learningImpact : undefined,
      careerImpact: clean({ interests: careerInterests, careerHelp }),
      futureEngagement: clean({ interests: futureInterests, stayConnected, canContact }),
      futureTopics: futureTopics.length ? futureTopics : undefined,
      openFeedback: clean({
        liked: liked.trim(),
        improve: improve.trim(),
        suggestions: suggestions.trim(),
      }),
      nps,
      outcomes: outcomes.length ? outcomes : undefined,
      productFeedback: clean({ tryLikelihood, easeLooked, wouldRecommend, featureInterest }),
    };
    try {
      const res = await fetch(`/api/workshop/${encodeURIComponent(slug)}/responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 403) {
        setSubmitError("This feedback form is now closed. Thank you!");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSubmitError(body?.error ?? "Something went wrong. Please try again.");
        return;
      }
      setSubmitted(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setSubmitError("Network error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // ─── States ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-muted/30">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError === "notfound") {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-3 bg-muted/30 px-6 text-center">
        <AlertCircle className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Workshop not found</h1>
        <p className="text-sm text-muted-foreground">
          This feedback link is invalid or has been removed.
        </p>
      </div>
    );
  }

  if (loadError === "error") {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-3 bg-muted/30 px-6 text-center">
        <AlertCircle className="h-10 w-10 text-destructive" />
        <h1 className="text-xl font-semibold">Couldn&apos;t load this form</h1>
        <p className="text-sm text-muted-foreground">Please refresh and try again.</p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4 bg-muted/30 px-6 text-center pb-safe">
        <CheckCircle className="h-14 w-14 text-emerald-500" />
        <h1 className="text-2xl font-bold">Thank you!</h1>
        <p className="text-sm text-muted-foreground max-w-sm">
          Your feedback for <span className="font-medium">{meta?.title}</span> has been recorded. It
          helps us make future workshops better.
        </p>
        <BrandMark className="mt-4 opacity-70" />
      </div>
    );
  }

  const closed = meta?.status === "closed";

  return (
    <div className="min-h-dvh bg-muted/30 pb-safe">
      {/* Header */}
      <div className="bg-primary/5 border-b border-border">
        <div className="mx-auto max-w-2xl px-4 py-6 sm:py-8">
          <BrandMark className="mb-4" />
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{meta?.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {[meta?.college, meta?.eventDate ? new Date(meta.eventDate).toLocaleDateString("en-IN") : null, meta?.mode]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Your feedback takes ~3 minutes and is completely anonymous unless you share your contact.
          </p>
        </div>
      </div>

      {closed ? (
        <div className="mx-auto max-w-2xl px-4 py-16 text-center">
          <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <h2 className="text-lg font-semibold">This feedback form is closed</h2>
          <p className="text-sm text-muted-foreground mt-1">Thanks for your interest!</p>
        </div>
      ) : (
        <div className="mx-auto max-w-2xl px-4 py-6 space-y-4">
          {submitError ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{submitError}</span>
            </div>
          ) : null}

          <Section n={1} title="Your details" subtitle="So we can share resources and opportunities.">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Full name">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
              </Field>
              <Field label="Email" required>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </Field>
              <Field label="Phone / WhatsApp">
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91…" />
              </Field>
              <Field label="College / Organization">
                <Input value={college} onChange={(e) => setCollege(e.target.value)} />
              </Field>
              <Field label="Department / Field">
                <Input value={department} onChange={(e) => setDepartment(e.target.value)} />
              </Field>
              <Field label="Year / Experience">
                <Input
                  value={yearOrExperience}
                  onChange={(e) => setYearOrExperience(e.target.value)}
                  placeholder="e.g. 3rd year / 2 yrs"
                />
              </Field>
              <Field label="City">
                <Input value={city} onChange={(e) => setCity(e.target.value)} />
              </Field>
            </div>
          </Section>

          <Section n={2} title="About you">
            <Field label="Which best describes you?">
              <ChoiceGroup options={DESCRIBES_YOU} value={describesYou} onChange={setDescribesYou} />
            </Field>
            <Field label="Your experience with AI">
              <ChoiceGroup options={AI_EXPERIENCE} value={aiExperience} onChange={setAiExperience} />
            </Field>
            <Field label="Have you built anything with AI before?">
              <ChoiceGroup options={YES_NO} value={builtAiBefore} onChange={setBuiltAiBefore} />
            </Field>
            <Field label="Have you used AI voice agents before?">
              <ChoiceGroup
                options={YES_NO}
                value={usedVoiceAgentsBefore}
                onChange={setUsedVoiceAgentsBefore}
              />
            </Field>
          </Section>

          <Section n={3} title="Event experience" subtitle="Rate each from 1 (poor) to 5 (excellent).">
            <div>
              {EVENT_EXPERIENCE_METRICS.map(([key, label]) => (
                <RatingRow
                  key={key}
                  label={label}
                  value={eventExperience[key]}
                  onChange={(v) => setRating(setEventExperience, key, v)}
                />
              ))}
            </div>
          </Section>

          {meta && meta.sessions.length > 0 ? (
            <Section n={4} title="Session-wise ratings" subtitle="Rate each session you attended.">
              <div>
                {meta.sessions.map((sess) => (
                  <RatingRow
                    key={sess.id}
                    label={sess.name}
                    value={sessionRatings[sess.id]}
                    onChange={(v) => setRating(setSessionRatings, sess.id, v)}
                  />
                ))}
              </div>
            </Section>
          ) : null}

          <Section n={5} title="Learning impact" subtitle="How much do you agree? 1 (disagree) to 5 (fully agree).">
            <div>
              {LEARNING_METRICS.map(([key, label]) => (
                <RatingRow
                  key={key}
                  label={label}
                  value={learningImpact[key]}
                  onChange={(v) => setRating(setLearningImpact, key, v)}
                />
              ))}
            </div>
          </Section>

          <Section n={6} title="Career & business impact">
            <Field label="What are you most interested in?">
              <MultiChoice options={CAREER_INTERESTS} value={careerInterests} onChange={setCareerInterests} />
            </Field>
            <Field label="Will this workshop help your career / business?">
              <ChoiceGroup options={CAREER_HELP} value={careerHelp} onChange={setCareerHelp} />
            </Field>
          </Section>

          <Section n={7} title="Future engagement">
            <Field label="I'm interested in…">
              <MultiChoice options={FUTURE_INTERESTS} value={futureInterests} onChange={setFutureInterests} />
            </Field>
            <Field label="How should we stay connected?">
              <MultiChoice options={STAY_CONNECTED} value={stayConnected} onChange={setStayConnected} />
            </Field>
            <Field label="Can we contact you with opportunities?">
              <ChoiceGroup options={YES_NO} value={canContact} onChange={setCanContact} />
            </Field>
          </Section>

          <Section n={8} title="Future workshop topics" subtitle="Pick the topics you'd love to learn next.">
            <MultiChoice options={FUTURE_TOPICS} value={futureTopics} onChange={setFutureTopics} />
          </Section>

          <Section n={9} title="Open feedback">
            <Field label="What did you like most?">
              <Textarea value={liked} onChange={(e) => setLiked(e.target.value)} rows={3} />
            </Field>
            <Field label="What could be improved?">
              <Textarea value={improve} onChange={(e) => setImprove(e.target.value)} rows={3} />
            </Field>
            <Field label="Any other suggestions?">
              <Textarea value={suggestions} onChange={(e) => setSuggestions(e.target.value)} rows={3} />
            </Field>
          </Section>

          <Section
            n={10}
            title="Would you recommend this workshop?"
            subtitle="0 = not at all, 10 = absolutely."
          >
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 11 }, (_, i) => i).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setNps(n)}
                  className={cn(
                    "h-10 w-10 rounded-lg border text-sm font-medium transition-colors touch-manipulation",
                    nps === n
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background hover:bg-muted",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </Section>

          <Section n={11} title="What did you get out of this?">
            <MultiChoice options={OUTCOMES} value={outcomes} onChange={setOutcomes} />
          </Section>

          <Section
            n={12}
            title="About SnapServe"
            subtitle="We build AI voice agents. Your honest take helps us."
          >
            <RatingRow label="How likely are you to try SnapServe?" value={tryLikelihood} onChange={setTryLikelihood} />
            <RatingRow label="How easy did the product look?" value={easeLooked} onChange={setEaseLooked} />
            <RatingRow
              label="Would you recommend SnapServe to others?"
              value={wouldRecommend}
              onChange={setWouldRecommend}
            />
            <Field label="Which feature interests you most?">
              <ChoiceGroup options={FEATURE_INTEREST} value={featureInterest} onChange={setFeatureInterest} />
            </Field>
          </Section>

          <div className="sticky bottom-0 -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur pb-safe">
            <Button
              className="w-full h-12 text-base"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting…
                </>
              ) : (
                "Submit feedback"
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
