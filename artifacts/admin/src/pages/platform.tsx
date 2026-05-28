import { usePlatformActive, usePlatformFailedCalls } from "@/hooks/use-admin-api";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Activity, AlertTriangle } from "lucide-react";

export default function Platform() {
  const { data: activeData, isLoading: loadingActive, isError: activeError, error: activeErr } = usePlatformActive();
  const { data: failedCalls, isLoading: loadingFailed, isError: failedError, error: failedErr } = usePlatformFailedCalls();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Platform Health</h1>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <Card className="border-primary/20 shadow-md shadow-primary/5">
          <CardHeader className="pb-3 border-b border-border bg-card">
            <CardTitle className="text-sm font-medium uppercase tracking-wider flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" /> Active Sessions ({activeData?.count || 0})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Session ID</TableHead>
                  <TableHead>Call ID</TableHead>
                  <TableHead className="text-right">Started At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingActive ? (
                  <TableRow><TableCell colSpan={3} className="text-center py-4">Loading...</TableCell></TableRow>
                ) : activeError ? (
                  <TableRow><TableCell colSpan={3} className="text-center py-4 text-destructive">Failed to load active sessions: {(activeErr as Error)?.message}</TableCell></TableRow>
                ) : activeData?.activeSessions?.length === 0 ? (
                  <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">No active calls right now</TableCell></TableRow>
                ) : (
                  activeData?.activeSessions?.map((session: any) => (
                    <TableRow key={session.sessionId}>
                      <TableCell className="font-mono text-xs">{session.sessionId}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{session.callId}</TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {session.startedAt ? format(new Date(session.startedAt), "HH:mm:ss") : "-"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-destructive/20">
          <CardHeader className="pb-3 border-b border-border bg-card">
            <CardTitle className="text-sm font-medium uppercase tracking-wider flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" /> Recent Failed Calls
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 h-[400px] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Call ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingFailed ? (
                  <TableRow><TableCell colSpan={3} className="text-center py-4">Loading...</TableCell></TableRow>
                ) : failedError ? (
                  <TableRow><TableCell colSpan={3} className="text-center py-8 text-destructive">Failed to load failed calls: {(failedErr as Error)?.message}</TableCell></TableRow>
                ) : failedCalls?.length === 0 ? (
                  <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">No failed calls recently</TableCell></TableRow>
                ) : (
                  failedCalls?.map((call) => (
                    <TableRow key={call.id}>
                      <TableCell className="text-xs font-mono text-muted-foreground">
                        {call.createdAt ? format(new Date(call.createdAt), "MMM d HH:mm") : "-"}
                      </TableCell>
                      <TableCell className="text-xs truncate max-w-[120px]">{call.userId}</TableCell>
                      <TableCell className="text-xs font-mono truncate max-w-[120px]" title={call.id}>{call.id}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
