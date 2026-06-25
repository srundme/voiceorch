import type { HttpMethod } from "../openapi/types";

const STYLES: Record<HttpMethod, string> = {
  get: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  post: "text-sky-400 bg-sky-400/10 border-sky-400/20",
  put: "text-orange-400 bg-orange-400/10 border-orange-400/20",
  patch: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  delete: "text-rose-400 bg-rose-400/10 border-rose-400/20",
};

const LABELS: Record<HttpMethod, string> = {
  get: "GET",
  post: "POST",
  put: "PUT",
  patch: "PATCH",
  delete: "DEL",
};

export function MethodBadge({
  method,
  size = "sm",
}: {
  method: HttpMethod;
  size?: "sm" | "md";
}) {
  const pad = size === "md" ? "px-2.5 py-1 text-xs" : "px-1.5 py-0.5 text-[10px]";
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md border font-mono font-bold tracking-wide shrink-0 ${pad} ${STYLES[method]}`}
    >
      {LABELS[method]}
    </span>
  );
}
