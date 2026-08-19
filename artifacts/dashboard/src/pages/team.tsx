import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import {
  Users,
  UserPlus,
  Trash2,
  Mail,
  Shield,
  Clock,
  CheckCircle2,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface TeamMember {
  id: number;
  ownerUserId: string;
  memberUserId: string | null;
  email: string;
  name: string | null;
  role: "admin" | "developer" | "member" | "viewer" | string;
  status: "pending" | "active" | string;
  invitedAt: string;
  joinedAt: string | null;
}

export function TeamPage() {
  const { userId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState("member");

  // Fetch Team Members
  const { data: members = [], isLoading } = useQuery<TeamMember[]>({
    queryKey: ["team-members"],
    queryFn: async () => {
      const res = await fetch("/api/team/members", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch team members");
      return res.json();
    },
  });

  // Invite Mutation
  const inviteMutation = useMutation({
    mutationFn: async (payload: { email: string; name?: string; role: string }) => {
      const res = await fetch("/api/team/invite", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to invite team member");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Invitation Sent",
        description: `Successfully added ${inviteEmail} to your team.`,
      });
      setInviteModalOpen(false);
      setInviteEmail("");
      setInviteName("");
      setInviteRole("member");
      queryClient.invalidateQueries({ queryKey: ["team-members"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Remove Failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const resendMutation = useMutation({
    mutationFn: async (memberId: number) => {
      const res = await fetch(`/api/team/members/${memberId}/resend`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to resend invitation");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Invitation Email Re-sent ✉️",
        description: `Invitation email sent to ${data.email}`,
      });
      queryClient.invalidateQueries({ queryKey: ["team-members"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to Send Email",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Remove Mutation
  const removeMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/team/members/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to remove team member");
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Member Removed",
        description: "The team member has been removed from your workspace.",
      });
      queryClient.invalidateQueries({ queryKey: ["team-members"] });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Removal Failed",
        description: "Could not remove member. Please try again.",
      });
    },
  });

  const activeCount = members.filter((m) => m.status === "active").length;
  const pendingCount = members.filter((m) => m.status === "pending").length;
  const isOwner = members.length === 0 || members.some((m) => m.ownerUserId === userId);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background overflow-y-auto">
      {/* Toolbar — parent StripeTabPage owns the page title */}
      <div className="px-6 py-4 border-b border-border/40">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <p className="text-sm text-muted-foreground">
              Invite colleagues to collaborate on agents, campaigns, and analytics.
            </p>
            <Badge variant="outline" className="text-[10px] uppercase font-mono tracking-wider shrink-0">
              Multi-User Access
            </Badge>
          </div>

          {isOwner && (
          <Button
            onClick={() => setInviteModalOpen(true)}
            className="h-10 text-xs font-medium gap-2 shadow-sm rounded-xl"
          >
            <UserPlus className="h-4 w-4" />
            Invite Member
          </Button>
          )}
        </div>
      </div>

      <div className="max-w-6xl mx-auto w-full p-6 space-y-6">
        {/* Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl border border-border/40 bg-card/50">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Total Workspace Members</span>
              <Users className="h-4 w-4" />
            </div>
            <p className="text-2xl font-bold mt-2 text-foreground">{members.length + 1}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Owner + invited members</p>
          </div>

          <div className="p-4 rounded-xl border border-border/40 bg-card/50">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Active Collaborators</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </div>
            <p className="text-2xl font-bold mt-2 text-foreground">{activeCount + 1}</p>
            <p className="text-[11px] text-emerald-500/80 mt-0.5">Active workspace users</p>
          </div>

          <div className="p-4 rounded-xl border border-border/40 bg-card/50">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Pending Invitations</span>
              <Clock className="h-4 w-4 text-amber-500" />
            </div>
            <p className="text-2xl font-bold mt-2 text-foreground">{pendingCount}</p>
            <p className="text-[11px] text-amber-500/80 mt-0.5">Awaiting user sign-in</p>
          </div>
        </div>

        {/* Team Members List */}
        <div className="rounded-xl border border-border/40 bg-card/40 overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-border/40 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Workspace Members</h2>
            <span className="text-xs text-muted-foreground">
              {members.length} {members.length === 1 ? "member" : "members"}
            </span>
          </div>

          {isLoading ? (
            <div className="p-8 text-center text-xs text-muted-foreground">Loading workspace members...</div>
          ) : members.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center justify-center gap-3">
              <div className="h-12 w-12 rounded-2xl bg-muted/30 border border-border/50 flex items-center justify-center text-muted-foreground">
                <Users className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">No team members invited yet</p>
                <p className="text-xs text-muted-foreground mt-0.5 max-w-sm">
                  Click the button below to invite colleagues and grant them access to your AI agents and campaigns.
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => setInviteModalOpen(true)}
                className="mt-2 text-xs gap-1.5 rounded-lg"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Invite Team Member
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-muted/10 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-9 w-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary text-xs font-semibold shrink-0">
                      {(member.name || member.email)[0]?.toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-medium text-foreground truncate">
                          {member.name || member.email}
                        </p>
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0 capitalize border border-border/40 font-mono"
                        >
                          {member.role}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">{member.email}</p>
                    </div>
                  </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {member.status === "active" ? (
                        <Badge className="bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/15 border-emerald-500/20 text-[10px] gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          Active
                        </Badge>
                      ) : (
                        <>
                          <Badge className="bg-amber-500/10 text-amber-400 hover:bg-amber-500/15 border-amber-500/20 text-[10px] gap-1">
                            <Clock className="h-3 w-3" />
                            Pending Invite
                          </Badge>
                          {isOwner && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-[11px] gap-1 px-2 border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                            onClick={() => resendMutation.mutate(member.id)}
                            disabled={resendMutation.isPending}
                          >
                            <Mail className="h-3 w-3" />
                            Resend Email
                          </Button>
                          )}
                        </>
                      )}

                      {isOwner && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        onClick={() => removeMutation.mutate(member.id)}
                        disabled={removeMutation.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                      )}
                    </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Invite Modal */}
      <Dialog open={inviteModalOpen} onOpenChange={setInviteModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <UserPlus className="h-4 w-4 text-primary" />
              Invite Team Member
            </DialogTitle>
            <DialogDescription className="text-xs">
              Send an invitation to a colleague to grant them access to this workspace.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Email Address *</Label>
              <Input
                placeholder="colleague@company.com"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Full Name (Optional)</Label>
              <Input
                placeholder="Alex Mercer"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Role</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin (Full Access)</SelectItem>
                  <SelectItem value="developer">Developer (Agent & Campaign Builder)</SelectItem>
                  <SelectItem value="member">Member (Standard Workspace Access)</SelectItem>
                  <SelectItem value="viewer">Viewer (Read Only Call Logs)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setInviteModalOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => inviteMutation.mutate({ email: inviteEmail, name: inviteName, role: inviteRole })}
              disabled={inviteMutation.isPending || !inviteEmail.includes("@")}
            >
              {inviteMutation.isPending ? "Sending..." : "Send Invitation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default TeamPage;
