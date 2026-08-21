import { format, parseISO } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarCheck } from "lucide-react";
import { SectionSubNav } from "@/components/section-subnav";
import { PRODUCT_TABS } from "@/lib/nav-config";
import { Link } from "wouter";

type GcalConnection = {
  id: string;
  userEmail: string | null;
  connectedEmail: string;
  grantedScopes: string | null;
  scopeValid: boolean;
  tokenExpiry: string | null;
  updatedAt: string;
};

function useGcalConnections() {
  return useQuery({
    queryKey: ["admin", "gcal-connections"],
    queryFn: () => adminFetch<GcalConnection[]>("/gcal-connections"),
    refetchInterval: 60000,
  });
}

function ScopeValidBadge({ valid }: { valid: boolean }) {
  if (valid) {
    return (
      <Badge className="bg-green-500/10 text-green-600 border-green-500/30 text-xs">
        Valid
      </Badge>
    );
  }
  return (
    <Badge className="bg-destructive/10 text-destructive border-destructive/30 text-xs">
      Insufficient
    </Badge>
  );
}

export default function GcalConnectionsPage() {
  const { data: connections, isLoading, isError } = useGcalConnections();

  return (
    <div className="space-y-6">
      <SectionSubNav tabs={PRODUCT_TABS} />
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-muted/40 border border-border">
          <CalendarCheck className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Google Calendar Connections</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Per-user OAuth connections — scopes, token expiry, and sync health.{" "}
            <Link href="/product/integrations" className="text-primary hover:underline">
              All integrations →
            </Link>
          </p>
        </div>
      </div>

      {isError && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-6">
            <p className="text-sm text-destructive">Failed to load Google Calendar connections. Check admin token or server logs.</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Connected Accounts</CardTitle>
          <CardDescription className="text-xs">
            Connections with "Insufficient" scope were authorized before the full <code>calendar</code> scope was required.
            Users must reconnect via Settings → Conferencing → Reconnect to grant the full scope and enable Meet links.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User Email</TableHead>
                <TableHead>Connected Google Account</TableHead>
                <TableHead>Scope Valid</TableHead>
                <TableHead>Scopes Granted</TableHead>
                <TableHead>Token Expiry</TableHead>
                <TableHead>Last Refreshed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))}
              {!isLoading && (!connections || connections.length === 0) && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    No Google Calendar connections found
                  </TableCell>
                </TableRow>
              )}
              {connections?.map((conn) => (
                <TableRow key={conn.id}>
                  <TableCell className="text-sm font-medium">
                    {conn.userEmail ?? <span className="text-muted-foreground italic">unknown</span>}
                  </TableCell>
                  <TableCell className="text-sm">{conn.connectedEmail}</TableCell>
                  <TableCell>
                    <ScopeValidBadge valid={conn.scopeValid} />
                  </TableCell>
                  <TableCell>
                    <div className="max-w-xs">
                      {conn.grantedScopes ? (
                        <p className="text-xs text-muted-foreground font-mono break-all leading-relaxed">
                          {conn.grantedScopes.split(/\s+/).map((s, i) => (
                            <span key={i} className={`inline-block mr-1 mb-0.5 px-1 py-0.5 rounded bg-muted ${
                              s.includes("auth/calendar") && !s.includes("calendar.events") ? "text-green-600 bg-green-500/10" :
                              s.includes("calendar.events") ? "text-yellow-600 bg-yellow-500/10" : ""
                            }`}>
                              {s.replace("https://www.googleapis.com/auth/", "")}
                            </span>
                          ))}
                        </p>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">Not captured (legacy)</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {conn.tokenExpiry
                      ? format(parseISO(conn.tokenExpiry), "MMM d, yyyy HH:mm")
                      : <span className="italic">Unknown</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {conn.updatedAt
                      ? format(parseISO(conn.updatedAt), "MMM d, yyyy HH:mm")
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
