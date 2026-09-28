import { useState, type FormEvent } from "react";
import type { Opening } from "../model";
import { useDesk } from "../store";

export function JobsPage({ onOpen }: { onOpen: (id: string) => void }) {
  const { snapshot, addOpening } = useDesk();
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");
  const [area, setArea] = useState("");
  const [shift, setShift] = useState("");
  const [salary, setSalary] = useState("");
  const [body, setBody] = useState("");
  const [count, setCount] = useState("1");
  const [error, setError] = useState("");

  function save(event: FormEvent) {
    event.preventDefault();
    const openings = Number(count);
    if (!company.trim() || !title.trim()) {
      setError("Company and title are required. Sruthi can only say what is written here.");
      return;
    }
    if (!Number.isFinite(openings) || openings < 0) {
      setError("Seats must be a number.");
      return;
    }
    const opening: Opening = {
      id: `jd-${Date.now()}`,
      company: company.trim(),
      title: title.trim(),
      area: area.trim(),
      shift: shift.trim(),
      salary: salary.trim(),
      body: body.trim(),
      openings,
    };
    addOpening(opening);
    setCompany("");
    setTitle("");
    setArea("");
    setShift("");
    setSalary("");
    setBody("");
    setCount("1");
    setError("");
  }

  return (
    <div className="page">
      <header className="page-head">
        <p className="kicker">Openings</p>
        <h1>What Sruthi can offer</h1>
        <p className="whisper">She says only the title, place, shift, and salary written here. If it is not on this list, she says the team will call.</p>
      </header>
      <ul className="openings">
        {snapshot.openings.map((opening) => {
          const people = snapshot.candidates.filter((person) => person.jobId === opening.id);
          return (
            <li key={opening.id}>
              <article>
                <header>
                  <p className="kicker">{opening.company}</p>
                  <h2>{opening.title}</h2>
                  <p className="meta">{[opening.area, opening.shift && `${opening.shift} shift`, opening.salary].filter(Boolean).join(" · ") || "Place, shift, and salary not written yet"}</p>
                </header>
                <strong>{opening.openings} seats</strong>
                {opening.body && <p className="jd">{opening.body}</p>}
                <ul>
                  {people.length === 0 && <li className="empty">No lineup on this opening</li>}
                  {people.map((person) => (
                    <li key={person.id}>
                      <button type="button" onClick={() => onOpen(person.id)}>
                        {person.name}
                        <small>{person.outcomeLabel}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              </article>
            </li>
          );
        })}
      </ul>
      <form className="paste" onSubmit={save}>
        <h2>Add an opening</h2>
        <label className="field">
          <span>Company</span>
          <input value={company} onChange={(event) => setCompany(event.target.value)} />
        </label>
        <label className="field">
          <span>Title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="field">
          <span>Place</span>
          <input value={area} onChange={(event) => setArea(event.target.value)} placeholder="Manyata, Nagavara" />
        </label>
        <label className="field">
          <span>Shift</span>
          <input value={shift} onChange={(event) => setShift(event.target.value)} placeholder="US, UK, or day" />
        </label>
        <label className="field">
          <span>Salary</span>
          <input value={salary} onChange={(event) => setSalary(event.target.value)} placeholder="28,000–38,000" />
        </label>
        <label className="field count">
          <span>Seats</span>
          <input value={count} inputMode="numeric" onChange={(event) => setCount(event.target.value)} />
        </label>
        <label className="field paste-body">
          <span>Note</span>
          <textarea rows={3} value={body} onChange={(event) => setBody(event.target.value)} />
        </label>
        {error && <p className="banner banner-warn">{error}</p>}
        <button type="submit" className="btn btn-red">Save opening</button>
      </form>
    </div>
  );
}
