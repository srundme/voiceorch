import { useState } from "react";
import { clock } from "../format";
import { FILING_LABEL, type Candidate, type Opening } from "../model";
import { OUTCOMES } from "../outcomes";
import { nextOpen, screenOf } from "../screen";
import { useDesk } from "../store";

export function CallPage({ id, onBack }: { id: string; onBack: () => void }) {
  const { snapshot, patchCandidate, fileCandidate } = useDesk();
  const candidate = snapshot.candidates.find((row) => row.id === id);
  if (!candidate) {
    return (
      <div className="page">
        <button type="button" className="text-link" onClick={onBack}>Back to the screen</button>
        <p>This person is not on the desk.</p>
      </div>
    );
  }
  return (
    <CallForm
      candidate={candidate}
      openings={snapshot.openings}
      onBack={onBack}
      onPatch={patchCandidate}
      onFile={fileCandidate}
    />
  );
}

function CallForm({
  candidate,
  openings,
  onBack,
  onPatch,
  onFile,
}: {
  candidate: Candidate;
  openings: Opening[];
  onBack: () => void;
  onPatch: (id: string, patch: Partial<Candidate>) => void;
  onFile: (action: { id: string; nodeId: string; outcomeLabel: string; filed: Candidate["filed"]; jobId: string | null; answers: Record<string, string> }) => void;
}) {
  const steps = screenOf(candidate);
  const current = nextOpen(steps);
  const job = openings.find((opening) => opening.id === candidate.jobId);
  const matched = OUTCOMES.find((item) => item.id === candidate.nodeId)?.id ?? "";
  const [outcomeId, setOutcomeId] = useState(matched);
  const [jobId, setJobId] = useState(candidate.jobId ?? "");
  const [note, setNote] = useState(candidate.answers.note ?? candidate.answers.reason ?? "");
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const choice = OUTCOMES.find((item) => item.id === outcomeId);
  const called = candidate.transcript.length > 0 || candidate.recordingSeconds > 0;

  function saveOutcome() {
    if (!choice) {
      setError("Choose an outcome.");
      return;
    }
    if (choice.job && !jobId) {
      setError("Choose the opening.");
      return;
    }
    onFile({
      id: candidate.id,
      nodeId: choice.id,
      outcomeLabel: choice.label,
      filed: choice.filed,
      jobId: choice.job ? jobId : null,
      answers: { note },
    });
    setError("");
    setSaved("Saved");
  }

  function setAnswer(id: string, value: string) {
    const patch: Partial<Candidate> = {};
    if (id === "name") patch.name = value;
    if (id === "place") {
      const [city, pin] = value.split("·").map((part) => part.trim());
      patch.city = city ?? "";
      patch.pincode = pin ?? "";
    }
    if (id === "path") patch.experience = value;
    if (id === "study") patch.qualification = value;
    if (id === "shift") patch.shift = value;
    if (id === "pay") patch.expectedSalary = value;
    if (id === "notice") patch.notice = value;
    if (id === "job") patch.answers = { ...candidate.answers, job: value };
    if (id === "continue") patch.answers = { ...candidate.answers, continue: value };
    if (id === "voice") patch.answers = { ...candidate.answers, voice: value };
    if (id === "travel") patch.answers = { ...candidate.answers, travel: value };
    if (id === "tried") patch.answers = { ...candidate.answers, companies: value };
    if (Object.keys(patch).length > 0) onPatch(candidate.id, patch);
  }

  return (
    <div className="page">
      <button type="button" className="text-link" onClick={onBack}>Screen</button>
      <header className="profile-hero">
        <div>
          <p className="kicker">{candidate.screenedAt}</p>
          <h1>{candidate.name}</h1>
          <p className="phone">{candidate.phone || "No phone"}</p>
        </div>
        <span className={`pill pill-${candidate.filed}`}>{candidate.outcomeLabel ?? FILING_LABEL[candidate.filed]}</span>
      </header>

      {job && (
        <section className="job-band">
          <p className="kicker">Lined up on</p>
          <h2>{job.company}</h2>
          <p>{job.title}{job.shift ? ` · ${job.shift} shift` : ""}{job.salary ? ` · ${job.salary}` : ""}</p>
        </section>
      )}

      <div className="work">
        <section className="panel">
          <h2>The screen</h2>
          <p className="whisper">Sruthi asks these in this order. Fill an answer when you hear it. She does not offer a job until the last one is done.</p>
          <ol className="steps">
            {steps.map((step, index) => {
              const state = step.answer ? "done" : step.id === current?.id ? "now" : "later";
              return (
                <li key={step.id} className={`step step-${state}`}>
                  <span className="step-index">{index + 1}</span>
                  <div>
                    <strong>{step.label}</strong>
                    <p>{step.hint}</p>
                    <input
                      aria-label={step.label}
                      value={step.answer}
                      placeholder={state === "now" ? "Heard on the call" : "Not yet"}
                      onChange={(event) => setAnswer(step.id, event.target.value)}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <div className="side">
          <section className="panel">
            <h2>What was said</h2>
            <p className="meta">{candidate.recordingSeconds > 0 ? clock(candidate.recordingSeconds) : called ? "Call started" : "Not called yet"}</p>
            <ol className="transcript">
              {candidate.transcript.length === 0 && <li className="empty">No transcript yet</li>}
              {candidate.transcript.map((turn, index) => (
                <li key={`${turn.speaker}-${index}`} className={turn.speaker === "Candidate" ? "from-candidate" : "from-sruthi"}>
                  <span>{turn.speaker === "Candidate" ? "Candidate" : "Sruthi"}</span>
                  <p>{turn.text}</p>
                </li>
              ))}
            </ol>
          </section>
          <section className="panel">
            <h2>File the result</h2>
            <p className="whisper">A lineup needs an opening. Anything else is a reason there is no lineup.</p>
            <label className="field">
              <span>Result</span>
              <select value={outcomeId} onChange={(event) => { setOutcomeId(event.target.value); setSaved(""); }}>
                <option value="">Choose</option>
                {OUTCOMES.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </label>
            {choice?.job && (
              <label className="field">
                <span>Opening</span>
                <select value={jobId} onChange={(event) => setJobId(event.target.value)}>
                  <option value="">Choose an opening</option>
                  {openings.map((opening) => (
                    <option key={opening.id} value={opening.id}>
                      {opening.company} · {opening.title} · {opening.openings} left
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field">
              <span>Note</span>
              <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Why, or who follows up" />
            </label>
            {error && <p className="banner banner-warn">{error}</p>}
            <button type="button" className="btn btn-red" onClick={saveOutcome}>
              {saved || "Save"}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
