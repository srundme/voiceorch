import { useState } from "react";
import { format } from "date-fns";
import { useAuditLogs } from "@/hooks/use-admin-api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, ClipboardList } from "lucide-react";
import { Link } from "wouter";

const ACTION_COLORS: Record<string, string> = {
  set_status_suspended: "destructive",
  set_status_deleted: "destructive",
  set_status_active: "default",
  start_impersonation: "secondary",
  end_impersonation: "outline",
  credit_wallet: "default",
  debit_wallet: "destructive",
  refund_wallet: "default",
  edit_profile: "secondary",
  create_agent: "default",
  edit_agent: "secondary",
  delete_agent: "destructive",
};

export default function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [userIdFilter, setUserIdFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [applied, setApplied] = useState<{ userId?: string; action?: string }>({});

  const { data, isLoading } = useAuditLogs({ ...applied, page });

  const rows: any[] = data?.data ?? [];
  const total: number = data?.total ?? 0;
  const pageSize: number = data?.pageSize ?? 50;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function applyFilters() {
    setPage(1);
    setApplied({ userId: userIdFilter || undefined, action: actionFilter || undefined });
  }

  function clearFilters() {
    setUserIdFilter("");
    setActionFilter("");
    setApplied({});
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ClipboardList className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-3xl font-bold tracking-tight">Audit Logs</h1>
        <Badge variant="outline" className="ml-2 font-mono">{total.toLocaleString()} entries</Badge>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground uppercase tracking-wider">User ID (clerkId)</label>
          <Input
            placeholder="user_..."
            value={userIdFilter}
            onChange={(e) => setUserIdFilter(e.target.value)}
            className="w-64 font-mono text-xs h-9"
            onKeyDown={(e) => e.key === "Enter" && applyFilters()}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground uppercase tracking-wider">Action</label>
          <Input
            placeholder="e.g. suspend_user"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="w-48 font-mono text-xs h-9"
            onKeyDown={(e) => e.key === "Enter" && applyFilters()}
          />
        </div>
        <Button size="sm" onClick={applyFilters}>Apply</Button>
        {(applied.userId || applied.action) && (
          <Button size="sm" variant="ghost" onClick={clearFilters}>Clear</Button>
        )}
      </div>

      {/* Table */}
      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-mono text-xs w-[160px]">Timestamp</TableHead>
              <TableHead className="font-mono text-xs">Action</TableHead>
              <TableHead className="font-mono text-xs">User</TableHead>
              <TableHead className="font-mono text-xs">Resource</TableHead>
              <TableHead className="font-mono text-xs">Before</TableHead>
              <TableHead className="font-mono text-xs">After</TableHead>
              <TableHead className="font-mono text-xs">IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center h-24 text-muted-foreground animate-pulse">Loading…</TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center h-24 text-muted-foreground">No audit log entries found</TableCell>
              </TableRow>
            ) : (
              rows.map((row: any) => (
                <TableRow key={row.id}>
                  <TableCell className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                    {format(new Date(row.createdAt), "MMM d HH:mm:ss")}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={(ACTION_COLORS[row.action] as any) ?? "outline"}
                      className="text-[10px] font-mono uppercase"
                    >
                      {row.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {row.targetUserId ? (
                      <Link href={`/users/${row.targetUserId}`} className="font-mono text-primary hover:underline">
                        {row.targetUserId.slice(0, 16)}…
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono">
                    {row.targetResourceType ?? "—"}
                    {row.targetResourceId ? ` #${row.targetResourceId}` : ""}
                  </TableCell>
                  <TableCell className="text-xs max-w-[160px]">
                    {row.beforeValue ? (
                      <pre className="text-[10px] font-mono text-muted-foreground truncate max-w-[140px]">
                        {JSON.stringify(row.beforeValue)}
                      </pre>
                    ) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-xs max-w-[160px]">
                    {row.afterValue ? (
                      <pre className="text-[10px] font-mono text-muted-foreground truncate max-w-[140px]">
                        {JSON.stringify(row.afterValue)}
                      </pre>
                    ) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">{row.ipAddress ?? "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Page {page} of {totalPages} ({total.toLocaleString()} total)</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
