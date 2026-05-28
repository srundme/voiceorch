import { Link } from "wouter";
import { SnapServeLogo } from "@/components/logo";

interface PageHeaderProps {
  /** Optional href the logo links to. Defaults to "/" */
  href?: string;
  /** Right-aligned actions */
  actions?: React.ReactNode;
  /** Optional className for the outer wrapper */
  className?: string;
  /** Inner max-width container. Defaults to "max-w-6xl" */
  containerClassName?: string;
}

/**
 * Shared standalone-page header: SnapServe icon + wordmark on the left,
 * optional actions on the right. Used on landing, auth, onboarding, public
 * booking and error pages so branding stays consistent.
 */
export function PageHeader({
  href = "/",
  actions,
  className = "",
  containerClassName = "max-w-6xl",
}: PageHeaderProps) {
  return (
    <header
      className={
        "w-full border-b border-border bg-background/70 backdrop-blur-md " +
        className
      }
    >
      <div
        className={
          "mx-auto flex items-center justify-between h-14 px-6 " +
          containerClassName
        }
      >
        <Link href={href}>
          <span className="inline-flex items-center cursor-pointer">
            <SnapServeLogo size="md" showIcon iconSize={22} className="text-foreground" />
          </span>
        </Link>
        {actions && <div className="flex items-center gap-3">{actions}</div>}
      </div>
    </header>
  );
}
