import type { ReactNode } from "react";
import { StripePage } from "@/components/stripe-page";

/**
 * @deprecated Prefer StripePage. Thin alias kept for gradual migration.
 */
export function OperateShell({
  title,
  description,
  back = { href: "/app/home", label: "Back" },
  actions,
  children,
  className,
  contentClassName,
}: {
  title: string;
  description?: string;
  back?: { href: string; label: string };
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <StripePage
      title={title}
      description={description}
      back={back}
      actions={actions}
      className={className}
      contentClassName={contentClassName}
    >
      {children}
    </StripePage>
  );
}
