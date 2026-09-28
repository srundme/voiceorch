import { createContext, useContext, useEffect, useReducer, type ReactNode } from "react";
import {
  addBox,
  addChart,
  connectBoxes,
  cutLink,
  deleteChart,
  dropBox,
  moveNodes,
  readFlows,
  removeBox,
  renameChart,
  retargetLink,
  setAsk,
  setLabel,
  setOutcome,
  setVia,
  suppliedFlows,
  writeNode,
} from "./flow-edit";
import type { CallControl, Candidate, FileAs, FlowField, Opening, Snapshot, VoiceDesk } from "./model";
import type { JobshopPort } from "./port";
import { SEED } from "./seed";

type Action =
  | { type: "prompt"; prompt: string }
  | { type: "call"; call: CallControl }
  | { type: "clone"; file: string }
  | { type: "train-add"; file: string }
  | { type: "train-note"; note: string }
  | { type: "opening"; opening: Opening }
  | { type: "candidate"; candidate: Candidate }
  | {
      type: "file";
      id: string;
      nodeId: string;
      outcomeLabel: string;
      filed: Candidate["filed"];
      jobId: string | null;
      answers: Record<string, string>;
    }
  | { type: "answers"; id: string; answers: Record<string, string> }
  | { type: "patch"; id: string; patch: Partial<Candidate> }
  | { type: "flow-rename"; chartId: string; title: string }
  | {
      type: "flow-node";
      chartId: string;
      nodeId: string;
      label: string;
      fileAs: FileAs | null;
      needsJob: boolean;
      fields: FlowField[];
      vias: string[];
    }
  | { type: "flow-add-box"; chartId: string; fromId: string; via: string; label: string }
  | { type: "flow-remove"; chartId: string; nodeId: string }
  | { type: "flow-add"; title: string; id: string }
  | { type: "flow-restore" }
  | { type: "flow-delete"; chartId: string }
  | { type: "flow-move"; chartId: string; places: Record<string, { x: number; y: number }> }
  | { type: "flow-drop"; chartId: string; id: string; label: string }
  | { type: "flow-retarget"; chartId: string; fromId: string; oldTo: string; newTo: string }
  | { type: "flow-connect"; chartId: string; fromId: string; toId: string }
  | { type: "flow-cut"; chartId: string; fromId: string; toId: string }
  | { type: "flow-via"; chartId: string; fromId: string; toId: string; via: string }
  | { type: "flow-label"; chartId: string; nodeId: string; label: string }
  | { type: "flow-outcome"; chartId: string; nodeId: string; fileAs: FileAs | null; needsJob: boolean }
  | { type: "flow-ask"; chartId: string; nodeId: string; text: string };

function fileOpenings(openings: Opening[], previousJob: string | null, nextJob: string | null): Opening[] {
  return openings.map((opening) => {
    if (previousJob && previousJob === opening.id && previousJob !== nextJob) {
      return { ...opening, openings: opening.openings + 1 };
    }
    if (nextJob && nextJob === opening.id && previousJob !== nextJob) {
      return { ...opening, openings: Math.max(0, opening.openings - 1) };
    }
    return opening;
  });
}

function reduce(state: Snapshot, action: Action): Snapshot {
  switch (action.type) {
    case "prompt":
      return { ...state, prompt: action.prompt };
    case "call":
      return { ...state, call: action.call };
    case "clone":
      return { ...state, voice: { ...state.voice, cloneFile: action.file, cloneReady: true } };
    case "train-add":
      return {
        ...state,
        voice: { ...state.voice, trainFiles: [...state.voice.trainFiles, action.file] },
      };
    case "train-note":
      return { ...state, voice: { ...state.voice, trainNote: action.note } };
    case "opening":
      return { ...state, openings: [action.opening, ...state.openings] };
    case "candidate":
      return { ...state, candidates: [action.candidate, ...state.candidates] };
    case "patch":
      return {
        ...state,
        candidates: state.candidates.map((candidate) =>
          candidate.id === action.id ? { ...candidate, ...action.patch, id: candidate.id } : candidate,
        ),
      };
    case "answers":
      return {
        ...state,
        candidates: state.candidates.map((candidate) =>
          candidate.id === action.id
            ? { ...candidate, answers: { ...candidate.answers, ...action.answers } }
            : candidate,
        ),
      };
    case "flow-rename":
      return { ...state, flows: renameChart(state.flows, action.chartId, action.title) };
    case "flow-node":
      return {
        ...state,
        flows: writeNode(state.flows, action.chartId, action.nodeId, {
          label: action.label,
          fileAs: action.fileAs,
          needsJob: action.needsJob,
          fields: action.fields,
          vias: action.vias,
        }),
      };
    case "flow-add-box":
      return { ...state, flows: addBox(state.flows, action.chartId, action.fromId, action.via, action.label) };
    case "flow-remove":
      return { ...state, flows: removeBox(state.flows, action.chartId, action.nodeId) };
    case "flow-add":
      return { ...state, flows: addChart(state.flows, action.title, action.id) };
    case "flow-restore":
      return { ...state, flows: suppliedFlows() };
    case "flow-delete":
      return { ...state, flows: deleteChart(state.flows, action.chartId) };
    case "flow-move":
      return { ...state, flows: moveNodes(state.flows, action.chartId, action.places) };
    case "flow-drop":
      return { ...state, flows: dropBox(state.flows, action.chartId, action.id, action.label) };
    case "flow-retarget":
      return { ...state, flows: retargetLink(state.flows, action.chartId, action.fromId, action.oldTo, action.newTo) };
    case "flow-connect":
      return { ...state, flows: connectBoxes(state.flows, action.chartId, action.fromId, action.toId) };
    case "flow-cut":
      return { ...state, flows: cutLink(state.flows, action.chartId, action.fromId, action.toId) };
    case "flow-via":
      return { ...state, flows: setVia(state.flows, action.chartId, action.fromId, action.toId, action.via) };
    case "flow-label":
      return { ...state, flows: setLabel(state.flows, action.chartId, action.nodeId, action.label) };
    case "flow-outcome":
      return { ...state, flows: setOutcome(state.flows, action.chartId, action.nodeId, action.fileAs, action.needsJob) };
    case "flow-ask":
      return { ...state, flows: setAsk(state.flows, action.chartId, action.nodeId, action.text) };
    case "file":
      return {
        ...state,
        openings: fileOpenings(
          state.openings,
          state.candidates.find((candidate) => candidate.id === action.id)?.jobId ?? null,
          action.jobId,
        ),
        candidates: state.candidates.map((candidate) =>
          candidate.id === action.id
            ? {
                ...candidate,
                nodeId: action.nodeId,
                outcomeLabel: action.outcomeLabel,
                filed: action.filed,
                jobId: action.jobId,
                answers: { ...candidate.answers, ...action.answers },
              }
            : candidate,
        ),
      };
    default:
      return state;
  }
}

interface Desk {
  snapshot: Snapshot;
  savePrompt: (prompt: string) => void;
  saveCall: (call: CallControl) => void;
  saveClone: (file: string) => void;
  addTrainFile: (file: string) => void;
  saveTrainNote: (note: string) => void;
  addOpening: (opening: Opening) => void;
  addCandidate: (candidate: Candidate) => void;
  fileCandidate: (action: Omit<Extract<Action, { type: "file" }>, "type">) => void;
  saveAnswers: (id: string, answers: Record<string, string>) => void;
  patchCandidate: (id: string, patch: Partial<Candidate>) => void;
  renameFlow: (chartId: string, title: string) => void;
  saveFlowNode: (action: Omit<Extract<Action, { type: "flow-node" }>, "type">) => void;
  addFlowBox: (chartId: string, fromId: string, via: string, label: string) => void;
  removeFlowBox: (chartId: string, nodeId: string) => void;
  addFlow: (title: string) => string;
  restoreFlows: () => void;
  deleteFlow: (chartId: string) => void;
  moveFlow: (chartId: string, places: Record<string, { x: number; y: number }>) => void;
  dropFlowBox: (chartId: string, id: string, label: string) => void;
  retargetFlow: (chartId: string, fromId: string, oldTo: string, newTo: string) => void;
  connectFlow: (chartId: string, fromId: string, toId: string) => void;
  cutFlow: (chartId: string, fromId: string, toId: string) => void;
  setFlowVia: (chartId: string, fromId: string, toId: string, via: string) => void;
  setFlowLabel: (chartId: string, nodeId: string, label: string) => void;
  setFlowOutcome: (chartId: string, nodeId: string, fileAs: FileAs | null, needsJob: boolean) => void;
  setFlowAsk: (chartId: string, nodeId: string, text: string) => void;
}

const DeskContext = createContext<Desk | null>(null);

function readMs(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(8000, Math.max(200, Math.round(n)));
}

function readGreeting(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text === "Hello, this is Irfan from Jobshop. How may I assist you?") {
    return SEED.call.greeting;
  }
  return text;
}

function readCall(raw: unknown): CallControl {
  const call = raw && typeof raw === "object" ? (raw as Partial<CallControl>) : {};
  return {
    greeting: readGreeting(call.greeting),
    endCall: call.endCall !== false,
    barge: call.barge !== false,
    waitMs: readMs(call.waitMs, SEED.call.waitMs),
    pinWaitMs: readMs(call.pinWaitMs, SEED.call.pinWaitMs),
    emailWaitMs: readMs(call.emailWaitMs, SEED.call.emailWaitMs),
  };
}

function load(port: JobshopPort): Snapshot {
  const saved = port.read();
  if (!saved || !Array.isArray(saved.candidates) || !Array.isArray(saved.openings) || !saved.voice) {
    return SEED;
  }
  const voice = saved.voice as VoiceDesk;
  return {
    prompt: typeof saved.prompt === "string" ? saved.prompt : SEED.prompt,
    call: readCall(saved.call),
    voice: {
      cloneFile: voice.cloneFile || SEED.voice.cloneFile,
      cloneReady: Boolean(voice.cloneReady),
      trainFiles: Array.isArray(voice.trainFiles) ? voice.trainFiles : [],
      trainNote: voice.trainNote ?? "",
    },
    openings: saved.openings,
    candidates: saved.candidates,
    flows: readFlows(saved.flows),
  };
}

export function DeskProvider({ port, children }: { port: JobshopPort; children: ReactNode }) {
  const [snapshot, dispatch] = useReducer(reduce, port, load);

  useEffect(() => {
    port.write(snapshot);
  }, [port, snapshot]);

  const desk: Desk = {
    snapshot,
    savePrompt: (prompt) => dispatch({ type: "prompt", prompt }),
    saveCall: (call) => dispatch({ type: "call", call }),
    saveClone: (file) => dispatch({ type: "clone", file }),
    addTrainFile: (file) => dispatch({ type: "train-add", file }),
    saveTrainNote: (note) => dispatch({ type: "train-note", note }),
    addOpening: (opening) => dispatch({ type: "opening", opening }),
    addCandidate: (candidate) => dispatch({ type: "candidate", candidate }),
    fileCandidate: (action) => dispatch({ type: "file", ...action }),
    saveAnswers: (id, answers) => dispatch({ type: "answers", id, answers }),
    patchCandidate: (id, patch) => dispatch({ type: "patch", id, patch }),
    renameFlow: (chartId, title) => dispatch({ type: "flow-rename", chartId, title }),
    saveFlowNode: (action) => dispatch({ type: "flow-node", ...action }),
    addFlowBox: (chartId, fromId, via, label) => dispatch({ type: "flow-add-box", chartId, fromId, via, label }),
    removeFlowBox: (chartId, nodeId) => dispatch({ type: "flow-remove", chartId, nodeId }),
    addFlow: (title) => {
      const id = `flow-${Date.now()}`;
      dispatch({ type: "flow-add", title, id });
      return id;
    },
    restoreFlows: () => dispatch({ type: "flow-restore" }),
    deleteFlow: (chartId) => dispatch({ type: "flow-delete", chartId }),
    moveFlow: (chartId, places) => dispatch({ type: "flow-move", chartId, places }),
    dropFlowBox: (chartId, id, label) => dispatch({ type: "flow-drop", chartId, id, label }),
    retargetFlow: (chartId, fromId, oldTo, newTo) => dispatch({ type: "flow-retarget", chartId, fromId, oldTo, newTo }),
    connectFlow: (chartId, fromId, toId) => dispatch({ type: "flow-connect", chartId, fromId, toId }),
    cutFlow: (chartId, fromId, toId) => dispatch({ type: "flow-cut", chartId, fromId, toId }),
    setFlowVia: (chartId, fromId, toId, via) => dispatch({ type: "flow-via", chartId, fromId, toId, via }),
    setFlowLabel: (chartId, nodeId, label) => dispatch({ type: "flow-label", chartId, nodeId, label }),
    setFlowOutcome: (chartId, nodeId, fileAs, needsJob) => dispatch({ type: "flow-outcome", chartId, nodeId, fileAs, needsJob }),
    setFlowAsk: (chartId, nodeId, text) => dispatch({ type: "flow-ask", chartId, nodeId, text }),
  };

  return <DeskContext.Provider value={desk}>{children}</DeskContext.Provider>;
}

export function useDesk(): Desk {
  const desk = useContext(DeskContext);
  if (!desk) throw new Error("Desk is missing");
  return desk;
}
