import { ChevronLeft, User as UserIcon } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";

function initialsFor(name: string | null, email: string | null): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    return parts.length > 1
      ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
      : parts[0].slice(0, 2).toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return "?";
}

export default function ProfilePage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const name = user?.name ?? null;
  const email = user?.email ?? null;

  function handleSave() {
    toast({
      title: "No changes to save",
      description: "Your name and email are managed by your sign-in provider (Google or email account) and can't be edited here.",
    });
  }

  return (
    <div className="space-y-6">
      <Link href="/app/settings">
        <a className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="h-4 w-4" /> Back to Settings
        </a>
      </Link>
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Profile</h2>
        <p className="text-muted-foreground text-sm">Your basic account identity.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserIcon className="h-5 w-5 text-primary" />
            Profile
          </CardTitle>
          <CardDescription>
            Name and email are sourced from your sign-in account and can't be changed here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 max-w-sm">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-full bg-primary/10 text-primary flex items-center justify-center text-lg font-semibold shrink-0">
              {initialsFor(name, email)}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{name ?? "—"}</p>
              <p className="text-xs text-muted-foreground truncate">{email ?? "—"}</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="profile-name">Name</Label>
            <input
              id="profile-name"
              value={name ?? ""}
              readOnly
              disabled
              className="flex h-9 w-full rounded-md border border-border/60 bg-muted/20 px-3 py-1 text-sm text-muted-foreground shadow-sm disabled:cursor-not-allowed disabled:opacity-70"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="profile-email">Email</Label>
            <input
              id="profile-email"
              value={email ?? ""}
              readOnly
              disabled
              className="flex h-9 w-full rounded-md border border-border/60 bg-muted/20 px-3 py-1 text-sm text-muted-foreground shadow-sm disabled:cursor-not-allowed disabled:opacity-70"
            />
          </div>

          <Button onClick={handleSave} className="w-full sm:w-auto">
            Save Changes
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
