export type Filing = "open" | "lineup" | "no_lineup" | "keep" | "allowed" | "unspecified";

export interface Turn {
  speaker: "Sruthi" | "Candidate";
  text: string;
}

export interface Opening {
  id: string;
  company: string;
  title: string;
  area: string;
  shift: string;
  salary: string;
  body: string;
  openings: number;
}

export interface Candidate {
  id: string;
  name: string;
  phone: string;
  city: string;
  pincode: string;
  qualification: string;
  experience: string;
  english: string;
  shift: string;
  expectedSalary: string;
  notice: string;
  summary: string;
  transcript: Turn[];
  recordingSeconds: number;
  filed: Filing;
  outcomeLabel: string | null;
  nodeId: string | null;
  jobId: string | null;
  answers: Record<string, string>;
  screenedAt: string;
}

export interface VoiceDesk {
  cloneFile: string;
  cloneReady: boolean;
  trainFiles: string[];
  trainNote: string;
}

/** What Irfan's own call loop already does on the phone line. */
export interface CallControl {
  greeting: string;
  endCall: boolean;
  barge: boolean;
  waitMs: number;
  pinWaitMs: number;
  emailWaitMs: number;
}

export interface Snapshot {
  prompt: string;
  call: CallControl;
  voice: VoiceDesk;
  openings: Opening[];
  candidates: Candidate[];
  flows: FlowChart[];
}

export interface FlowField {
  key: string;
  label: string;
  kind: "text" | "area";
}

export type FileAs = "no_lineup" | "lineup" | "keep" | "allowed" | "unspecified";

export interface FlowNode {
  id: string;
  label: string;
  tone: "step" | "ask" | "no" | "yes" | "keep" | "allowed" | "hold";
  fileAs?: FileAs;
  needsJob?: boolean;
  fields?: FlowField[];
  branches?: { via: string; to: string }[];
  x?: number;
  y?: number;
}

export interface FlowEntry {
  label: string;
  root: string;
}

export interface FlowChart {
  id: string;
  index: string;
  title: string;
  root: string;
  nodes: Record<string, FlowNode>;
  /** Extra trees on the same chart, sharing the same boxes. */
  entries?: FlowEntry[];
}

export const FILING_LABEL: Record<Filing, string> = {
  open: "On the screen",
  lineup: "Lineup",
  no_lineup: "No lineup",
  keep: "Keep screening",
  allowed: "Lineup still allowed",
  unspecified: "Outcome not specified",
};
