import { useEffect, useState } from "react";

export function TableOfContents() {
  const [headings, setHeadings] = useState<{ id: string; text: string; level: number }[]>([]);
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    // Wait a brief moment for content to render
    const timeout = setTimeout(() => {
      const elements = Array.from(document.querySelectorAll("main h2, main h3"));
      const extracted = elements.map(el => {
        if (!el.id) {
          el.id = el.textContent?.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "";
        }
        return {
          id: el.id,
          text: el.textContent || "",
          level: parseInt(el.tagName.charAt(1))
        };
      });
      setHeadings(extracted);
    }, 100);

    return () => clearTimeout(timeout);
  }, []); // Empty dependency array as we want to run this on mount/content change. 
         // Realistically we should depend on the active section to re-run, but for simplicity we rely on layout unmounting.

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        });
      },
      { rootMargin: "0px 0px -80% 0px" }
    );

    const elements = document.querySelectorAll("main h2, main h3");
    elements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        On this page
      </span>
      <div className="flex flex-col gap-1.5 border-l border-slate-200 pl-3">
        {headings.map((heading) => (
          <a
            key={heading.id}
            href={`#${heading.id}`}
            className={`text-[13px] transition-colors block line-clamp-1 ${
              heading.level === 3 ? "pl-3" : ""
            } ${
              activeId === heading.id
                ? "text-slate-900 font-medium"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {heading.text}
          </a>
        ))}
      </div>
    </div>
  );
}
