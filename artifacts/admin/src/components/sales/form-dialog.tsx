import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ServerErrors, touch } from "@/components/sales/sales-ui";
import { cn } from "@/lib/utils";

/** Scrollable dialog form with a sticky footer; full-width on phones. */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  onSubmit,
  submitLabel = "Save",
  pending,
  error,
  disabled,
  wide,
  extraFooter,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  onSubmit: () => void;
  submitLabel?: string;
  pending?: boolean;
  error?: unknown;
  disabled?: boolean;
  wide?: boolean;
  extraFooter?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("flex max-h-[92dvh] w-[calc(100vw-1rem)] flex-col gap-0 p-0", wide ? "max-w-2xl" : "max-w-lg")}>
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (!pending && !disabled) onSubmit();
          }}
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {children}
            <ServerErrors error={error} />
          </div>
          <DialogFooter className="gap-2 border-t border-border px-5 py-3 sm:justify-between">
            <div className="flex-1">{extraFooter}</div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className={cn(touch, "flex-1 sm:flex-none")} onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" className={cn(touch, "flex-1 sm:flex-none")} disabled={pending || disabled}>
                {pending ? "Saving…" : submitLabel}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
