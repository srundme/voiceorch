import { SchedulingTabNav } from "@/components/scheduling-tab-nav";
import ConferencingContent from "@/pages/settings/Conferencing";

export default function SchedulingConferencingPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <SchedulingTabNav />
      <div className="flex-1 overflow-y-auto p-6">
        <ConferencingContent returnPath="scheduling-conferencing" />
      </div>
    </div>
  );
}
