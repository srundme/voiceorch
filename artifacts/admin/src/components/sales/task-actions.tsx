import { useState } from "react";
import { Check, Clock, MoreHorizontal, UserRoundCog, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FormDialog } from "@/components/sales/form-dialog";
import { Field, OwnerSelect, ReasonDialog, touch, useSalesToast } from "@/components/sales/sales-ui";
import { useSalesPrefs } from "@/components/sales/sales-context";
import { useAssignTask, useCancelTask, useCompleteTask, useUpdateTask } from "@/hooks/use-sales-api";
import { istLocalToIso, isoToIstLocal, nowIstLocal } from "@/lib/sales-format";

type TaskLike = { id: number; title: string; dueAt: string | null; ownerId: number | null };

/** Done / reschedule / reassign / cancel for an open task. */
export function TaskActions({ task, compact }: { task: TaskLike; compact?: boolean }) {
  const { user, isFounder } = useSalesPrefs();
  const toast = useSalesToast();
  const complete = useCompleteTask();
  const update = useUpdateTask();
  const assign = useAssignTask();
  const cancel = useCancelTask();
  const [dialog, setDialog] = useState<"done" | "reschedule" | "reassign" | "cancel" | null>(null);
  const [due, setDue] = useState(task.dueAt ? isoToIstLocal(task.dueAt) : nowIstLocal(24 * 60));
  const [ownerId, setOwnerId] = useState<number | null>(task.ownerId);
  const canReassign = isFounder || task.ownerId === user.id || task.ownerId == null;
  const close = () => setDialog(null);

  return (
    <>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          variant="outline"
          className="min-h-11 md:min-h-8"
          aria-label={`Mark task done: ${task.title}`}
          title="Mark done"
          onClick={() => setDialog("done")}
        >
          <Check className="h-4 w-4" aria-hidden="true" />
          {!compact && <span className="ml-1">Done</span>}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="h-11 w-11 md:h-8 md:w-8" aria-label="More task actions">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="min-h-11 md:min-h-8" onSelect={() => setDialog("reschedule")}>
              <Clock className="mr-2 h-4 w-4" /> Reschedule
            </DropdownMenuItem>
            {canReassign && (
              <DropdownMenuItem className="min-h-11 md:min-h-8" onSelect={() => setDialog("reassign")}>
                <UserRoundCog className="mr-2 h-4 w-4" /> {task.ownerId == null && !isFounder ? "Claim" : "Reassign"}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="min-h-11 md:min-h-8" onSelect={() => setDialog("cancel")}>
              <X className="mr-2 h-4 w-4" /> Cancel task
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ReasonDialog
        open={dialog === "done"}
        onOpenChange={(v) => !v && close()}
        title="Complete task"
        description={task.title}
        label="Outcome"
        required={false}
        confirmLabel="Mark done"
        pending={complete.isPending}
        error={complete.error}
        onConfirm={(outcome) =>
          complete.mutate({ id: task.id, outcome: outcome || null }, { onSuccess: () => { toast.success("Task completed"); close(); } })
        }
      />
      <ReasonDialog
        open={dialog === "cancel"}
        onOpenChange={(v) => !v && close()}
        title="Cancel task"
        description={task.title}
        required={false}
        confirmLabel="Cancel task"
        destructive
        pending={cancel.isPending}
        error={cancel.error}
        onConfirm={(reason) => cancel.mutate({ id: task.id, reason: reason || null }, { onSuccess: () => { toast.success("Task cancelled"); close(); } })}
      />
      <FormDialog
        open={dialog === "reschedule"}
        onOpenChange={(v) => !v && close()}
        title="Reschedule task"
        description={task.title}
        pending={update.isPending}
        error={update.error}
        onSubmit={() => update.mutate({ id: task.id, dueAt: istLocalToIso(due) }, { onSuccess: () => { toast.success("Task rescheduled"); close(); } })}
      >
        <Field label="New due time (IST)">
          <Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className={touch} />
        </Field>
      </FormDialog>
      <FormDialog
        open={dialog === "reassign"}
        onOpenChange={(v) => !v && close()}
        title={task.ownerId == null && !isFounder ? "Claim task" : "Reassign task"}
        description={isFounder ? task.title : "Teammates can reassign their own tasks or claim unassigned ones."}
        pending={assign.isPending}
        error={assign.error}
        onSubmit={() =>
          assign.mutate({ id: task.id, ownerId: isFounder ? ownerId : task.ownerId == null ? user.id : ownerId }, { onSuccess: () => { toast.success("Task reassigned"); close(); } })
        }
      >
        {isFounder || task.ownerId === user.id ? (
          <Field label="Owner">
            <OwnerSelect value={ownerId} onChange={setOwnerId} />
          </Field>
        ) : (
          <p className="text-sm">Assign this task to yourself?</p>
        )}
      </FormDialog>
    </>
  );
}
