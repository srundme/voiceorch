import { useEffect, useState, type FormEvent } from "react";
import { FILING_LABEL, type Candidate } from "../model";
import { toE164 } from "../phone";
import { laneOf, nextOpen, screenOf, type Lane } from "../screen";
import { useDesk } from "../store";

interface LiveScreen {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  gender: string;
  dateOfBirth: string;
  workStatus: string;
  totalCompanies: string;
  city: string;
  jobCity: string;
  pincode: string;
  skillRole: string;
  skill: string;
  industry: string;
  qualification: string;
  shift: string;
  dnd: string;
  english: string;
  disposition: string;
  next: string;
  pitch: boolean;
}

const PROFILE: { key: keyof LiveScreen; label: string }[] = [
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Surname" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "gender", label: "Gender" },
  { key: "dateOfBirth", label: "Date of birth" },
  { key: "workStatus", label: "Work" },
  { key: "totalCompanies", label: "Companies" },
  { key: "city", label: "City" },
  { key: "jobCity", label: "Job city" },
  { key: "pincode", label: "Pincode" },
  { key: "skillRole", label: "Skill role" },
  { key: "skill", label: "Skill" },
  { key: "industry", label: "Industry" },
  { key: "qualification", label: "Qualification" },
  { key: "shift", label: "Shift" },
  { key: "english", label: "English" },
  { key: "dnd", label: "Do not disturb" },
];

const LANES: { id: Lane; title: string; note: string }[] = [
  { id: "wait", title: "To call", note: "Not on the phone yet." },
  { id: "screen", title: "On the screen", note: "Sruthi is still walking the questions." },
  { id: "filed", title: "Filed", note: "A lineup, or a reason there is none." },
];

export function CallsPage({ onOpen }: { onOpen: (id: string) => void }) {
  const { snapshot, addCandidate, patchCandidate } = useDesk();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<LiveScreen | null>(null);

  async function place(person: string, rawPhone: string, existingId?: string) {
    const dialed = toE164(rawPhone);
    if (!person.trim() || !dialed) {
      setNotice("");
      setError("Enter a name and a mobile number.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice(`Sruthi is calling ${person.trim()} on ${dialed}`);
    try {
      const response = await fetch("/api/dial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: person.trim(), phone: dialed }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string; id?: number } | null;
      if (!response.ok) {
        setNotice("");
        setError(data?.error || "The call was not placed.");
        return;
      }
      const summary = `Sruthi is calling ${dialed}.`;
      const answers: Record<string, string> = data?.id ? { callId: String(data.id) } : {};
      if (existingId) {
        patchCandidate(existingId, {
          name: person.trim(),
          phone: dialed,
          summary,
          outcomeLabel: "Ringing",
          answers,
          screenedAt: new Date().toLocaleString("en-IN", { hour12: true }),
        });
      } else {
        addCandidate({
          id: `c-${Date.now()}`,
          name: person.trim(),
          phone: dialed,
          city: "",
          pincode: "",
          qualification: "",
          experience: "",
          english: "",
          shift: "",
          expectedSalary: "",
          notice: "",
          summary,
          transcript: [],
          recordingSeconds: 0,
          filed: "open",
          outcomeLabel: "Ringing",
          nodeId: null,
          jobId: null,
          answers,
          screenedAt: new Date().toLocaleString("en-IN", { hour12: true }),
        });
        setName("");
        setPhone("");
      }
      setNotice(summary);
    } catch {
      setNotice("");
      setError("The call was not placed.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let stop = false;
    async function pull() {
      try {
        const response = await fetch("/api/screen");
        if (!response.ok) return;
        const data = (await response.json()) as LiveScreen;
        if (!stop) setLive(data);
      } catch {
        if (!stop) setLive(null);
      }
    }
    void pull();
    const timer = window.setInterval(() => void pull(), 4000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  function add(event: FormEvent) {
    event.preventDefault();
    void place(name, phone);
  }

  return (
    <div className="page">
      <header className="desk-head">
        <div>
          <p className="kicker">Jobshop</p>
          <h1>Today’s screen</h1>
          <p className="whisper">Someone applied on Naukri. Sruthi calls and asks in order. A job is offered only after the screen is done.</p>
        </div>
        <form className="add-row" onSubmit={add}>
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="field">
            <span>Phone</span>
            <input value={phone} inputMode="tel" placeholder="9876543210" onChange={(event) => setPhone(event.target.value)} />
          </label>
          <button type="submit" className="btn btn-red" disabled={busy}>{busy ? "Calling…" : "Call"}</button>
          {error && <p className="banner banner-warn">{error}</p>}
          {notice && <p className="banner">{notice}</p>}
        </form>
      </header>
      {live && (live.firstName || live.disposition) && (
        <section className="lane live-screen">
          <header>
            <h2>This call</h2>
            <span>{live.disposition || "Still asking"}</span>
          </header>
          <p className="whisper">{live.next || "The screen is complete."}</p>
          <ul className="profile">
            {PROFILE.map((row) => (
              <li key={row.key}>
                <span>{row.label}</span>
                <strong>{String(live[row.key] || "Not yet")}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="lanes">
        {LANES.map((lane) => {
          const people = snapshot.candidates.filter((person) => laneOf(person) === lane.id);
          return (
            <section key={lane.id} className="lane" aria-labelledby={`lane-${lane.id}`}>
              <header>
                <h2 id={`lane-${lane.id}`}>{lane.title}</h2>
                <span>{people.length}</span>
              </header>
              <p className="whisper">{lane.note}</p>
              <ul>
                {people.length === 0 && <li className="empty">No one here</li>}
                {people.map((person) => (
                  <PersonCard
                    key={person.id}
                    person={person}
                    lane={lane.id}
                    busy={busy}
                    onOpen={() => onOpen(person.id)}
                    onCall={() => void place(person.name, person.phone, person.id)}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function PersonCard({
  person,
  lane,
  busy,
  onOpen,
  onCall,
}: {
  person: Candidate;
  lane: Lane;
  busy: boolean;
  onOpen: () => void;
  onCall: () => void;
}) {
  const steps = screenOf(person);
  const next = nextOpen(steps);
  const done = steps.filter((step) => step.answer).length;
  const jobNote = person.outcomeLabel ?? FILING_LABEL[person.filed];

  return (
    <li className="card">
      <button type="button" className="card-main" onClick={onOpen}>
        <strong>{person.name}</strong>
        <em>{person.phone || "No phone"}</em>
        {lane === "screen" && next && <span className="next">Next · {next.label}</span>}
        {lane === "screen" && !next && <span className="next">Screen done · ready to match a job</span>}
        {lane === "filed" && <span className={`pill pill-${person.filed}`}>{jobNote}</span>}
        {lane === "screen" && <span className="meta">{done} of {steps.length}</span>}
      </button>
      {lane === "wait" && (
        <button
          type="button"
          className="btn btn-red"
          disabled={busy || !toE164(person.phone)}
          onClick={onCall}
        >
          Call
        </button>
      )}
    </li>
  );
}
