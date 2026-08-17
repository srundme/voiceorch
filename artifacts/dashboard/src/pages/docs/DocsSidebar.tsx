import { Link } from "wouter";
import { LayoutDashboard, KeyRound } from "lucide-react";
import { ExternalFooterLink } from "./DocsUi";
import { DOCS_NAV, hrefForSlug } from "./docs-nav";

export function DocsSidebar({ activeSection }: { activeSection: string }) {
  return (
    <nav className="flex flex-col gap-7 pb-8" aria-label="Documentation">
      {DOCS_NAV.map((group) => {
        const GroupIcon = group.icon;
        return (
          <div key={group.title} className="flex flex-col">
            <div className="flex items-center gap-2 px-2 mb-2">
              <GroupIcon className="h-3.5 w-3.5 text-slate-500" aria-hidden />
              <h4 className="text-[13px] font-semibold text-slate-800">{group.title}</h4>
            </div>
            <div className="relative ml-3.5 flex flex-col gap-0.5 border-l border-slate-200 pl-3">
              {group.items.map((item) => {
                const isActive =
                  activeSection === item.slug ||
                  (item.slug === "api-reference" && activeSection.startsWith("api-reference"));
                const ItemIcon = item.icon;
                return (
                  <Link
                    key={item.slug}
                    href={hrefForSlug(item.slug)}
                    className={`relative flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors ${
                      isActive
                        ? "text-sky-800 bg-sky-50"
                        : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                    }`}
                  >
                    {isActive ? (
                      <span className="absolute -left-[13px] top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-sky-500" />
                    ) : null}
                    {ItemIcon ? <ItemIcon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden /> : null}
                    <span className="truncate">{item.title}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="mt-2 border-t border-slate-200 pt-4 px-1 flex flex-col gap-0.5">
        <ExternalFooterLink href="https://app.snapserve.ai/app" icon={<LayoutDashboard className="h-3.5 w-3.5" />}>
          Open dashboard
        </ExternalFooterLink>
        <ExternalFooterLink href="https://app.snapserve.ai/app/api-keys" icon={<KeyRound className="h-3.5 w-3.5" />}>
          API Keys
        </ExternalFooterLink>
      </div>
    </nav>
  );
}
