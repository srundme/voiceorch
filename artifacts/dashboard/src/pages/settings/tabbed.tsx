/**
 * /app/settings — Workspace | Team
 */
import { useState } from "react";
import { useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { StripeTabPage } from "@/components/stripe-tab-page";
import { Button } from "@/components/ui/button";
import Settings from "./index";
import TeamPage from "@/pages/team";

interface TeamMemberRow {
  ownerUserId: string;
}

export default function SettingsTabPage() {
  const search = useSearch();
  const activeTab = new URLSearchParams(search).get("tab") ?? "workspace";
  const { userId } = useAuth();
  const [inviteOpen, setInviteOpen] = useState(false);

  const { data: members = [] } = useQuery<TeamMemberRow[]>({
    queryKey: ["team-members"],
    queryFn: async () => {
      const res = await fetch("/api/team/members", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch team members");
      return res.json();
    },
    enabled: activeTab === "team",
  });
  const isOwner = members.length === 0 || members.some((m) => m.ownerUserId === userId);

  return (
    <StripeTabPage
      title="Workspace"
      description="Workspace profile and team access."
      defaultTab="workspace"
      tabActions={
        activeTab === "team" && isOwner ? (
          <Button
            onClick={() => setInviteOpen(true)}
            className="gap-1.5 h-9 min-h-9 text-xs sm:text-[13px]"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Invite Member
          </Button>
        ) : undefined
      }
      tabs={[
        { key: "workspace", label: "Workspace", content: <Settings /> },
        {
          key: "team",
          label: "Team",
          content: (
            <TeamPage
              inviteOpen={inviteOpen}
              onInviteOpenChange={setInviteOpen}
              hideToolbarInvite
            />
          ),
        },
      ]}
    />
  );
}
