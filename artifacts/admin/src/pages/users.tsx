import { useUsers } from "@/hooks/use-admin-api";
import { formatCentsToDollars } from "@/lib/api";
import { format } from "date-fns";
import { Link } from "wouter";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";

export default function UsersList() {
  const { data: users, isLoading, isError, error } = useUsers();
  const [search, setSearch] = useState("");

  const filteredUsers = users?.filter(
    (u) =>
      u.email?.toLowerCase().includes(search.toLowerCase()) ||
      u.name?.toLowerCase().includes(search.toLowerCase()) ||
      u.clerkId?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Users</h1>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search email, name, ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-10 bg-muted/50 border-border"
          />
        </div>
      </div>

      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-mono text-xs">User</TableHead>
              <TableHead className="font-mono text-xs text-right">Balance</TableHead>
              <TableHead className="font-mono text-xs text-right">Spent</TableHead>
              <TableHead className="font-mono text-xs text-right">Calls</TableHead>
              <TableHead className="font-mono text-xs text-right">Agents</TableHead>
              <TableHead className="font-mono text-xs text-right">Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center h-24 text-muted-foreground animate-pulse">
                  Loading users...
                </TableCell>
              </TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center h-24 text-destructive">
                  Failed to load users: {(error as Error)?.message}
                </TableCell>
              </TableRow>
            ) : filteredUsers?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center h-24 text-muted-foreground">
                  No users found
                </TableCell>
              </TableRow>
            ) : (
              filteredUsers?.map((user) => (
                <TableRow key={user.id} className="group transition-colors">
                  <TableCell>
                    <Link href={`/users/${user.clerkId}`} className="block">
                      <div className="font-medium text-primary hover:underline">{user.email}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-[200px]">{user.name || 'Unnamed'}</div>
                      <div className="text-[10px] text-muted-foreground font-mono mt-1 opacity-50 group-hover:opacity-100">{user.clerkId}</div>
                    </Link>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    <span className={user.walletBalanceCents < 0 ? "text-destructive" : ""}>
                      {formatCentsToDollars(user.walletBalanceCents || 0)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                    {formatCentsToDollars(user.totalSpentCents || 0)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{user.callCount?.toLocaleString() || 0}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{user.agentCount?.toLocaleString() || 0}</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {user.createdAt ? format(new Date(user.createdAt), "MMM d, yyyy") : "-"}
                    {!user.onboardingCompleted && (
                      <Badge variant="outline" className="ml-2 text-[10px] px-1 py-0 h-4">Pending Setup</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
