import { useEffect, useState } from "react";
import type { CallControl } from "../model";
import { useDesk } from "../store";

function seconds(ms: number): string {
  return String(Math.round(ms / 100) / 10);
}

const PROMPT_SECTIONS = ["Persona", "Language", "Speech", "Judgement", "Rules", "Questions", "Close"] as const;

function splitPrompt(text: string): Record<string, string> | null {
  const heads = [...text.matchAll(/^# ([^\n]+)$/gm)];
  if (heads.length === 0) return null;
  const parts: Record<string, string> = {};
  heads.forEach((head, index) => {
    const name = head[1].trim();
    const start = (head.index ?? 0) + head[0].length;
    const end = index + 1 < heads.length ? (heads[index + 1].index ?? text.length) : text.length;
    parts[name] = text.slice(start, end).trim();
  });
  if (!PROMPT_SECTIONS.every((name) => name in parts)) return null;
  return parts;
}

function joinPrompt(parts: Record<string, string>): string {
  return PROMPT_SECTIONS.map((name) => `# ${name}\n${(parts[name] ?? "").trim()}`).join("\n\n") + "\n";
}

function toMs(text: string, fallback: number): number {
  const n = Number(text);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(8000, Math.max(200, Math.round(n * 1000)));
}

export function IrfanPage() {
  const { snapshot, savePrompt, saveCall, saveClone, addTrainFile, saveTrainNote } = useDesk();
  const [prompt, setPrompt] = useState(snapshot.prompt);
  const [call, setCall] = useState<CallControl>(snapshot.call);
  const [waits, setWaits] = useState({
    wait: seconds(snapshot.call.waitMs),
    pin: seconds(snapshot.call.pinWaitMs),
    email: seconds(snapshot.call.emailWaitMs),
  });
  const [note, setNote] = useState(snapshot.voice.trainNote);
  const [saved, setSaved] = useState("");
  const [lineError, setLineError] = useState("");

  useEffect(() => setPrompt(snapshot.prompt), [snapshot.prompt]);
  useEffect(() => {
    setCall(snapshot.call);
    setWaits({
      wait: seconds(snapshot.call.waitMs),
      pin: seconds(snapshot.call.pinWaitMs),
      email: seconds(snapshot.call.emailWaitMs),
    });
  }, [snapshot.call]);
  useEffect(() => setNote(snapshot.voice.trainNote), [snapshot.voice.trainNote]);

  useEffect(() => {
    let cancel = false;
    void fetch("/api/desk")
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
          greeting?: string;
          endCall?: boolean;
          barge?: boolean;
          waitMs?: number;
          pinWaitMs?: number;
          emailWaitMs?: number;
          prompt?: string;
        } | null;
        if (cancel) return;
        if (!response.ok || !data) {
          setLineError(data?.error || "The live line did not answer. A save will not reach Sruthi.");
          return;
        }
        setLineError("");
        if (typeof data.prompt === "string" && data.prompt.trim()) {
          setPrompt(data.prompt);
          savePrompt(data.prompt);
        }
        if (typeof data.greeting === "string") {
          const live = {
            greeting: data.greeting,
            endCall: data.endCall !== false,
            barge: data.barge !== false,
            waitMs: Number(data.waitMs) || 180,
            pinWaitMs: Number(data.pinWaitMs) || 2600,
            emailWaitMs: Number(data.emailWaitMs) || 3000,
          };
          setCall(live);
          saveCall(live);
          setWaits({
            wait: seconds(live.waitMs),
            pin: seconds(live.pinWaitMs),
            email: seconds(live.emailWaitMs),
          });
        }
      })
      .catch(() => {
        if (!cancel) setLineError("The live line did not answer. A save will not reach Sruthi.");
      });
    return () => {
      cancel = true;
    };
    // Load the live line once. saveCall and savePrompt dispatch into the desk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const drafted: CallControl = {
    ...call,
    waitMs: toMs(waits.wait, snapshot.call.waitMs),
    pinWaitMs: toMs(waits.pin, snapshot.call.pinWaitMs),
    emailWaitMs: toMs(waits.email, snapshot.call.emailWaitMs),
  };
  const sameCall =
    drafted.greeting === snapshot.call.greeting &&
    drafted.endCall === snapshot.call.endCall &&
    drafted.barge === snapshot.call.barge &&
    drafted.waitMs === snapshot.call.waitMs &&
    drafted.pinWaitMs === snapshot.call.pinWaitMs &&
    drafted.emailWaitMs === snapshot.call.emailWaitMs;

  return (
    <div className="page">
      <header className="page-head">
        <p className="kicker">Sruthi</p>
        <h1>How the screening call runs</h1>
        <p className="whisper">Save here and the next call uses it. A call already in progress keeps the old lines.</p>
        {lineError && <p className="banner banner-warn">{lineError}</p>}
      </header>
      <div className="irfan-grid">
        <section className="panel call-control">
          <p className="kicker">Call control</p>
          <h2>How Sruthi handles the line</h2>
          <label className="field">
            <span>Opening line</span>
            <input
              value={call.greeting}
              onChange={(event) => setCall({ ...call, greeting: event.target.value })}
            />
          </label>
          <div className="controls">
            <div className="control">
              <div>
                <strong>End the call</strong>
                <p className="whisper">
                  When the screen is done, Sruthi says a short close, then hangs up. The hangup does not speak a second farewell.
                </p>
              </div>
              <button
                type="button"
                className={`switch${call.endCall ? " is-on" : ""}`}
                aria-pressed={call.endCall}
                aria-label="End the call"
                onClick={() => setCall({ ...call, endCall: !call.endCall })}
              />
            </div>
            <div className="control">
              <div>
                <strong>Caller can talk over her</strong>
                <p className="whisper">If the caller starts speaking while Sruthi is talking, playback stops and she listens.</p>
              </div>
              <button
                type="button"
                className={`switch${call.barge ? " is-on" : ""}`}
                aria-pressed={call.barge}
                aria-label="Caller can talk over her"
                onClick={() => setCall({ ...call, barge: !call.barge })}
              />
            </div>
          </div>
          <p className="kicker wait-label">How long she waits after they stop</p>
          <div className="wait-row">
            <label className="field">
              <span>A normal answer</span>
              <input
                inputMode="decimal"
                value={waits.wait}
                onChange={(event) => setWaits({ ...waits, wait: event.target.value })}
              />
              <small>seconds</small>
            </label>
            <label className="field">
              <span>A pincode</span>
              <input
                inputMode="decimal"
                value={waits.pin}
                onChange={(event) => setWaits({ ...waits, pin: event.target.value })}
              />
              <small>seconds</small>
            </label>
            <label className="field">
              <span>An email</span>
              <input
                inputMode="decimal"
                value={waits.email}
                onChange={(event) => setWaits({ ...waits, email: event.target.value })}
              />
              <small>seconds</small>
            </label>
          </div>
          <button
            type="button"
            className="btn btn-red"
            onClick={() => {
              void fetch("/api/desk", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(drafted),
              })
                .then(async (response) => {
                  const data = (await response.json().catch(() => null)) as { error?: string } | null;
                  if (!response.ok) {
                    setLineError(data?.error || "The line did not take this change.");
                    setSaved("");
                    return;
                  }
                  saveCall(drafted);
                  setLineError("");
                  setSaved("Call control saved");
                })
                .catch(() => {
                  setLineError("The line did not take this change.");
                  setSaved("");
                });
            }}
          >
            {saved === "Call control saved" && sameCall ? "Call control saved" : "Save call control"}
          </button>
        </section>
        <section className="panel">
          <p className="kicker">Intelligence</p>
          <h2>Aitel Brain</h2>
          <p className="model">Model Medha</p>
          <p className="whisper">Aitel Ears, model Sukshma, listens. Persona is who she is. The other sections are the rules she follows.</p>
          <PromptFields prompt={prompt} onChange={setPrompt} />
          <button
            type="button"
            className="btn btn-red"
            onClick={() => {
              void fetch("/api/desk", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt }),
              })
                .then(async (response) => {
                  const data = (await response.json().catch(() => null)) as { error?: string } | null;
                  if (!response.ok) {
                    setLineError(data?.error || "The line did not take this prompt.");
                    setSaved("");
                    return;
                  }
                  savePrompt(prompt);
                  setLineError("");
                  setSaved("Prompt saved");
                })
                .catch(() => {
                  setLineError("The line did not take this prompt.");
                  setSaved("");
                });
            }}
          >
            {saved === "Prompt saved" && prompt === snapshot.prompt ? "Prompt saved" : "Save prompt"}
          </button>
        </section>
        <section className="panel">
          <p className="kicker">Voice</p>
          <h2>Sruthi</h2>
          <p className="model">Model Dhvani</p>
          <h3>Voice cloning</h3>
          <p className="whisper">The live call already speaks from Sruthi’s clip on the phone. Replacing the file here does not swap that voice.</p>
          <div className={`clip${snapshot.voice.cloneReady ? " is-ready" : ""}`}>
            <span>{snapshot.voice.cloneFile || "No clip yet"}</span>
            <small>{snapshot.voice.cloneReady ? "Clip saved in this package" : "Add a clip"}</small>
          </div>
          <label className="file">
            Replace clip
            <input
              type="file"
              accept="audio/*,.wav,.mp3"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) saveClone(file.name);
              }}
            />
          </label>
          <h3>Voice training</h3>
          <p className="whisper">Training clips stay separate from the live clip.</p>
          <ul className="train-list">
            {snapshot.voice.trainFiles.length === 0 && <li className="empty">No training clips yet</li>}
            {snapshot.voice.trainFiles.map((file, index) => (
              <li key={`${file}-${index}`}>{file}</li>
            ))}
          </ul>
          <label className="file">
            Add training clip
            <input
              type="file"
              accept="audio/*,.wav,.mp3"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) addTrainFile(file.name);
                event.target.value = "";
              }}
            />
          </label>
          <label className="field">
            <span>Training note</span>
            <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          <button
            type="button"
            className="btn btn-gold"
            onClick={() => {
              saveTrainNote(note);
              setSaved("Note saved");
            }}
          >
            {saved === "Note saved" && note === snapshot.voice.trainNote ? "Note saved" : "Save training note"}
          </button>
        </section>
      </div>
    </div>
  );
}

function PromptFields({ prompt, onChange }: { prompt: string; onChange: (next: string) => void }) {
  const parts = splitPrompt(prompt);
  if (!parts) {
    return (
      <label className="field">
        <span>Prompt</span>
        <textarea rows={18} value={prompt} onChange={(event) => onChange(event.target.value)} />
      </label>
    );
  }
  return (
    <div className="prompt-sections">
      {PROMPT_SECTIONS.map((name) => (
        <label className="field" key={name}>
          <span>{name}</span>
          <textarea
            rows={name === "Rules" || name === "Questions" || name === "Judgement" ? 8 : 4}
            value={parts[name]}
            onChange={(event) => onChange(joinPrompt({ ...parts, [name]: event.target.value }))}
          />
        </label>
      ))}
    </div>
  );
}
