import { useLandingPartnerLeads } from "@/hooks/use-admin-api";
import { format } from "date-fns";
import { Handshake, Search } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { useState } from "react";

export default function LandingLeadsPage() {
  const { data: leads, isLoading } = useLandingPartnerLeads();
  const [search, setSearch] = useState("");

  const filtered = (leads ?? []).filter((row) => {
    const q = search.toLowerCase();
    return (
      row.name.toLowerCase().includes(q)
      || row.email.toLowerCase().includes(q)
      || (row.company ?? "").toLowerCase().includes(q)
      || (row.phone ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <Handshake className="text-primary" size={28} />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Partner inquiries</h1>
            <p className="text-sm text-muted-foreground">
              Landing-page “Partner with us” form submissions
            </p>
          </div>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name, email, company…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-10 bg-muted/50 border-border"
          />
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{filtered.length} inquiries</p>

      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-mono text-xs">When</TableHead>
              <TableHead className="font-mono text-xs">Name</TableHead>
              <TableHead className="font-mono text-xs">Email</TableHead>
              <TableHead className="font-mono text-xs">Phone</TableHead>
              <TableHead className="font-mono text-xs">Company</TableHead>
              <TableHead className="font-mono text-xs">Message</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">Loading…</TableCell>
              </TableRow>
            )}
            {!isLoading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">No partner inquiries yet.</TableCell>
              </TableRow>
            )}
            {filtered.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {format(new Date(row.createdAt), "dd MMM yyyy HH:mm")}
                </TableCell>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell>
                  <a className="text-primary underline-offset-2 hover:underline" href={`mailto:${row.email}`}>
                    {row.email}
                  </a>
                </TableCell>
                <TableCell className="text-sm">{row.phone ?? "—"}</TableCell>
                <TableCell className="text-sm">{row.company ?? "—"}</TableCell>
                <TableCell className="max-w-xs truncate text-sm text-muted-foreground" title={row.message ?? ""}>
                  {row.message ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
