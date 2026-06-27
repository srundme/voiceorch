import { useState } from "react";
import { Light as SyntaxHighlighter } from "react-syntax-highlighter";
import ts from "react-syntax-highlighter/dist/esm/languages/hljs/typescript";
import { atomOneDarkReasonable } from "react-syntax-highlighter/dist/esm/styles/hljs";
import { CodeBlock } from "@/content/types";
import { MarkdownText } from "@/components/MarkdownText";
import { motion } from "framer-motion";
import * as Icons from "lucide-react";

SyntaxHighlighter.registerLanguage("typescript", ts);

export function CodeBlockRenderer({ block }: { block: CodeBlock }) {
  const [activeLines, setActiveLines] = useState<string | null>(null);

  const parseLines = (linesStr: string) => {
    if (linesStr.includes("-")) {
      const [start, end] = linesStr.split("-").map(Number);
      const arr = [];
      for (let i = start; i <= end; i++) arr.push(i);
      return arr;
    }
    return [Number(linesStr)];
  };

  const getActiveLineNumbers = () => {
    if (!activeLines) return [];
    return parseLines(activeLines);
  };

  const activeNums = getActiveLineNumbers();

  return (
    <div className="my-12">
      {block.intro && (
        <p className="text-lg text-foreground/80 mb-6 leading-relaxed">
          <MarkdownText content={block.intro} />
        </p>
      )}

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        {/* Code View */}
        <div className="rounded-2xl overflow-hidden shadow-2xl border border-white/10 bg-[#282c34] sticky top-8">
          <div className="flex items-center justify-between px-4 py-3 bg-black/40 border-b border-white/5">
            <div className="flex items-center gap-2">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500/80" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                <div className="w-3 h-3 rounded-full bg-green-500/80" />
              </div>
              {block.filename && <span className="ml-2 text-xs font-mono text-white/50">{block.filename}</span>}
            </div>
            <div className="text-xs font-mono text-white/30 uppercase">{block.language}</div>
          </div>
          <div className="p-4 overflow-x-auto text-[14px]">
            <SyntaxHighlighter
              language={block.language === "plain text" ? "text" : block.language}
              style={atomOneDarkReasonable}
              customStyle={{ background: "transparent", padding: 0, margin: 0 }}
              wrapLines={true}
              showLineNumbers={true}
              lineProps={(lineNumber) => {
                const isActive = activeNums.includes(lineNumber);
                const hasAnyActive = activeNums.length > 0;
                return {
                  style: {
                    display: "block",
                    backgroundColor: isActive ? "rgba(255, 165, 0, 0.15)" : "transparent",
                    borderLeft: isActive ? "3px solid orange" : "3px solid transparent",
                    opacity: hasAnyActive && !isActive ? 0.4 : 1,
                    transition: "all 0.2s ease"
                  }
                };
              }}
            >
              {block.code}
            </SyntaxHighlighter>
          </div>
        </div>

        {/* Annotations */}
        {block.lines && block.lines.length > 0 && (
          <div className="space-y-4">
            {block.lines.map((ann, i) => {
              const isActive = activeLines === ann.lines;
              return (
                <div
                  key={i}
                  role="button"
                  tabIndex={0}
                  data-testid={`annotation-${ann.lines}`}
                  onMouseEnter={() => setActiveLines(ann.lines)}
                  onMouseLeave={() => setActiveLines(null)}
                  onFocus={() => setActiveLines(ann.lines)}
                  onBlur={() => setActiveLines(null)}
                  onClick={() => setActiveLines((cur) => (cur === ann.lines ? null : ann.lines))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setActiveLines((cur) => (cur === ann.lines ? null : ann.lines));
                    }
                  }}
                  className={`p-5 rounded-2xl border-2 transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    isActive
                      ? "bg-orange-50 border-orange-200 shadow-md scale-[1.02]"
                      : "bg-card border-transparent hover:border-orange-100 hover:bg-orange-50/50"
                  }`}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`px-2.5 py-1 rounded-md text-xs font-bold font-mono ${
                      isActive ? "bg-orange-200 text-orange-800" : "bg-muted text-muted-foreground"
                    }`}>
                      Lines {ann.lines}
                    </div>
                    {ann.label && <div className="text-sm font-bold text-foreground">{ann.label}</div>}
                  </div>
                  <div className="text-muted-foreground leading-relaxed">
                    <MarkdownText content={ann.explanation} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
