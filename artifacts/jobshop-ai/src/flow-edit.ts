import type { FileAs, FlowChart, FlowField, FlowNode } from "./model";
import { FLOWS } from "./flows";

export function suppliedFlows(): FlowChart[] {
  return structuredClone(FLOWS);
}

export function toneFor(fileAs: FileAs | null, branched: boolean): FlowNode["tone"] {
  if (fileAs === "no_lineup") return "no";
  if (fileAs === "lineup") return "yes";
  if (fileAs === "allowed") return "allowed";
  if (fileAs === "keep") return "keep";
  if (fileAs === "unspecified") return "hold";
  return branched ? "ask" : "step";
}

export function readFlows(raw: unknown): FlowChart[] {
  if (!Array.isArray(raw) || raw.length === 0) return suppliedFlows();
  const charts = raw.filter((item): item is FlowChart => {
    if (!item || typeof item !== "object") return false;
    const chart = item as FlowChart;
    return typeof chart.id === "string" && typeof chart.root === "string" && !!chart.nodes && typeof chart.nodes === "object";
  });
  return charts.length > 0 ? charts : suppliedFlows();
}

function mapChart(flows: FlowChart[], chartId: string, change: (chart: FlowChart) => FlowChart): FlowChart[] {
  return flows.map((chart) => (chart.id === chartId ? change(chart) : chart));
}

export function renameChart(flows: FlowChart[], chartId: string, title: string): FlowChart[] {
  const next = title.trim();
  if (!next) return flows;
  return mapChart(flows, chartId, (chart) => ({ ...chart, title: next }));
}

export function writeNode(
  flows: FlowChart[],
  chartId: string,
  nodeId: string,
  patch: {
    label: string;
    fileAs: FileAs | null;
    needsJob: boolean;
    fields: FlowField[];
    vias: string[];
  },
): FlowChart[] {
  return mapChart(flows, chartId, (chart) => {
    const current = chart.nodes[nodeId];
    if (!current) return chart;
    const branches = (current.branches ?? []).map((branch, index) => ({
      ...branch,
      via: patch.vias[index] ?? branch.via,
    }));
    const next: FlowNode = {
      id: current.id,
      label: patch.label.trim() || current.label,
      tone: toneFor(patch.fileAs, branches.length > 0),
      ...(patch.fileAs ? { fileAs: patch.fileAs } : {}),
      ...(patch.needsJob ? { needsJob: true } : {}),
      ...(patch.fields.length > 0 ? { fields: patch.fields } : {}),
      ...(branches.length > 0 ? { branches } : {}),
      ...(typeof current.x === "number" ? { x: current.x, y: current.y } : {}),
    };
    return { ...chart, nodes: { ...chart.nodes, [nodeId]: next } };
  });
}

export function addBox(
  flows: FlowChart[],
  chartId: string,
  fromId: string,
  via: string,
  label: string,
): FlowChart[] {
  const id = `box-${Date.now()}`;
  return mapChart(flows, chartId, (chart) => {
    const parent = chart.nodes[fromId];
    if (!parent) return chart;
    const child: FlowNode = { id, label: label.trim() || "New box", tone: "step" };
    const parentNext: FlowNode = {
      ...parent,
      tone: parent.fileAs ? parent.tone : "ask",
      branches: [...(parent.branches ?? []), { via: via.trim(), to: id }],
    };
    return { ...chart, nodes: { ...chart.nodes, [fromId]: parentNext, [id]: child } };
  });
}

export function removeBox(flows: FlowChart[], chartId: string, nodeId: string): FlowChart[] {
  return mapChart(flows, chartId, (chart) => {
    if (!chart.nodes[nodeId]) return chart;
    const nodes: Record<string, FlowNode> = {};
    for (const [id, node] of Object.entries(chart.nodes)) {
      if (id === nodeId) continue;
      const branches = (node.branches ?? []).filter((branch) => branch.to !== nodeId);
      nodes[id] = branches.length > 0 ? { ...node, branches } : { ...node, branches: undefined };
    }
    let root = chart.root === nodeId ? Object.keys(nodes)[0] : chart.root;
    if (!root || !nodes[root]) {
      const id = `box-${Date.now()}`;
      nodes[id] = { id, label: "Start", tone: "step", x: 48, y: 48 };
      root = id;
    }
    const entries = (chart.entries ?? []).filter((entry) => entry.root !== nodeId && nodes[entry.root]);
    return { ...chart, root, nodes, ...(entries.length > 0 ? { entries } : { entries: undefined }) };
  });
}

export function addChart(flows: FlowChart[], title: string, id = `flow-${Date.now()}`): FlowChart[] {
  const root = `${id}-start`;
  const name = title.trim() || "New flow";
  const chart: FlowChart = {
    id,
    index: String(flows.length + 1).padStart(2, "0"),
    title: name,
    root,
    nodes: { [root]: { id: root, label: "Start", tone: "step", x: 48, y: 48 } },
  };
  return [...flows, chart];
}

export function deleteChart(flows: FlowChart[], chartId: string): FlowChart[] {
  const next = flows.filter((chart) => chart.id !== chartId);
  return next.length > 0 ? next : addChart([], "New flow");
}

export function moveNodes(flows: FlowChart[], chartId: string, places: Record<string, { x: number; y: number }>): FlowChart[] {
  return mapChart(flows, chartId, (chart) => {
    const nodes: Record<string, FlowNode> = { ...chart.nodes };
    for (const [id, place] of Object.entries(places)) {
      if (!nodes[id]) continue;
      nodes[id] = { ...nodes[id], x: place.x, y: place.y };
    }
    return { ...chart, nodes };
  });
}

export function dropBox(flows: FlowChart[], chartId: string, id: string, label: string): FlowChart[] {
  const node: FlowNode = { id, label: label.trim() || "New box", tone: "step" };
  return mapChart(flows, chartId, (chart) => (chart.nodes[id] ? chart : { ...chart, nodes: { ...chart.nodes, [id]: node } }));
}

export function connectBoxes(flows: FlowChart[], chartId: string, fromId: string, toId: string): FlowChart[] {
  if (fromId === toId) return flows;
  return mapChart(flows, chartId, (chart) => {
    const from = chart.nodes[fromId];
    if (!from || !chart.nodes[toId]) return chart;
    if ((from.branches ?? []).some((branch) => branch.to === toId)) return chart;
    return {
      ...chart,
      nodes: {
        ...chart.nodes,
        [fromId]: { ...from, branches: [...(from.branches ?? []), { via: "", to: toId }] },
      },
    };
  });
}

export function cutLink(flows: FlowChart[], chartId: string, fromId: string, toId: string): FlowChart[] {
  return mapChart(flows, chartId, (chart) => {
    const from = chart.nodes[fromId];
    if (!from) return chart;
    const branches = (from.branches ?? []).filter((branch) => branch.to !== toId);
    return {
      ...chart,
      nodes: {
        ...chart.nodes,
        [fromId]: branches.length > 0 ? { ...from, branches } : { ...from, branches: undefined },
      },
    };
  });
}

export function setVia(flows: FlowChart[], chartId: string, fromId: string, toId: string, via: string): FlowChart[] {
  return mapChart(flows, chartId, (chart) => {
    const from = chart.nodes[fromId];
    if (!from) return chart;
    return {
      ...chart,
      nodes: {
        ...chart.nodes,
        [fromId]: {
          ...from,
          branches: (from.branches ?? []).map((branch) => (branch.to === toId ? { ...branch, via } : branch)),
        },
      },
    };
  });
}

export function setLabel(flows: FlowChart[], chartId: string, nodeId: string, label: string): FlowChart[] {
  if (!label.trim()) return flows;
  return mapChart(flows, chartId, (chart) => {
    const node = chart.nodes[nodeId];
    if (!node) return chart;
    return { ...chart, nodes: { ...chart.nodes, [nodeId]: { ...node, label } } };
  });
}

export function retargetLink(flows: FlowChart[], chartId: string, fromId: string, oldTo: string, newTo: string): FlowChart[] {
  if (fromId === newTo || oldTo === newTo) return flows;
  return mapChart(flows, chartId, (chart) => {
    const from = chart.nodes[fromId];
    if (!from || !chart.nodes[newTo]) return chart;
    const branches = (from.branches ?? []).flatMap((branch) => {
      if (branch.to !== oldTo) return [branch];
      if ((from.branches ?? []).some((other) => other.to === newTo)) return [];
      return [{ ...branch, to: newTo }];
    });
    return {
      ...chart,
      nodes: {
        ...chart.nodes,
        [fromId]: branches.length > 0 ? { ...from, branches } : { ...from, branches: undefined },
      },
    };
  });
}

export function setOutcome(
  flows: FlowChart[],
  chartId: string,
  nodeId: string,
  fileAs: FileAs | null,
  needsJob: boolean,
): FlowChart[] {
  return mapChart(flows, chartId, (chart) => {
    const node = chart.nodes[nodeId];
    if (!node) return chart;
    const next: FlowNode = {
      ...node,
      tone: toneFor(fileAs, (node.branches ?? []).length > 0),
      needsJob: needsJob || undefined,
      fileAs: fileAs ?? undefined,
    };
    return { ...chart, nodes: { ...chart.nodes, [nodeId]: next } };
  });
}

export function setAsk(flows: FlowChart[], chartId: string, nodeId: string, text: string): FlowChart[] {
  return mapChart(flows, chartId, (chart) => {
    const node = chart.nodes[nodeId];
    if (!node) return chart;
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    const fields = lines.map((label, index) => {
      const found = (node.fields ?? []).find((field) => field.label === label);
      return found ?? { key: `note-${index + 1}`, label, kind: "text" as const };
    });
    return {
      ...chart,
      nodes: {
        ...chart.nodes,
        [nodeId]: fields.length > 0 ? { ...node, fields } : { ...node, fields: undefined },
      },
    };
  });
}

export const FLOW_BOX_W = 200;
export const FLOW_BOX_H = 72;

/** Rows from the links. Saved x/y are ignored so a drag cannot wreck the chart. */
export function layoutChart(chart: FlowChart): Record<string, { x: number; y: number }> {
  const depth = new Map<string, number>();
  const queue = [chart.root, ...(chart.entries ?? []).map((entry) => entry.root)]
    .filter((id) => chart.nodes[id])
    .map((id) => ({ id, d: 0 }));
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item || depth.has(item.id) || !chart.nodes[item.id]) continue;
    depth.set(item.id, item.d);
    for (const branch of chart.nodes[item.id].branches ?? []) queue.push({ id: branch.to, d: item.d + 1 });
  }
  const loose = Object.keys(chart.nodes).filter((id) => !depth.has(id));
  const last = depth.size === 0 ? 0 : Math.max(...depth.values()) + 1;
  for (const id of loose) depth.set(id, last);

  const rows = new Map<number, string[]>();
  for (const [id, row] of depth) {
    const list = rows.get(row) ?? [];
    list.push(id);
    rows.set(row, list);
  }
  const gapX = 24;
  const gapY = 64;
  const widths = [...rows.values()].map((ids) => ids.length * FLOW_BOX_W + Math.max(0, ids.length - 1) * gapX);
  const board = Math.max(720, ...widths);
  const places: Record<string, { x: number; y: number }> = {};
  for (const row of [...rows.keys()].sort((a, b) => a - b)) {
    const ids = rows.get(row) ?? [];
    const rowWidth = ids.length * FLOW_BOX_W + Math.max(0, ids.length - 1) * gapX;
    let x = Math.max(24, (board - rowWidth) / 2);
    for (const id of ids) {
      places[id] = { x, y: 28 + row * (FLOW_BOX_H + gapY) };
      x += FLOW_BOX_W + gapX;
    }
  }
  return places;
}
