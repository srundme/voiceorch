import { useUserDetail, useAdjustWallet } from "@/hooks/use-admin-api";
import { formatCentsToDollars, formatDuration } from "@/lib/api";
import { format } from "date-fns";
import { useParams, Link } from "wouter";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Wallet, PhoneCall, Bot, Activity } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";

export default function UserDetail() {
  const { clerkId } = useParams<{ clerkId: string }>();
  const { data, isLoading } = useUserDetail(clerkId || "");
  const adjustWallet = useAdjustWallet(clerkId || "");
  const { toast } = useToast();

  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [adjustmentDollars, setAdjustmentDollars] = useState("");
  const [adjustmentDesc, setAdjustmentDesc] = useState("");

  const handleAdjustWallet = () => {
    const amount = parseFloat(adjustmentDollars);
    if (isNaN(amount)) {
      toast({ title: "Invalid amount", variant: "destructive" });
      return;
    }

    const cents = Math.round(amount * 100);
    adjustWallet.mutate(
      { adjustmentCents: cents, description: adjustmentDesc || "Admin manual adjustment" },
      {
        onSuccess: () => {
          toast({ title: "Wallet adjusted successfully" });
          setWalletModalOpen(false);
          setAdjustmentDollars("");
          setAdjustmentDesc("");
        },
        onError: (err) => {
          toast({ title: "Failed to adjust wallet", description: formatApiError(err), variant: "destructive" });
        }
      }
    );
  };

  if (isLoading) {
    return <div className="p-8 text-muted-foreground animate-pulse">Loading user details...</div>;
  }

  if (!data?.user) {
    return <div className="p-8 text-destructive">User not found.</div>;
  }

  const { user, calls = [], walletTransactions = [], agents = [] } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild>
          <Link href="/users">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{user.email}</h1>
          <p className="text-sm text-muted-foreground font-mono">{user.clerkId}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="md:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Wallet className="h-4 w-4" /> Wallet Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold font-mono ${user.walletBalanceCents < 0 ? 'text-destructive' : ''}`}>
              {formatCentsToDollars(user.walletBalanceCents || 0)}
            </div>
            <Button 
              className="w-full mt-4" 
              variant="outline"
              onClick={() => setWalletModalOpen(true)}
            >
              Adjust Balance
            </Button>
          </CardContent>
        </Card>

        <Card className="md:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Activity className="text-muted-foreground h-4 w-4" /> Profile Info
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="block text-muted-foreground text-xs uppercase mb-1">Name</span>
              <span className="font-medium">{user.name || "N/A"}</span>
            </div>
            <div>
              <span className="block text-muted-foreground text-xs uppercase mb-1">Joined</span>
              <span className="font-mono">{user.createdAt ? format(new Date(user.createdAt), "yyyy-MM-dd") : "Unknown"}</span>
            </div>
            <div>
              <span className="block text-muted-foreground text-xs uppercase mb-1">Total Spent</span>
              <span className="font-mono text-muted-foreground">{formatCentsToDollars(user.totalSpentCents || 0)}</span>
            </div>
            <div>
              <span className="block text-muted-foreground text-xs uppercase mb-1">Status</span>
              <Badge variant={user.onboardingCompleted ? "outline" : "secondary"}>
                {user.onboardingCompleted ? "Active" : "Onboarding"}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3 border-b border-border mb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Bot className="h-4 w-4" /> Agents
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[300px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agents.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">No agents found</TableCell>
                    </TableRow>
                  ) : (
                    agents.map((agent: any) => (
                      <TableRow key={agent.id}>
                        <TableCell className="font-medium">{agent.name}</TableCell>
                        <TableCell className="text-xs capitalize">{agent.agentType || "Standard"}</TableCell>
                        <TableCell>
                          <Badge variant={agent.isActive ? "outline" : "secondary"} className="text-[10px] uppercase">
                            {agent.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 border-b border-border mb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <PhoneCall className="h-4 w-4" /> Recent Calls
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="h-[400px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="w-[100px]">Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {calls.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No calls found</TableCell>
                    </TableRow>
                  ) : (
                    calls.map((call: any) => (
                      <TableRow key={call.id}>
                        <TableCell>
                          <Badge variant={call.status === "completed" ? "default" : call.status === "failed" ? "destructive" : "secondary"} className="text-[10px] uppercase">
                            {call.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground">
                          {format(new Date(call.createdAt), "MMM d HH:mm")}
                        </TableCell>
                        <TableCell className="text-right text-xs font-mono tabular-nums">
                          {formatDuration(call.durationSeconds || 0)}
                        </TableCell>
                        <TableCell className="text-right text-xs font-mono tabular-nums">
                          {formatCentsToDollars(call.costCents || 0)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 border-b border-border mb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Wallet className="h-4 w-4" /> Wallet Transactions
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="h-[400px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Desc</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {walletTransactions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No transactions found</TableCell>
                    </TableRow>
                  ) : (
                    walletTransactions.map((tx: any) => (
                      <TableRow key={tx.id}>
                        <TableCell className="text-xs font-mono text-muted-foreground">
                          {format(new Date(tx.createdAt), "MMM d HH:mm")}
                        </TableCell>
                        <TableCell className="text-xs capitalize">{tx.type}</TableCell>
                        <TableCell className="text-xs truncate max-w-[150px]" title={tx.description}>{tx.description}</TableCell>
                        <TableCell className={`text-right text-xs font-mono tabular-nums ${tx.amountCents > 0 ? 'text-primary' : 'text-destructive'}`}>
                          {tx.amountCents > 0 ? '+' : ''}{formatCentsToDollars(tx.amountCents)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={walletModalOpen} onOpenChange={setWalletModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Adjust Wallet Balance</DialogTitle>
            <DialogDescription>
              Add or remove funds from {user.email}'s wallet. Enter negative amount to deduct.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="amount">Amount (USD)</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                placeholder="e.g. 10.00 or -5.50"
                value={adjustmentDollars}
                onChange={(e) => setAdjustmentDollars(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Reason for adjustment..."
                value={adjustmentDesc}
                onChange={(e) => setAdjustmentDesc(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWalletModalOpen(false)}>Cancel</Button>
            <Button onClick={handleAdjustWallet} disabled={adjustWallet.isPending || !adjustmentDollars}>
              {adjustWallet.isPending ? "Applying..." : "Apply Adjustment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
