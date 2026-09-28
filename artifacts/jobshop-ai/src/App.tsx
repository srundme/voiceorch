import { useState } from "react";
import { browserPort, type JobshopPort } from "./port";
import { DeskProvider } from "./store";
import { CallPage } from "./views/CallPage";
import { CallsPage } from "./views/CallsPage";
import { IrfanPage } from "./views/IrfanPage";
import { JobsPage } from "./views/JobsPage";

type Section = "desk" | "openings" | "sruthi";
type Page = { name: Section } | { name: "call"; id: string };

const NAV: { id: Section; label: string }[] = [
  { id: "desk", label: "Screen" },
  { id: "openings", label: "Openings" },
  { id: "sruthi", label: "Sruthi" },
];

export function JobshopApp({ port }: { port: JobshopPort }) {
  return (
    <DeskProvider port={port}>
      <Shell />
    </DeskProvider>
  );
}

function Shell() {
  const [page, setPage] = useState<Page>({ name: "desk" });
  const section = page.name === "call" ? "desk" : page.name;

  return (
    <div className="app">
      <aside className="nav">
        <div className="brand">
          <img src="/logo.webp" alt="Jobshop" className="logo" />
        </div>
        <nav className="nav-links" aria-label="Screening">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={section === item.id ? "is-on" : ""}
              onClick={() => setPage({ name: item.id } satisfies Page)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <p className="nav-note">Sruthi asks. You file the result.</p>
      </aside>
      <main>
        {page.name === "desk" && <CallsPage onOpen={(id) => setPage({ name: "call", id })} />}
        {page.name === "call" && (
          <CallPage id={page.id} onBack={() => setPage({ name: "desk" })} />
        )}
        {page.name === "openings" && <JobsPage onOpen={(id) => setPage({ name: "call", id })} />}
        {page.name === "sruthi" && <IrfanPage />}
      </main>
    </div>
  );
}

export function App() {
  return <JobshopApp port={browserPort} />;
}
