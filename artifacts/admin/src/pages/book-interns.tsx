import { useBookInterns } from "@/hooks/use-admin-api";
import { format } from "date-fns";
import { GraduationCap, Search, CheckCircle2, Clock, BookOpen } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";

const TOTAL_CHAPTERS = 77;

export default function BookInternsPage() {
  const { data: interns, isLoading } = useBookInterns();
  const [search, setSearch] = useState("");

  const filtered = (interns ?? []).filter(
    (i) =>
      i.name.toLowerCase().includes(search.toLowerCase()) ||
      i.email.toLowerCase().includes(search.toLowerCase()),
  );

  const stats = {
    total: interns?.length ?? 0,
    passed: interns?.filter((i) => i.examPassed).length ?? 0,
    inProgress: interns?.filter((i) => !i.examPassed && i.completedChapters > 0).length ?? 0,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <GraduationCap className="text-primary" size={28} />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Book Interns</h1>
            <p className="text-sm text-muted-foreground">SnapServe Engineering Programme participants</p>
          </div>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-10 bg-muted/50 border-border"
          />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Registered", value: stats.total, icon: BookOpen },
          { label: "In Progress", value: stats.inProgress, icon: Clock },
          { label: "Passed Exam", value: stats.passed, icon: CheckCircle2 },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="border border-border rounded-xl bg-card p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Icon size={18} className="text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{value}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-mono text-xs">Name</TableHead>
              <TableHead className="font-mono text-xs">Email</TableHead>
              <TableHead className="font-mono text-xs text-center">Progress</TableHead>
              <TableHead className="font-mono text-xs text-center">Exam</TableHead>
              <TableHead className="font-mono text-xs text-right">Registered</TableHead>
              <TableHead className="font-mono text-xs text-right">Last Active</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center h-24 text-muted-foreground animate-pulse">
                  Loading…
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center h-24 text-muted-foreground">
                  {search ? "No matching interns" : "No interns registered yet"}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((intern) => {
                const pct = Math.round((intern.completedChapters / TOTAL_CHAPTERS) * 100);
                return (
                  <TableRow key={intern.id}>
                    <TableCell className="font-medium">{intern.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{intern.email}</TableCell>
                    <TableCell className="text-center">
                      <div className="flex flex-col items-center gap-1">
                        <div className="w-28 h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {intern.completedChapters}/{TOTAL_CHAPTERS}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      {intern.examPassed ? (
                        <Badge className="bg-green-500/15 text-green-400 border-green-500/30 hover:bg-green-500/15">
                          Passed {intern.examScore != null ? `(${intern.examScore}%)` : ""}
                        </Badge>
                      ) : intern.completedChapters >= TOTAL_CHAPTERS ? (
                        <Badge variant="outline" className="text-yellow-400 border-yellow-500/30">
                          Eligible
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          Not taken
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {format(new Date(intern.registeredAt), "d MMM yyyy")}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {format(new Date(intern.lastActivityAt), "d MMM yyyy")}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
