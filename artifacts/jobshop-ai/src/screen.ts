import type { Candidate } from "./model";

/** The order the call program walks before it may offer a job. */
const STEPS: { id: string; label: string; hint: string }[] = [
  { id: "name", label: "First name and surname", hint: "Gender is taken from the first name. She does not ask it." },
  { id: "email", label: "Email", hint: "She waits until they finish spelling it." },
  { id: "dob", label: "Date of birth", hint: "Age limit applies only when that opening states a range." },
  { id: "path", label: "Fresher or experienced", hint: "A fresher has zero companies." },
  { id: "place", label: "City, job city, pincode", hint: "560 or 562 is Bangalore. Any other pin asks about relocating." },
  { id: "role", label: "Skill role, skill, industry", hint: "International voice, domestic voice, or non-voice." },
  { id: "study", label: "Qualification", hint: "Exam years show an education gap. She asks the reason." },
  { id: "shift", label: "Shift", hint: "A day-only answer asks whether a US or night shift is possible." },
  { id: "dnd", label: "Do not disturb", hint: "A flag on the profile. It is not a disposition." },
  { id: "english", label: "English", hint: "Scored from how they speak. Poor on international voice asks about domestic or non-voice." },
];

export interface ScreenStep {
  id: string;
  label: string;
  hint: string;
  answer: string;
}

function heard(person: Candidate): string {
  return person.transcript.map((turn) => turn.text).join(" ").toLowerCase();
}

function voiceType(text: string): string {
  if (text.includes("international voice")) return "International voice";
  if (text.includes("domestic voice")) return "Domestic voice";
  if (text.includes("non-voice") || text.includes("non voice")) return "Non-voice";
  if (text.includes("voice process")) return "Voice process";
  return "";
}

export function screenOf(person: Candidate): ScreenStep[] {
  const text = heard(person);
  const answers: Record<string, string> = {
    name: person.name.trim(),
    email: person.answers.email ?? "",
    dob: person.answers.dob ?? "",
    path: person.experience,
    place: [person.city, person.answers.jobCity, person.pincode].filter(Boolean).join(" · "),
    role: [person.answers.skillRole, person.answers.voice || voiceType(text), person.answers.industry].filter(Boolean).join(" · "),
    study: person.qualification,
    shift: person.shift,
    dnd: person.answers.dnd ?? "",
    english: person.english,
  };
  return STEPS.map((step) => ({ ...step, answer: answers[step.id] ?? "" }));
}

export function nextOpen(steps: ScreenStep[]): ScreenStep | undefined {
  return steps.find((step) => !step.answer);
}

export type Lane = "wait" | "screen" | "filed";

export function laneOf(person: Candidate): Lane {
  const started =
    person.transcript.length > 0 ||
    person.recordingSeconds > 0 ||
    person.outcomeLabel === "Ringing";
  if (!started && (person.filed === "open" || person.filed === "keep")) return "wait";
  if (person.filed === "open" || person.filed === "keep" || person.outcomeLabel === "Ringing") return "screen";
  return "filed";
}
