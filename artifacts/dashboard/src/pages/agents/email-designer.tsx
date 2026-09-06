import React, { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Code2,
  Eye,
  Image as ImageIcon,
  LayoutTemplate,
  Minus,
  MousePointerClick,
  Plus,
  Trash2,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  compileEmailDesign,
  defaultEmailDesign,
  newBlockId,
  type EmailDesignBlock,
  type EmailDesignDoc,
} from "@/lib/email-design";

type Mode = "design" | "preview" | "html";

const BLOCK_LIBRARY: Array<{ type: EmailDesignBlock["type"]; label: string; icon: React.ReactNode }> = [
  { type: "hero", label: "Hero", icon: <LayoutTemplate className="h-3.5 w-3.5" /> },
  { type: "text", label: "Text", icon: <Type className="h-3.5 w-3.5" /> },
  { type: "button", label: "Button", icon: <MousePointerClick className="h-3.5 w-3.5" /> },
  { type: "image", label: "Image", icon: <ImageIcon className="h-3.5 w-3.5" /> },
  { type: "divider", label: "Divider", icon: <Minus className="h-3.5 w-3.5" /> },
  { type: "spacer", label: "Spacer", icon: <Plus className="h-3.5 w-3.5" /> },
  { type: "footer", label: "Footer", icon: <Type className="h-3.5 w-3.5" /> },
];

function makeBlock(type: EmailDesignBlock["type"]): EmailDesignBlock {
  switch (type) {
    case "hero":
      return {
        id: newBlockId("hero"),
        type: "hero",
        title: "Headline for {{name}}",
        subtitle: "Optional subtitle",
        bg: "#0f172a",
        color: "#ffffff",
        align: "center",
      };
    case "text":
      return {
        id: newBlockId("text"),
        type: "text",
        html: "<p>Write your message. Use {{summary}}, {{meet_link}}, etc.</p>",
      };
    case "button":
      return {
        id: newBlockId("btn"),
        type: "button",
        label: "Call to action",
        url: "{{meet_link}}",
        bg: "#0f172a",
        color: "#ffffff",
        align: "center",
      };
    case "image":
      return { id: newBlockId("img"), type: "image", src: "https://", alt: "", width: 520 };
    case "divider":
      return { id: newBlockId("div"), type: "divider", color: "#e5e7eb" };
    case "spacer":
      return { id: newBlockId("sp"), type: "spacer", height: 24 };
    case "footer":
      return {
        id: newBlockId("ft"),
        type: "footer",
        html: "<p style=\"margin:0\">— {{agent_name}} · {{business_name}}</p>",
      };
  }
}

export function EmailDesigner({
  design,
  htmlFallback,
  variables,
  onChangeDesign,
  onChangeHtml,
}: {
  design: EmailDesignDoc | null;
  htmlFallback: string;
  variables: Array<{ key: string; label: string }>;
  onChangeDesign: (doc: EmailDesignDoc) => void;
  onChangeHtml: (html: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("design");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const doc = design ?? defaultEmailDesign();
  const html = useMemo(
    () => (design ? compileEmailDesign(design) : htmlFallback),
    [design, htmlFallback],
  );

  const selected = doc.blocks.find((b) => b.id === selectedId) ?? null;

  const updateDoc = (next: EmailDesignDoc) => {
    onChangeDesign(next);
    onChangeHtml(compileEmailDesign(next));
  };

  const updateBlock = (id: string, patch: Partial<EmailDesignBlock>) => {
    updateDoc({
      ...doc,
      blocks: doc.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as EmailDesignBlock) : b)),
    });
  };

  const moveBlock = (id: string, dir: -1 | 1) => {
    const idx = doc.blocks.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const to = idx + dir;
    if (to < 0 || to >= doc.blocks.length) return;
    const blocks = [...doc.blocks];
    const [item] = blocks.splice(idx, 1);
    blocks.splice(to, 0, item!);
    updateDoc({ ...doc, blocks });
  };

  const removeBlock = (id: string) => {
    updateDoc({ ...doc, blocks: doc.blocks.filter((b) => b.id !== id) });
    if (selectedId === id) setSelectedId(null);
  };

  const addBlock = (type: EmailDesignBlock["type"]) => {
    const block = makeBlock(type);
    updateDoc({ ...doc, blocks: [...doc.blocks, block] });
    setSelectedId(block.id);
    setMode("design");
  };

  const insertVar = (key: string) => {
    if (!selected) return;
    const token = `{{${key}}}`;
    if (selected.type === "hero") {
      updateBlock(selected.id, { title: `${selected.title}${token}` });
    } else if (selected.type === "text" || selected.type === "footer") {
      updateBlock(selected.id, { html: `${selected.html}${token}` });
    } else if (selected.type === "button") {
      updateBlock(selected.id, { url: token });
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-border/50 bg-background/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-lg border border-border/50 p-0.5">
          {(
            [
              ["design", "Design", LayoutTemplate],
              ["preview", "Preview", Eye],
              ["html", "HTML", Code2],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium",
                mode === id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {BLOCK_LIBRARY.map((b) => (
            <button
              key={b.type}
              type="button"
              title={`Add ${b.label}`}
              onClick={() => addBlock(b.type)}
              className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground hover:border-sky-500/40 hover:text-sky-300"
            >
              {b.icon}
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {mode === "design" && (
        <div className="grid gap-3 lg:grid-cols-[1fr_240px]">
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Canvas bg</Label>
                <Input
                  type="color"
                  className="h-8 p-1"
                  value={doc.canvasBg || "#f4f4f6"}
                  onChange={(e) => updateDoc({ ...doc, canvasBg: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Content bg</Label>
                <Input
                  type="color"
                  className="h-8 p-1"
                  value={doc.contentBg || "#ffffff"}
                  onChange={(e) => updateDoc({ ...doc, contentBg: e.target.value })}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-[10px] text-muted-foreground">Width (px)</Label>
                <Input
                  type="number"
                  className="h-8 text-xs"
                  min={320}
                  max={720}
                  value={doc.width ?? 560}
                  onChange={(e) => updateDoc({ ...doc, width: Number(e.target.value) || 560 })}
                />
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-border/40 bg-muted/20 p-2">
              {doc.blocks.length === 0 && (
                <p className="px-2 py-6 text-center text-[11px] text-muted-foreground">
                  Add blocks above to design your email.
                </p>
              )}
              {doc.blocks.map((block) => (
                <button
                  key={block.id}
                  type="button"
                  onClick={() => setSelectedId(block.id)}
                  className={cn(
                    "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                    selectedId === block.id
                      ? "border-sky-500/50 bg-sky-500/10"
                      : "border-border/40 bg-background/50 hover:border-border",
                  )}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {block.type}
                    </span>
                    <span className="flex gap-0.5" onClick={(e) => e.stopPropagation()}>
                      <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => moveBlock(block.id, -1)}>
                        <ArrowUp className="h-3 w-3" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => moveBlock(block.id, 1)}>
                        <ArrowDown className="h-3 w-3" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeBlock(block.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </span>
                  </div>
                  <p className="truncate text-[11px] text-foreground/80">
                    {block.type === "hero" && block.title}
                    {block.type === "text" && block.html.replace(/<[^>]+>/g, " ").slice(0, 80)}
                    {block.type === "button" && `${block.label} → ${block.url}`}
                    {block.type === "image" && (block.src || "No image URL")}
                    {block.type === "divider" && "Horizontal rule"}
                    {block.type === "spacer" && `${block.height ?? 24}px gap`}
                    {block.type === "footer" && block.html.replace(/<[^>]+>/g, " ").slice(0, 80)}
                  </p>
                </button>
              ))}
            </div>

            {selected && (
              <div className="space-y-2 rounded-lg border border-border/50 bg-background/60 p-3">
                <p className="text-[11px] font-semibold">Edit {selected.type}</p>
                {selected.type === "hero" && (
                  <>
                    <Input className="h-8 text-xs" value={selected.title} onChange={(e) => updateBlock(selected.id, { title: e.target.value })} placeholder="Title" />
                    <Input className="h-8 text-xs" value={selected.subtitle || ""} onChange={(e) => updateBlock(selected.id, { subtitle: e.target.value })} placeholder="Subtitle" />
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">Background</Label>
                        <Input type="color" className="h-8 p-1" value={selected.bg || "#0f172a"} onChange={(e) => updateBlock(selected.id, { bg: e.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">Text</Label>
                        <Input type="color" className="h-8 p-1" value={selected.color || "#ffffff"} onChange={(e) => updateBlock(selected.id, { color: e.target.value })} />
                      </div>
                    </div>
                  </>
                )}
                {(selected.type === "text" || selected.type === "footer") && (
                  <Textarea
                    className="min-h-[100px] font-mono text-xs"
                    value={selected.html}
                    onChange={(e) => updateBlock(selected.id, { html: e.target.value })}
                  />
                )}
                {selected.type === "button" && (
                  <>
                    <Input className="h-8 text-xs" value={selected.label} onChange={(e) => updateBlock(selected.id, { label: e.target.value })} placeholder="Button label" />
                    <Input className="h-8 text-xs" value={selected.url} onChange={(e) => updateBlock(selected.id, { url: e.target.value })} placeholder="https:// or {{meet_link}}" />
                    <div className="grid grid-cols-2 gap-2">
                      <Input type="color" className="h-8 p-1" value={selected.bg || "#0f172a"} onChange={(e) => updateBlock(selected.id, { bg: e.target.value })} />
                      <Input type="color" className="h-8 p-1" value={selected.color || "#ffffff"} onChange={(e) => updateBlock(selected.id, { color: e.target.value })} />
                    </div>
                  </>
                )}
                {selected.type === "image" && (
                  <>
                    <Input className="h-8 text-xs" value={selected.src} onChange={(e) => updateBlock(selected.id, { src: e.target.value })} placeholder="https://…" />
                    <Input className="h-8 text-xs" value={selected.alt || ""} onChange={(e) => updateBlock(selected.id, { alt: e.target.value })} placeholder="Alt text" />
                    <Input type="number" className="h-8 text-xs" value={selected.width ?? 520} onChange={(e) => updateBlock(selected.id, { width: Number(e.target.value) || 520 })} />
                  </>
                )}
                {selected.type === "spacer" && (
                  <Input type="number" className="h-8 text-xs" value={selected.height ?? 24} onChange={(e) => updateBlock(selected.id, { height: Number(e.target.value) || 24 })} />
                )}
                {selected.type === "divider" && (
                  <Input type="color" className="h-8 p-1" value={selected.color || "#e5e7eb"} onChange={(e) => updateBlock(selected.id, { color: e.target.value })} />
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Insert variable</p>
            <div className="grid grid-cols-2 gap-1">
              {variables.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  disabled={!selected}
                  title={v.label}
                  onClick={() => insertVar(v.key)}
                  className="w-full truncate rounded-md border border-border/50 bg-background/60 px-1.5 py-1 text-center font-mono text-[10px] text-muted-foreground disabled:opacity-40 hover:border-sky-500/40 hover:text-sky-300"
                >
                  {`{{${v.key}}}`}
                </button>
              ))}
            </div>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Select a block, then tap a variable. Values come from the call/lead at send time.
            </p>
          </div>
        </div>
      )}

      {mode === "preview" && (
        <div className="overflow-hidden rounded-lg border border-border/50 bg-white">
          <iframe title="Email preview" className="h-[420px] w-full bg-white" srcDoc={html} sandbox="" />
        </div>
      )}

      {mode === "html" && (
        <div className="space-y-2">
          <p className="text-[10px] text-muted-foreground">
            Advanced: edit raw HTML. Switching back to Design uses the block document if present.
          </p>
          <Textarea
            className="min-h-[280px] font-mono text-[11px]"
            value={html}
            onChange={(e) => {
              onChangeHtml(e.target.value);
              // Keep design if present; HTML becomes source of truth for send until redesign.
            }}
          />
        </div>
      )}
    </div>
  );
}
