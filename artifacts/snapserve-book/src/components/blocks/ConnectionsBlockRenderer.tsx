import { ConnectionsBlock } from "@/content/types";
import { MarkdownText } from "@/components/MarkdownText";
import * as Icons from "lucide-react";
import { Link } from "wouter";

export function ConnectionsBlockRenderer({ block }: { block: ConnectionsBlock }) {
  return (
    <div className="my-16 p-8 md:p-12 rounded-3xl bg-slate-900 text-slate-100 overflow-hidden relative">
      <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-slate-800 via-slate-900 to-slate-950 -z-10" />
      
      <div className="relative z-10">
        <div className="flex items-center gap-3 mb-4 text-slate-300">
          <Icons.Network size={28} className="text-sky-400" />
          <h3 className="text-3xl font-bold font-serif">{block.title || "How it connects"}</h3>
        </div>
        {block.intro && (
          <p className="text-lg text-slate-400 mb-12 max-w-2xl leading-relaxed">
            <MarkdownText content={block.intro} />
          </p>
        )}

        {/* Visual Map rendering - Since drawing actual SVG edges responsively is tricky without a graphing lib, 
            we'll do a stylized list of connections that looks like a data flow */}
        
        <div className="space-y-4 max-w-3xl mx-auto">
          {block.edges.map((edge, i) => {
            const fromNode = block.nodes.find(n => n.id === edge.from);
            const toNode = block.nodes.find(n => n.id === edge.to);
            if (!fromNode || !toNode) return null;

            return (
              <div key={i} className="flex flex-col md:flex-row items-center gap-4">
                {/* From Node */}
                <NodeCard node={fromNode} />
                
                {/* Edge */}
                <div className="flex flex-col items-center justify-center flex-shrink-0 text-sky-400 px-4">
                  <span className="text-xs font-mono font-bold uppercase tracking-widest bg-sky-950 px-3 py-1 rounded-full border border-sky-800/50 mb-2">
                    {edge.label || "calls"}
                  </span>
                  <Icons.ArrowDown className="md:hidden" size={20} />
                  <Icons.ArrowRight className="hidden md:block" size={20} />
                </div>
                
                {/* To Node */}
                <NodeCard node={toNode} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function NodeCard({ node }: { node: any }) {
  const content = (
    <div className={`p-4 rounded-xl border-2 transition-all w-full md:w-64 flex-shrink-0 ${
      node.current 
        ? "bg-sky-900 border-sky-400 shadow-[0_0_15px_rgba(56,189,248,0.3)]" 
        : "bg-slate-800 border-slate-700 hover:border-slate-500"
    }`}>
      <div className={`font-bold ${node.current ? "text-white" : "text-slate-200"}`}>
        {node.label}
      </div>
      {node.sublabel && (
        <div className={`text-sm mt-1 ${node.current ? "text-sky-200" : "text-slate-400"}`}>
          {node.sublabel}
        </div>
      )}
      {node.chapterSlug && !node.current && (
        <div className="text-xs text-sky-400 mt-3 font-medium flex items-center gap-1">
          Jump to chapter <Icons.ExternalLink size={12} />
        </div>
      )}
      {node.current && (
        <div className="text-xs font-bold text-sky-300 mt-3 uppercase tracking-widest flex items-center gap-1">
          <Icons.MapPin size={12} /> You are here
        </div>
      )}
    </div>
  );

  if (node.chapterSlug && !node.current) {
    return <Link href={`/chapter/${node.chapterSlug}`} className="block w-full md:w-auto">{content}</Link>;
  }

  return content;
}
