import { Bot, MessageSquare, Phone, Plug } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VibeStudioTab } from "./studio";

const TABS: { id: VibeStudioTab; label: string; hint: string; icon: typeof MessageSquare }[] = [
  { id: "chat", label: "Chat", hint: "Build with AI", icon: MessageSquare },
  { id: "agent", label: "Agent", hint: "Prompt, voice, tools", icon: Bot },
  { id: "connect", label: "Connect", hint: "Phone, WhatsApp, calendar", icon: Plug },
  { id: "test", label: "Test", hint: "Web call and tools", icon: Phone },
];

export function VibeStudioNav({
  active,
  agentReady,
  onSelect,
}: {
  active: VibeStudioTab;
  agentReady: boolean;
  onSelect: (tab: VibeStudioTab) => void;
}) {
  return (
    <nav
      aria-label="Vibe studio"
      className="flex items-center gap-0.5 rounded-full border border-border/60 bg-muted/30 p-0.5"
    >
      {TABS.map((tab) => {
        const locked = tab.id !== "chat" && !agentReady;
        const Icon = tab.icon;
        const selected = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            disabled={locked}
            title={locked ? "Finish chatting so the agent is created first" : tab.hint}
            onClick={() => onSelect(tab.id)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium transition-colors duration-200",
              "cursor-pointer disabled:cursor-not-allowed disabled:opacity-40",
              selected
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
