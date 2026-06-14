import { useState } from "react";
import { useListPendriveCallers, getListPendriveCallersQueryKey, useGetPendriveContext, getGetPendriveContextQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Search, ChevronLeft, ChevronRight, History, Database, PhoneCall } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDebounce } from "@/hooks/use-debounce";

function formatDate(isoString?: string) {
  if (!isoString) return "Never";
  return new Date(isoString).toLocaleDateString(undefined, { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function CallerSidePanel({ phone, open, onOpenChange }: { phone: string | null, open: boolean, onOpenChange: (o: boolean) => void }) {
  // Use a generic agentId for now, could be dynamic depending on requirements
  const { data: context, isLoading } = useGetPendriveContext(
    { agentId: 1, phoneNumber: phone || "" }, 
    { query: { enabled: !!phone && open, queryKey: getGetPendriveContextQueryKey({ agentId: 1, phoneNumber: phone || "" }) } }
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto sm:w-[540px]">
        <SheetHeader className="mb-6">
          <SheetTitle className="flex items-center gap-2 text-2xl font-mono">
            <PhoneCall className="h-5 w-5 text-primary" />
            {phone}
          </SheetTitle>
          <SheetDescription>
            {context?.name ? `Identified as ${context.name}` : "Unknown Caller Name"}
            {" • "}
            {context?.callCount ?? 0} calls
          </SheetDescription>
        </SheetHeader>

        {isLoading ? (
          <div className="space-y-6">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : !context ? (
          <div className="text-center py-12 text-muted-foreground">
            No context data available for this caller.
          </div>
        ) : (
          <Tabs defaultValue="facts" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="facts">L0 Facts</TabsTrigger>
              <TabsTrigger value="episodes">L1 Episodes</TabsTrigger>
              <TabsTrigger value="raw">Raw Memory Block</TabsTrigger>
            </TabsList>
            
            <TabsContent value="facts" className="mt-4 space-y-4">
              {context.facts?.length ? (
                <div className="grid gap-3">
                  {context.facts.map((fact) => (
                    <Card key={fact.id} className="bg-muted/50 border-none shadow-none">
                      <CardContent className="p-4 flex flex-col gap-1.5">
                        <div className="flex items-start justify-between gap-4">
                          <span className="font-mono text-xs text-primary bg-primary/10 px-2 py-0.5 rounded">
                            {fact.key}
                          </span>
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                            {formatDate(fact.createdAt)}
                          </span>
                        </div>
                        <p className="text-sm font-medium">{fact.value}</p>
                        {fact.confidence !== undefined && (
                          <div className="flex items-center gap-1.5 mt-1">
                            <div className="h-1.5 w-16 bg-background rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-primary" 
                                style={{ width: `${Math.max(0, Math.min(100, fact.confidence * 100))}%` }} 
                              />
                            </div>
                            <span className="text-[10px] text-muted-foreground">
                              {Math.round(fact.confidence * 100)}% conf
                            </span>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 border border-dashed rounded-lg">
                  <Database className="h-8 w-8 text-muted-foreground mx-auto mb-3 opacity-50" />
                  <p className="text-sm text-muted-foreground">No extracted facts for this caller.</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="episodes" className="mt-4 space-y-4">
              {context.recentCalls?.length ? (
                <div className="relative border-l border-border ml-3 space-y-6 pb-4">
                  {context.recentCalls.map((call) => (
                    <div key={call.id} className="relative pl-6">
                      <div className="absolute -left-1.5 top-1.5 h-3 w-3 rounded-full bg-background border-2 border-primary" />
                      <div className="flex flex-col gap-1 mb-2">
                        <span className="text-xs font-medium text-primary">
                          {formatDate(call.createdAt)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Duration: {call.durationSeconds}s
                        </span>
                      </div>
                      <div className="text-sm bg-muted/30 p-3 rounded-md border">
                        {call.summary || "No summary recorded for this episode."}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 border border-dashed rounded-lg">
                  <History className="h-8 w-8 text-muted-foreground mx-auto mb-3 opacity-50" />
                  <p className="text-sm text-muted-foreground">No recent episodes recorded.</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="raw" className="mt-4">
              <div className="bg-muted p-4 rounded-lg overflow-x-auto">
                <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-words">
                  {context.memoryBlock || "No memory block generated."}
                </pre>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function Callers() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [page, setPage] = useState(0);
  const limit = 15;
  const offset = page * limit;

  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);

  const { data, isLoading } = useListPendriveCallers(
    { q: debouncedSearch || undefined, limit, offset },
    { query: { queryKey: getListPendriveCallersQueryKey({ q: debouncedSearch || undefined, limit, offset }) } }
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Caller Memory Browser</h1>
          <p className="text-muted-foreground mt-2">
            Inspect the extracted facts and interaction history for every caller.
          </p>
        </div>
      </div>

      <Card className="bg-card/50">
        <div className="p-4 border-b flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search by phone or name..."
              className="pl-9 bg-background"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[180px]">Phone Number</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Calls</TableHead>
              <TableHead className="text-right">Facts</TableHead>
              <TableHead className="text-right">Last Seen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-8 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-8 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-24 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : data?.callers?.length ? (
              data.callers.map((caller) => (
                <TableRow 
                  key={caller.phoneNumber}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setSelectedPhone(caller.phoneNumber)}
                >
                  <TableCell className="font-mono text-sm text-primary">
                    {caller.phoneNumber}
                  </TableCell>
                  <TableCell>
                    {caller.name ? (
                      <span className="font-medium">{caller.name}</span>
                    ) : (
                      <span className="text-muted-foreground italic text-xs">Unknown</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="outline" className="font-mono">{caller.callCount}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {caller.factCount}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {formatDate(caller.lastCalledAt)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                  No callers found matching your search.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <div className="p-4 border-t flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {data?.total !== undefined ? (
              <>Showing <span className="font-medium text-foreground">{Math.min(offset + 1, data.total)}</span> to <span className="font-medium text-foreground">{Math.min(offset + limit, data.total)}</span> of <span className="font-medium text-foreground">{data.total}</span> entries</>
            ) : (
              <Skeleton className="h-5 w-48" />
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0 || isLoading}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => p + 1)}
              disabled={!data || offset + limit >= data.total || isLoading}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      </Card>

      <CallerSidePanel 
        phone={selectedPhone} 
        open={!!selectedPhone} 
        onOpenChange={(open) => !open && setSelectedPhone(null)} 
      />
    </div>
  );
}
