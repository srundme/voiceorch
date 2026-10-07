/** The caller must hear the booked time before the call can end, so end_call is
 *  withheld for the step that follows a schedule_callback result. */
export function toolDefsForFollowUp<T>(completedTool: string, toolDefs: T[]): T[] {
  if (completedTool !== "schedule_callback") return toolDefs;
  return toolDefs.filter((t) => {
    const name = (t as { function?: { name?: string }; name?: string })?.function?.name
      ?? (t as { name?: string })?.name;
    return name !== "end_call";
  });
}
