import type { Filing } from "./model";

export interface OutcomeChoice {
  id: string;
  label: string;
  filed: Filing;
  job: boolean;
}

/** What Jobshop can set after Irfan finishes a screening. */
export const OUTCOMES: OutcomeChoice[] = [
  { id: "line_up", label: "Line up scheduled", filed: "lineup", job: true },
  { id: "weekend", label: "Need weekend off — lineup still allowed", filed: "allowed", job: true },
  { id: "keep", label: "Keep screening", filed: "keep", job: false },
  { id: "voice_mail", label: "Voice mail", filed: "no_lineup", job: false },
  { id: "not_interested", label: "Not interested", filed: "no_lineup", job: false },
  { id: "other_recruiter", label: "Other recruiter", filed: "no_lineup", job: false },
  { id: "busy", label: "Busy, call me back", filed: "no_lineup", job: false },
  { id: "disconnected", label: "Call disconnected", filed: "no_lineup", job: false },
  { id: "poor", label: "Poor communication", filed: "no_lineup", job: false },
  { id: "outstation", label: "Out station, will not relocate", filed: "no_lineup", job: false },
  { id: "wfh", label: "Work from home, will not come to office", filed: "no_lineup", job: false },
  { id: "zone", label: "Non hiring zone", filed: "no_lineup", job: false },
  { id: "university", label: "Non hiring university", filed: "no_lineup", job: false },
  { id: "edu_docs", label: "No education documents", filed: "no_lineup", job: false },
  { id: "age", label: "Age limit", filed: "no_lineup", job: false },
  { id: "gap", label: "Career gap", filed: "no_lineup", job: false },
  { id: "exp_docs", label: "No experience documents", filed: "no_lineup", job: false },
  { id: "notice", label: "Serving notice", filed: "no_lineup", job: false },
  { id: "cooling", label: "Cooling period", filed: "no_lineup", job: false },
  { id: "shift", label: "Shift issues", filed: "no_lineup", job: false },
  { id: "salary", label: "High salary", filed: "no_lineup", job: false },
  { id: "no_company", label: "No company", filed: "no_lineup", job: false },
];

export function outcomeById(id: string | null): OutcomeChoice | undefined {
  return OUTCOMES.find((item) => item.id === id);
}
