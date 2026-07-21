import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { adminFetch, formatAdminError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft } from "lucide-react";

export default function NewVoiceathonEventPage() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({
    title: "",
    tagline: "",
    description: "",
    venue: "",
    mode: "offline",
    eventStartsAt: "",
    eventEndsAt: "",
    registrationClosesAt: "",
    minTeamSize: "2",
    maxTeamSize: "4",
    maxTeams: "",
    eligibility: "",
    rules: "",
  });
  const set = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const createMut = useMutation({
    mutationFn: () => adminFetch<{ id: number }>("/voiceathon/events", {
      method: "POST",
      body: JSON.stringify({
        title: form.title.trim(),
        tagline: form.tagline.trim() || null,
        description: form.description.trim() || null,
        venue: form.venue.trim() || null,
        mode: form.mode,
        eventStartsAt: toIso(form.eventStartsAt),
        eventEndsAt: toIso(form.eventEndsAt),
        registrationClosesAt: toIso(form.registrationClosesAt),
        minTeamSize: parseInt(form.minTeamSize, 10),
        maxTeamSize: parseInt(form.maxTeamSize, 10),
        maxTeams: form.maxTeams ? parseInt(form.maxTeams, 10) : null,
        eligibility: form.eligibility.trim() || null,
        rules: form.rules.trim() || null,
      }),
    }),
    onSuccess: (event) => {
      void qc.invalidateQueries({ queryKey: ["admin", "voiceathon-events"] });
      toast({ title: "Event form created" });
      setLocation(`/voiceathon/${event.id}`);
    },
    onError: (error) => toast({
      title: "Could not create event",
      description: formatAdminError(error),
      variant: "destructive",
    }),
  });

  const canCreate = form.title.trim() && form.venue.trim() && form.eventStartsAt
    && Number(form.minTeamSize) > 0
    && Number(form.maxTeamSize) >= Number(form.minTeamSize);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link href="/voiceathon" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft className="h-4 w-4 mr-1" /> Voice-a-thons
        </Link>
        <h1 className="text-xl font-semibold">Create event form</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Set the public event details first. After saving, you can publish the participant link and create judge links.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Event identity</CardTitle>
          <CardDescription>These details are shown on the registration page and approval ticket.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Event title" required>
            <Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="SnapServe Voice-a-thon 2026" />
          </Field>
          <Field label="Tagline">
            <Input value={form.tagline} onChange={(e) => set("tagline", e.target.value)} />
          </Field>
          <Field label="Description">
            <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={4} />
          </Field>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Venue" required>
              <Input value={form.venue} onChange={(e) => set("venue", e.target.value)} placeholder="SnapServe HQ, Bengaluru" />
            </Field>
            <Field label="Mode" required>
              <Select value={form.mode} onValueChange={(value) => set("mode", value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="offline">Offline</SelectItem>
                  <SelectItem value="online">Online</SelectItem>
                  <SelectItem value="hybrid">Hybrid</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            <Field label="Event starts" required>
              <Input type="datetime-local" value={form.eventStartsAt} onChange={(e) => set("eventStartsAt", e.target.value)} />
            </Field>
            <Field label="Event ends">
              <Input type="datetime-local" value={form.eventEndsAt} onChange={(e) => set("eventEndsAt", e.target.value)} />
            </Field>
            <Field label="Registration closes">
              <Input type="datetime-local" value={form.registrationClosesAt} onChange={(e) => set("registrationClosesAt", e.target.value)} />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registration rules</CardTitle>
          <CardDescription>
            Every participant must submit email, LinkedIn profile, and mobile number. The leader's mobile is OTP verified.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-4">
            <Field label="Minimum team size" required>
              <Input type="number" min={1} value={form.minTeamSize} onChange={(e) => set("minTeamSize", e.target.value)} />
            </Field>
            <Field label="Maximum team size" required>
              <Input type="number" min={1} value={form.maxTeamSize} onChange={(e) => set("maxTeamSize", e.target.value)} />
            </Field>
            <Field label="Maximum teams">
              <Input type="number" min={1} value={form.maxTeams} onChange={(e) => set("maxTeams", e.target.value)} placeholder="Unlimited" />
            </Field>
          </div>
          <Field label="Eligibility">
            <Textarea value={form.eligibility} onChange={(e) => set("eligibility", e.target.value)} rows={3} />
          </Field>
          <Field label="Rules">
            <Textarea value={form.rules} onChange={(e) => set("rules", e.target.value)} rows={5} />
          </Field>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button asChild variant="outline"><Link href="/voiceathon">Cancel</Link></Button>
        <Button disabled={!canCreate || createMut.isPending} onClick={() => createMut.mutate()}>
          Create event form
        </Button>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}{required ? <span className="text-destructive"> *</span> : null}</Label>
      {children}
    </div>
  );
}

function toIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
