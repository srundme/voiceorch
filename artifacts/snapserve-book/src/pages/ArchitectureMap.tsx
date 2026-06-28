import { useState } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { Map, ExternalLink, Info } from "lucide-react";

interface Node {
  id: string;
  label: string;
  sublabel?: string;
  x: number;
  y: number;
  chapter?: string;
  color: string;
  group: "telephony" | "orchestration" | "ai" | "data" | "frontend" | "infra";
}

interface Edge {
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
}

const GROUP_COLORS: Record<Node["group"], { fill: string; stroke: string; text: string }> = {
  telephony:    { fill: "#fff7ed", stroke: "#f97316", text: "#c2410c" },
  orchestration:{ fill: "#fef3c7", stroke: "#d97706", text: "#92400e" },
  ai:           { fill: "#f0fdf4", stroke: "#16a34a", text: "#166534" },
  data:         { fill: "#eff6ff", stroke: "#2563eb", text: "#1d4ed8" },
  frontend:     { fill: "#fdf4ff", stroke: "#9333ea", text: "#7e22ce" },
  infra:        { fill: "#f1f5f9", stroke: "#475569", text: "#334155" },
};

const nodes: Node[] = [
  // Telephony layer
  { id: "caller", label: "Caller", sublabel: "Phone / Browser", x: 80, y: 300, color: "telephony", group: "telephony" },
  { id: "vobiz", label: "VoBiz", sublabel: "Telephony Provider", x: 80, y: 200, chapter: "vobiz-and-plivo", color: "telephony", group: "telephony" },
  { id: "twilio", label: "Twilio / Plivo", sublabel: "Telephony Provider", x: 80, y: 400, chapter: "twilio-deep-dive", color: "telephony", group: "telephony" },
  { id: "webcall_ws", label: "Browser WebSocket", sublabel: "Web Call", x: 80, y: 500, chapter: "webcall", color: "telephony", group: "telephony" },

  // Orchestration layer
  { id: "pipeline", label: "Pipeline", sublabel: "orchestration/pipeline.ts", x: 320, y: 300, chapter: "session-and-pipeline", color: "orchestration", group: "orchestration" },
  { id: "endpointing", label: "Endpointing + VAD", sublabel: "endpointing.ts / silero", x: 320, y: 180, chapter: "endpointing", color: "orchestration", group: "orchestration" },
  { id: "session", label: "Session Manager", sublabel: "session.ts", x: 320, y: 420, chapter: "session-and-pipeline", color: "orchestration", group: "orchestration" },
  { id: "tools", label: "Tool Executor", sublabel: "toolExecutor.ts", x: 320, y: 540, chapter: "tool-execution", color: "orchestration", group: "orchestration" },

  // AI providers layer
  { id: "stt", label: "STT Adapter", sublabel: "Deepgram / Azure / Sarvam", x: 560, y: 180, chapter: "stt-adapters", color: "ai", group: "ai" },
  { id: "llm", label: "LLM Adapter", sublabel: "OpenAI / Anthropic / Sarvam", x: 560, y: 300, chapter: "llm-adapters", color: "ai", group: "ai" },
  { id: "tts", label: "TTS Adapter", sublabel: "ElevenLabs / Cartesia / Sarvam", x: 560, y: 420, chapter: "tts-adapters", color: "ai", group: "ai" },
  { id: "gender", label: "Gender Detector", sublabel: "gender-service (Python)", x: 560, y: 540, chapter: "gender-detection", color: "ai", group: "ai" },

  // Data layer
  { id: "db", label: "PostgreSQL", sublabel: "Drizzle ORM", x: 800, y: 300, chapter: "drizzle-intro", color: "data", group: "data" },
  { id: "calls_tbl", label: "calls table", sublabel: "status, transcript", x: 800, y: 180, chapter: "calls-and-providers", color: "data", group: "data" },
  { id: "memory_tbl", label: "caller_* tables", sublabel: "profiles, facts, archive", x: 800, y: 420, chapter: "caller-memory-tables", color: "data", group: "data" },
  { id: "callbacks_tbl", label: "scheduled_callbacks", sublabel: "retry jobs", x: 800, y: 540, chapter: "callback-scheduling", color: "data", group: "data" },

  // Frontend
  { id: "dashboard", label: "Dashboard SPA", sublabel: "React + Vite", x: 560, y: 60, chapter: "react-vite-app", color: "frontend", group: "frontend" },
  { id: "webhooks", label: "Webhooks Handler", sublabel: "routes/webhooks.ts", x: 320, y: 60, chapter: "webhooks-deep-dive", color: "infra", group: "infra" },
];

const edges: Edge[] = [
  { from: "caller", to: "vobiz", label: "phone call" },
  { from: "caller", to: "twilio", label: "phone call" },
  { from: "caller", to: "webcall_ws", label: "browser WS" },
  { from: "vobiz", to: "pipeline", label: "WS audio" },
  { from: "twilio", to: "pipeline", label: "WS audio" },
  { from: "webcall_ws", to: "pipeline", label: "WS audio" },
  { from: "pipeline", to: "endpointing", label: "audio frames" },
  { from: "pipeline", to: "stt", label: "audio" },
  { from: "stt", to: "pipeline", label: "transcript" },
  { from: "pipeline", to: "llm", label: "transcript + prompt" },
  { from: "llm", to: "pipeline", label: "response" },
  { from: "pipeline", to: "tts", label: "text" },
  { from: "tts", to: "pipeline", label: "audio" },
  { from: "pipeline", to: "tools", label: "tool calls" },
  { from: "pipeline", to: "gender", label: "audio tap", dashed: true },
  { from: "pipeline", to: "db", label: "call logs" },
  { from: "session", to: "calls_tbl", label: "endSession" },
  { from: "session", to: "memory_tbl", label: "facts / archive" },
  { from: "tools", to: "callbacks_tbl", label: "schedule_callback" },
  { from: "vobiz", to: "webhooks", label: "status POST" },
  { from: "twilio", to: "webhooks", label: "status POST" },
  { from: "dashboard", to: "db", label: "API queries", dashed: true },
];

const LEGEND = [
  { group: "telephony", label: "Telephony" },
  { group: "orchestration", label: "Orchestration" },
  { group: "ai", label: "AI Adapters" },
  { group: "data", label: "Data Layer" },
  { group: "frontend", label: "Frontend" },
  { group: "infra", label: "Infrastructure" },
] as const;

export default function ArchitectureMap() {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const selected = nodes.find(n => n.id === (selectedNode ?? hoveredNode));

  const W = 920;
  const H = 620;

  function getEdgeCoords(edge: Edge) {
    const from = nodes.find(n => n.id === edge.from);
    const to = nodes.find(n => n.id === edge.to);
    if (!from || !to) return null;
    return { x1: from.x, y1: from.y, x2: to.x, y2: to.y };
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-6 pt-16 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
        >
          <div className="flex items-center gap-3 mb-2">
            <Map size={28} className="text-primary" />
            <h1 className="text-4xl font-bold font-serif text-foreground">Architecture Map</h1>
          </div>
          <p className="text-muted-foreground text-lg mb-8">
            Click any component to see its chapter. Hover to highlight connections.
          </p>

          {/* Legend */}
          <div className="flex flex-wrap gap-3 mb-6">
            {LEGEND.map(({ group, label }) => {
              const c = GROUP_COLORS[group];
              return (
                <div key={group} className="flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium border" style={{ background: c.fill, borderColor: c.stroke, color: c.text }}>
                  <div className="w-2 h-2 rounded-full" style={{ background: c.stroke }} />
                  {label}
                </div>
              );
            })}
          </div>

          {/* SVG Map */}
          <div className="relative rounded-3xl border-2 border-border bg-card overflow-hidden">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="w-full"
              style={{ maxHeight: 540 }}
            >
              <defs>
                <marker id="arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" fill="#94a3b8" />
                </marker>
                <marker id="arrow-active" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" fill="#f97316" />
                </marker>
              </defs>

              {/* Edges */}
              {edges.map((edge, i) => {
                const coords = getEdgeCoords(edge);
                if (!coords) return null;
                const isActive = hoveredNode === edge.from || hoveredNode === edge.to || selectedNode === edge.from || selectedNode === edge.to;
                return (
                  <g key={i}>
                    <line
                      x1={coords.x1} y1={coords.y1}
                      x2={coords.x2} y2={coords.y2}
                      stroke={isActive ? "#f97316" : "#cbd5e1"}
                      strokeWidth={isActive ? 2 : 1}
                      strokeDasharray={edge.dashed ? "4 3" : undefined}
                      markerEnd={isActive ? "url(#arrow-active)" : "url(#arrow)"}
                      opacity={hoveredNode && !isActive ? 0.2 : 1}
                      style={{ transition: "all 0.2s" }}
                    />
                    {edge.label && isActive && (
                      <text
                        x={(coords.x1 + coords.x2) / 2}
                        y={(coords.y1 + coords.y2) / 2 - 6}
                        textAnchor="middle"
                        fill="#f97316"
                        fontSize="9"
                        fontWeight="600"
                      >
                        {edge.label}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Nodes */}
              {nodes.map(node => {
                const colors = GROUP_COLORS[node.group];
                const isActive = hoveredNode === node.id || selectedNode === node.id;
                const isGray = (hoveredNode || selectedNode) && !isActive;
                return (
                  <g
                    key={node.id}
                    transform={`translate(${node.x}, ${node.y})`}
                    onMouseEnter={() => setHoveredNode(node.id)}
                    onMouseLeave={() => setHoveredNode(null)}
                    onClick={() => setSelectedNode(selectedNode === node.id ? null : node.id)}
                    style={{ cursor: node.chapter ? "pointer" : "default" }}
                  >
                    <rect
                      x={-62} y={-26}
                      width={124} height={52}
                      rx={12}
                      fill={isGray ? "#f8fafc" : colors.fill}
                      stroke={isActive ? colors.stroke : isGray ? "#e2e8f0" : colors.stroke}
                      strokeWidth={isActive ? 2.5 : 1.5}
                      opacity={isGray ? 0.4 : 1}
                      style={{ transition: "all 0.2s" }}
                    />
                    <text
                      textAnchor="middle" y={node.sublabel ? -7 : 5}
                      fontSize="11" fontWeight="700"
                      fill={isGray ? "#94a3b8" : colors.text}
                      style={{ transition: "all 0.2s" }}
                    >
                      {node.label}
                    </text>
                    {node.sublabel && (
                      <text
                        textAnchor="middle" y={10}
                        fontSize="8" fill={isGray ? "#cbd5e1" : "#94a3b8"}
                        style={{ transition: "all 0.2s" }}
                      >
                        {node.sublabel}
                      </text>
                    )}
                    {node.chapter && isActive && (
                      <text textAnchor="middle" y={26} fontSize="8" fill={colors.stroke} fontWeight="600">
                        → chapter
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Selected node detail */}
          {selected && (
            <motion.div
              key={selected.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 p-5 rounded-2xl border-2 border-primary/20 bg-orange-50 flex items-center justify-between gap-4"
            >
              <div className="flex items-center gap-3">
                <Info size={18} className="text-primary flex-shrink-0" />
                <div>
                  <p className="font-bold text-foreground">{selected.label}</p>
                  {selected.sublabel && <p className="text-sm text-muted-foreground">{selected.sublabel}</p>}
                </div>
              </div>
              {selected.chapter && (
                <Link
                  href={`/chapter/${selected.chapter}`}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground font-bold text-sm hover:opacity-90 transition-opacity whitespace-nowrap"
                >
                  Read chapter <ExternalLink size={14} />
                </Link>
              )}
            </motion.div>
          )}

          <p className="text-xs text-muted-foreground text-center mt-6">
            This is a simplified view — SnapServe has many more internal connections. Click a component to jump to its chapter.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
