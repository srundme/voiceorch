import type { FlowChart, FlowNode } from "./model";

function chart(
  id: string,
  index: string,
  title: string,
  root: string,
  list: FlowNode[],
  entries?: FlowChart["entries"],
): FlowChart {
  const nodes: Record<string, FlowNode> = {};
  for (const node of list) nodes[node.id] = node;
  return entries ? { id, index, title, root, nodes, entries } : { id, index, title, root, nodes };
}

const step = (id: string, label: string, branches?: FlowNode["branches"]): FlowNode => ({
  id,
  label,
  tone: "step",
  ...(branches ? { branches } : {}),
});

const ask = (id: string, label: string, branches?: FlowNode["branches"]): FlowNode => ({
  id,
  label,
  tone: "ask",
  ...(branches ? { branches } : {}),
});

export const FLOWS: FlowChart[] = [
  chart("start", "01", "Call starts", "c1-start", [
    step("c1-start", "Call starts", [{ via: "", to: "c1-what" }]),
    ask("c1-what", "What happens?", [
      { via: "Nobody / machine", to: "c1-vm" },
      { via: "Stop calling / DND / not looking / dislikes Jobshop", to: "c1-ni" },
      { via: "Another Jobshop recruiter already has them", to: "c1-or" },
      { via: "Cannot talk now", to: "c1-busy" },
    ]),
    step("c1-vm", "Voice Mail", [{ via: "", to: "c1-vm-end" }]),
    step("c1-ni", "Not Interested", [{ via: "", to: "c1-ni-end" }]),
    step("c1-or", "Other Recruiter", [{ via: "", to: "c1-or-end" }]),
    step("c1-busy", "Busy, Call me Back", [{ via: "", to: "c1-busy-end" }]),
    {
      id: "c1-vm-end",
      label: "No follow-up; hang up",
      tone: "no",
      fileAs: "no_lineup",
    },
    {
      id: "c1-ni-end",
      label: "Record reason",
      tone: "no",
      fileAs: "no_lineup",
      fields: [{ key: "reason", label: "Reason", kind: "area" }],
    },
    {
      id: "c1-or-end",
      label: "Record recruiter name",
      tone: "no",
      fileAs: "no_lineup",
      fields: [{ key: "recruiter", label: "Recruiter name", kind: "text" }],
    },
    {
      id: "c1-busy-end",
      label: "Record English if assessed; ask about callback",
      tone: "no",
      fileAs: "no_lineup",
      fields: [
        { key: "english", label: "English, if it was judged", kind: "text" },
        { key: "callback", label: "Callback", kind: "text" },
      ],
    },
  ]),
  chart("died", "02", "Line dies before screening finishes", "c2-die", [
    step("c2-die", "Line dies before screening finishes", [{ via: "", to: "c2-drop" }]),
    step("c2-drop", "Call Disconnected", [{ via: "", to: "c2-judge" }]),
    ask("c2-judge", "Could English be judged?", [
      { via: "No", to: "c2-no-judge" },
      { via: "Yes", to: "c2-poor" },
    ]),
    {
      id: "c2-no-judge",
      label: "No lineup",
      tone: "no",
      fileAs: "no_lineup",
    },
    ask("c2-poor", "English is Poor or Average?", [
      { via: "Yes", to: "c2-fit" },
      { via: "Another level", to: "c2-unspecified" },
    ]),
    {
      id: "c2-unspecified",
      label: "Outcome not specified in supplied rules",
      tone: "hold",
      fileAs: "unspecified",
    },
    step("c2-weak", "English too weak for requested process", [{ via: "", to: "c2-poor-comm" }]),
    step("c2-poor-comm", "Poor Communication", [{ via: "", to: "c2-comm-reason" }]),
    {
      id: "c2-comm-reason",
      label: "Record communication reason",
      tone: "step",
      fields: [{ key: "communication", label: "Communication reason", kind: "area" }],
      branches: [{ via: "", to: "c2-fit" }],
    },
    ask("c2-fit", "Fits domestic voice or non-voice?", [
      { via: "Yes", to: "c2-yes" },
      { via: "Neither", to: "c2-neither" },
    ]),
    {
      id: "c2-yes",
      label: "Lineup",
      tone: "yes",
      fileAs: "lineup",
      needsJob: true,
      fields: [{ key: "fit", label: "Domestic voice or non-voice", kind: "text" }],
    },
    {
      id: "c2-neither",
      label: "No lineup",
      tone: "no",
      fileAs: "no_lineup",
    },
  ], [{ label: "Also enters the same fit question", root: "c2-weak" }]),
  chart("situation", "03", "Candidate situation", "c3-root", [
    ask("c3-root", "Candidate situation", [
      { via: "", to: "c3-domain" },
      { via: "", to: "c3-out" },
      { via: "", to: "c3-wfh" },
      { via: "", to: "c3-zone" },
    ]),
    step("c3-domain", "Other Domain Experience", [{ via: "", to: "c3-bpo" }]),
    ask("c3-bpo", "Will consider a BPO job?", [
      { via: "Yes", to: "c3-bpo-yes" },
      { via: "No", to: "c3-bpo-no" },
    ]),
    { id: "c3-bpo-yes", label: "Lineup", tone: "yes", fileAs: "lineup", needsJob: true },
    { id: "c3-bpo-no", label: "No lineup", tone: "no", fileAs: "no_lineup" },
    step("c3-out", "Out Station Candidate", [{ via: "", to: "c3-out-end" }]),
    {
      id: "c3-out-end",
      label: "Outside Bangalore; will not relocate",
      tone: "no",
      fileAs: "no_lineup",
      fields: [{ key: "city", label: "City", kind: "text" }],
    },
    step("c3-wfh", "Work from Home", [{ via: "", to: "c3-office" }]),
    ask("c3-office", "Will come to the office?", [
      { via: "Yes", to: "c3-office-yes" },
      { via: "No", to: "c3-office-no" },
    ]),
    { id: "c3-office-yes", label: "Lineup", tone: "yes", fileAs: "lineup", needsJob: true },
    { id: "c3-office-no", label: "No lineup", tone: "no", fileAs: "no_lineup" },
    step("c3-zone", "Non Hiring Zone", [{ via: "", to: "c3-stay" }]),
    ask("c3-stay", "Stay and relocation", [
      { via: "In a PG AND willing to relocate", to: "c3-pg" },
      { via: "With family OR unwilling to relocate", to: "c3-family" },
    ]),
    { id: "c3-pg", label: "Lineup", tone: "yes", fileAs: "lineup", needsJob: true },
    { id: "c3-family", label: "No lineup", tone: "no", fileAs: "no_lineup" },
  ]),
  chart("eligibility", "04", "Eligibility issue", "c4-root", [
    ask("c4-root", "Eligibility issue", [
      { via: "", to: "c4-college" },
      { via: "", to: "c4-edu" },
      { via: "", to: "c4-dob" },
      { via: "", to: "c4-gap" },
      { via: "", to: "c4-docs" },
    ]),
    step("c4-college", "College / board companies will not hire", [{ via: "", to: "c4-uni" }]),
    {
      id: "c4-uni",
      label: "Non Hiring University",
      tone: "no",
      fileAs: "no_lineup",
      fields: [{ key: "college", label: "College or board", kind: "text" }],
    },
    step("c4-edu", "No education documents", [{ via: "", to: "c4-edu-end" }]),
    {
      id: "c4-edu-end",
      label: "No Education Documents; no follow-up",
      tone: "no",
      fileAs: "no_lineup",
    },
    step("c4-dob", "DOB outside the job's written age range", [{ via: "", to: "c4-age" }]),
    {
      id: "c4-age",
      label: "Age Limit",
      tone: "no",
      fileAs: "no_lineup",
      fields: [{ key: "dob", label: "Date of birth", kind: "text" }],
    },
    ask("c4-gap", "Career gap", [
      { via: "Gap prevents lineup", to: "c4-gap-end" },
      { via: "Gap explained", to: "c4-keep" },
    ]),
    {
      id: "c4-gap-end",
      label: "Career Gap",
      tone: "no",
      fileAs: "no_lineup",
      fields: [{ key: "gap", label: "Gap", kind: "area" }],
    },
    {
      id: "c4-keep",
      label: "Keep screening",
      tone: "keep",
      fileAs: "keep",
      fields: [{ key: "gap", label: "What they did in the gap", kind: "area" }],
    },
    step("c4-docs", "Experienced; required work documents missing", [{ via: "", to: "c4-docs-end" }]),
    {
      id: "c4-docs-end",
      label: "No Experience Documents; no follow-up",
      tone: "no",
      fileAs: "no_lineup",
    },
  ]),
  chart("finding", "05", "Screening finding", "c5-root", [
    ask("c5-root", "Screening finding", [
      { via: "", to: "c5-notice" },
      { via: "", to: "c5-cool" },
      { via: "", to: "c5-shift" },
      { via: "", to: "c5-pay" },
      { via: "", to: "c5-weekend" },
    ]),
    step("c5-notice", "Still working; resigns only after offer", [{ via: "", to: "c5-notice-end" }]),
    {
      id: "c5-notice-end",
      label: "Serving Notice; remind later",
      tone: "no",
      fileAs: "no_lineup",
      fields: [
        { key: "notice", label: "Notice", kind: "text" },
        { key: "lastDay", label: "Last working day", kind: "text" },
      ],
    },
    step("c5-cool", "Already interviewed at / worked at offered company", [{ via: "", to: "c5-cool-end" }]),
    {
      id: "c5-cool-end",
      label: "Cooling Period",
      tone: "no",
      fileAs: "no_lineup",
      fields: [{ key: "company", label: "Company", kind: "text" }],
    },
    step("c5-shift", "Shift blocks every returned job", [{ via: "", to: "c5-shift-q" }]),
    ask("c5-shift-q", "Shift Issues — proceed to lineup?", [
      { via: "Yes", to: "c5-shift-yes" },
      { via: "No", to: "c5-shift-no" },
    ]),
    { id: "c5-shift-yes", label: "Lineup", tone: "yes", fileAs: "lineup", needsJob: true },
    { id: "c5-shift-no", label: "No lineup", tone: "no", fileAs: "no_lineup" },
    step("c5-pay", "Salary expectation exceeds every returned job", [{ via: "", to: "c5-pay-q" }]),
    ask("c5-pay-q", "High Salary — a company pays it?", [
      { via: "Yes", to: "c5-pay-yes" },
      { via: "No", to: "c5-pay-no" },
    ]),
    {
      id: "c5-pay-yes",
      label: "Record company, process and reminder",
      tone: "no",
      fileAs: "no_lineup",
      fields: [
        { key: "company", label: "Company", kind: "text" },
        { key: "process", label: "Process", kind: "text" },
        { key: "reminder", label: "Reminder", kind: "text" },
      ],
    },
    { id: "c5-pay-no", label: "No lineup", tone: "no", fileAs: "no_lineup" },
    step("c5-weekend", "Must have weekends off", [{ via: "", to: "c5-weekend-end" }]),
    {
      id: "c5-weekend-end",
      label: "Need Weekend Off; no extra question",
      tone: "allowed",
      fileAs: "allowed",
      needsJob: true,
    },
  ]),
  chart("match", "06", "Job matcher", "c6-root", [
    step("c6-root", "Job matcher", [{ via: "", to: "c6-result" }]),
    ask("c6-result", "Result", [
      { via: "No job returned", to: "c6-none" },
      { via: "Job returned", to: "c6-accept" },
    ]),
    step("c6-none", "No Company", [{ via: "", to: "c6-none-end" }]),
    {
      id: "c6-none-end",
      label: "Record reason",
      tone: "no",
      fileAs: "no_lineup",
      fields: [{ key: "reason", label: "Reason", kind: "area" }],
    },
    ask("c6-accept", "Candidate accepts?", [
      { via: "Yes", to: "c6-scheduled" },
      { via: "No", to: "c6-other" },
    ]),
    step("c6-scheduled", "Line Up Scheduled", [{ via: "", to: "c6-details" }]),
    {
      id: "c6-details",
      label: "Record required candidate and job details",
      tone: "yes",
      fileAs: "lineup",
      needsJob: true,
      fields: [
        { key: "round", label: "Interview round", kind: "text" },
        { key: "when", label: "Date and time, if they gave one", kind: "text" },
      ],
    },
    {
      id: "c6-other",
      label: "Use the applicable reason from screening",
      tone: "ask",
    },
  ]),
];
