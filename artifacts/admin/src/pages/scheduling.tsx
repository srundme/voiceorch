import { useState } from "react";
import { format, parseISO } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, Filter } from "lucide-react";

function useAdminBookings(params: { status?: string; startDate?: string; endDate?: string; agentId?: string } = {}) {
  const qs = new URLSearchParams();
  if (params.status && params.status !== "all") qs.set("status", params.status);
  if (params.startDate) qs.set("startDate", params.startDate);
  if (params.endDate) qs.set("endDate", params.endDate);
  if (params.agentId && params.agentId !== "all") qs.set("agentId", params.agentId);
  return useQuery({
    queryKey: ["admin", "scheduling", "bookings", params],
    queryFn: () => adminFetch<any[]>(`/scheduling/bookings?${qs}`),
    refetchInterval: 30000,
  });
}

function statusBadge(status: string) {
  switch (status) {
    case "confirmed":   return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200">{status}</Badge>;
    case "pending":     return <Badge className="bg-amber-50 text-amber-700 border-amber-200">{status}</Badge>;
    case "cancelled":   return <Badge className="bg-red-50 text-red-600 border-red-200">{status}</Badge>;
    case "rescheduled": return <Badge className="bg-blue-50 text-blue-700 border-blue-200">{status}</Badge>;
    default:            return <Badge variant="outline">{status}</Badge>;
  }
}

export default function AdminSchedulingPage() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [agentIdFilter, setAgentIdFilter] = useState("");

  const { data: bookings, isLoading } = useAdminBookings({
    status: statusFilter,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    agentId: agentIdFilter || undefined,
  });

  return (
    <div className="p-6 flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-emerald-50">
          <Calendar className="h-5 w-5 text-emerald-600" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Platform Scheduling</h1>
          <p className="text-sm text-muted-foreground">All bookings across all tenants (read-only)</p>
        </div>
      </div>

      <div className="flex gap-3 items-center flex-wrap">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <Filter className="h-3.5 w-3.5 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="rescheduled">Rescheduled</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Input type="date" className="h-9 w-36" value={startDate} onChange={e => setStartDate(e.target.value)} placeholder="Start date" />
          <span className="text-muted-foreground text-sm">–</span>
          <Input type="date" className="h-9 w-36" value={endDate} onChange={e => setEndDate(e.target.value)} placeholder="End date" />
        </div>
        <Input
          type="number"
          className="h-9 w-32"
          value={agentIdFilter}
          onChange={e => setAgentIdFilter(e.target.value)}
          placeholder="Agent ID"
          min="1"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Attendee</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Slot</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Via</TableHead>
                <TableHead>User ID</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))}
              {!isLoading && (!bookings || bookings.length === 0) && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">No bookings found</TableCell>
                </TableRow>
              )}
              {bookings?.map((b: any) => (
                <TableRow key={b.id}>
                  <TableCell className="font-mono text-xs">#{b.id}</TableCell>
                  <TableCell className="font-medium text-sm">{b.attendeeName}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{b.attendeeEmail}</TableCell>
                  <TableCell className="text-xs">
                    {format(parseISO(b.slotStart), "MMM d, yyyy")}<br />
                    <span className="text-muted-foreground">{format(parseISO(b.slotStart), "h:mm a")}</span>
                  </TableCell>
                  <TableCell>{statusBadge(b.status)}</TableCell>
                  <TableCell><span className="text-xs capitalize">{b.bookedVia}</span></TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{b.userId?.slice(0, 12)}…</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{format(parseISO(b.createdAt), "MMM d")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
