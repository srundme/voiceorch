export class PhoneAlreadyAssignedError extends Error {
  readonly currentAgentId: number;
  readonly number: string;

  constructor(number: string, currentAgentId: number) {
    super(
      `This number is already on another agent (#${currentAgentId}). Unassign it from Phone Numbers first, or reassign it there on purpose.`,
    );
    this.name = "PhoneAlreadyAssignedError";
    this.number = number;
    this.currentAgentId = currentAgentId;
  }
}

/** True when attaching would silently take the number off a different agent. */
export function refuseSilentPhoneMove(
  currentAgentId: number | null | undefined,
  targetAgentId: number,
  allowReassign: boolean,
): boolean {
  if (currentAgentId == null || currentAgentId === targetAgentId) return false;
  return !allowReassign;
}
