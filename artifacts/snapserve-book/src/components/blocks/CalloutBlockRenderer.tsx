import { CalloutBlock, KeyTakeawaysBlock } from "@/content/types";
import { MarkdownText } from "@/components/MarkdownText";
import * as Icons from "lucide-react";

export function CalloutBlockRenderer({ block }: { block: CalloutBlock }) {
  const config = {
    why: { icon: Icons.HelpCircle, color: "text-purple-600", bg: "bg-purple-50", border: "border-purple-200" },
    tip: { icon: Icons.Lightbulb, color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200" },
    warning: { icon: Icons.AlertTriangle, color: "text-red-600", bg: "bg-red-50", border: "border-red-200" },
    gotcha: { icon: Icons.Skull, color: "text-orange-600", bg: "bg-orange-50", border: "border-orange-200" },
    insight: { icon: Icons.Eye, color: "text-blue-600", bg: "bg-blue-50", border: "border-blue-200" },
  }[block.variant];

  const Icon = config.icon;

  return (
    <div className={`my-8 p-6 md:p-8 rounded-3xl border-2 ${config.bg} ${config.border}`}>
      <div className={`flex items-center gap-3 mb-3 ${config.color} font-bold`}>
        <Icon size={24} />
        <h4 className="text-xl uppercase tracking-widest text-sm">{block.title || block.variant}</h4>
      </div>
      <div className="space-y-3">
        {block.body.map((p, i) => (
          <p key={i} className="text-foreground/90 leading-relaxed font-medium">
            <MarkdownText content={p} />
          </p>
        ))}
      </div>
    </div>
  );
}

export function KeyTakeawaysBlockRenderer({ block }: { block: KeyTakeawaysBlock }) {
  return (
    <div className="my-16 p-8 rounded-3xl bg-primary text-primary-foreground shadow-xl shadow-primary/20">
      <div className="flex items-center gap-3 mb-6 font-bold">
        <Icons.Target size={28} className="text-orange-200" />
        <h3 className="text-3xl font-serif">Key Takeaways</h3>
      </div>
      <ul className="space-y-4">
        {block.items.map((item, i) => (
          <li key={i} className="flex items-start gap-4 text-lg">
            <div className="w-6 h-6 rounded-full bg-orange-400/40 flex items-center justify-center flex-shrink-0 mt-0.5 text-sm font-bold">
              {i + 1}
            </div>
            <div className="leading-relaxed">
              <MarkdownText content={item} className="text-primary-foreground" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
