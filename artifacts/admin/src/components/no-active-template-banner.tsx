import { AlertTriangle } from "lucide-react";
import { Link } from "wouter";

interface NoActiveTemplateBannerProps {
  linkTo?: string | null;
}

export function NoActiveTemplateBanner({ linkTo = "/prompt-template" }: NoActiveTemplateBannerProps) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm">
      <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <span className="font-semibold text-yellow-600 dark:text-yellow-400">No active prompt template.</span>{" "}
        <span className="text-muted-foreground">
          Agent creation will fail until a master template is uploaded.
        </span>
        {linkTo != null && (
          <>
            {" "}
            <Link
              href={linkTo}
              className="font-medium text-yellow-600 dark:text-yellow-400 underline underline-offset-2 hover:opacity-80"
            >
              Upload one now →
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
