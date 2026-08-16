import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { adminFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, RefreshCw, Wallet, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";
import { SectionSubNav } from "@/components/section-subnav";
import { MONEY_TABS } from "@/lib/nav-config";

/* ── Types ────────────────────────────────────────────────────────────────── */

interface MinuteRate {
  id: number;
  category: string;
  providerName: string;
  rateCentsPerMin: number;
  label: string | null;
  updatedAt: string;
}

interface VobizBalance {
  balance: number | null;
  availableBalance: number | null;
  lowBalanceThreshold: number | null;
  status: string | null;
  currency: string;
  raw: Record<string, unknown>;
}

/* ── Hooks ────────────────────────────────────────────────────────────────── */

function useMinuteRates() {
  return useQuery<MinuteRate[]>({
    queryKey: ["admin", "minute-rates"],
    queryFn: () => adminFetch("/minute-rates"),
  });
}

function useUpsertMinuteRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { category: string; providerName: string; rateCentsPerMin: number; label?: string }) =>
      adminFetch("/minute-rates", { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "minute-rates"] }),
  });
}

function useDeleteMinuteRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => adminFetch(`/minute-rates/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "minute-rates"] }),
  });
}

function useVobizBalance() {
  return useQuery<VobizBalance>({
    queryKey: ["admin", "vobiz-balance"],
    queryFn: () => adminFetch("/vobiz-balance"),
    retry: false,
    refetchInterval: 60_000, // refresh every 60 s
  });
}

/* ── Constants ────────────────────────────────────────────────────────────── */

const CATEGORIES = [
  { value: "llm",       label: "LLM",       color: "bg-blue-500/15 text-blue-400"   },
  { value: "asr",       label: "ASR",       color: "bg-green-500/15 text-green-400" },
  { value: "tts",       label: "TTS",       color: "bg-purple-500/15 text-purple-400" },
  { value: "telephony", label: "Telephony", color: "bg-orange-500/15 text-orange-400" },
];

const PROVIDERS_BY_CATEGORY: Record<string, string[]> = {
  llm:       ["openai", "anthropic", "deepseek", "mistral", "cohere", "qwen", "custom"],
  asr:       ["deepgram", "azure", "whisper", "assemblyai", "custom"],
  tts:       ["elevenlabs", "openai", "aws_polly", "azure", "cartesia", "deepgram", "custom"],
  telephony: ["vobiz", "twilio", "plivo", "vonage", "custom"],
};

function categoryColor(cat: string) {
  return CATEGORIES.find(c => c.value === cat)?.color ?? "bg-muted text-muted-foreground";
}

/* ── Rate Dialog ──────────────────────────────────────────────────────────── */

function RateDialog({
  editing,
  onSave,
  saving,
}: {
  editing: MinuteRate | null;
  onSave: (data: { category: string; providerName: string; rateCentsPerMin: number; label?: string }) => Promise<void>;
  saving: boolean;
}) {
  const [category, setCategory]         = useState(editing?.category ?? "");
  const [providerName, setProviderName] = useState(editing?.providerName ?? "");
  const [customProvider, setCustomProvider] = useState("");
  const [rateCents, setRateCents]       = useState(editing ? String(editing.rateCentsPerMin) : "");
  const [label, setLabel]               = useState(editing?.label ?? "");

  const providers = category ? PROVIDERS_BY_CATEGORY[category] ?? [] : [];
  const isCustom  = providerName === "custom";
  const finalProvider = isCustom ? customProvider.trim().toLowerCase() : providerName;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const rate = parseFloat(rateCents);
    if (!category || !finalProvider || isNaN(rate) || rate < 0) return;
    await onSave({ category, providerName: finalProvider, rateCentsPerMin: Math.round(rate), label: label || undefined });
  };

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{editing ? "Edit Rate" : "Add Rate"}</DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4 pt-2">
        <div className="space-y-1.5">
          <Label>Category</Label>
          <Select value={category} onValueChange={(v) => { setCategory(v); setProviderName(""); }}>
            <SelectTrigger><SelectValue placeholder="Select category…" /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Provider</Label>
          <Select value={providerName} onValueChange={setProviderName} disabled={!category}>
            <SelectTrigger><SelectValue placeholder="Select provider…" /></SelectTrigger>
            <SelectContent>
              {providers.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {isCustom && (
          <div className="space-y-1.5">
            <Label>Custom provider name</Label>
            <Input
              value={customProvider}
              onChange={e => setCustomProvider(e.target.value)}
              placeholder="e.g. my_provider"
              required
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label>Rate (₹ paise per min)</Label>
          <Input
            type="number"
            min="0"
            step="1"
            value={rateCents}
            onChange={e => setRateCents(e.target.value)}
            placeholder="e.g. 100 → ₹1.00/min"
            required
          />
          <p className="text-[11px] text-muted-foreground">
            Integer paise. 100 = ₹1.00/min · 50 = ₹0.50/min
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>Display label <span className="text-muted-foreground">(optional)</span></Label>
          <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. OpenAI GPT-4o" />
        </div>

        <DialogFooter className="pt-2">
          <Button type="submit" disabled={saving || !category || !finalProvider || !rateCents}>
            {saving ? "Saving…" : "Save rate"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

/* ── Vobiz Wallet Card ────────────────────────────────────────────────────── */

function VobizWalletCard() {
  const { data, isLoading, error, refetch, isFetching } = useVobizBalance();

  const fmt = (n: number | null | undefined, currency: string) =>
    n != null ? `${currency === "INR" ? "₹" : ""}${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null;

  const balanceDisplay = () => {
    if (isLoading) return "Loading…";
    if (error)     return "Unavailable";
    return fmt(data?.availableBalance ?? data?.balance, data?.currency ?? "INR") ?? "Unknown";
  };

  const balanceNum = data?.availableBalance ?? data?.balance ?? null;
  const threshold  = data?.lowBalanceThreshold ?? 5000;
  const isLow      = balanceNum !== null && balanceNum < threshold;

  return (
    <Card className={isLow ? "border-orange-500/50" : ""}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-muted-foreground" />
            VoBiz Master Wallet
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-3">
          <span className={`text-3xl font-bold tracking-tight ${isLow ? "text-orange-400" : ""} ${error ? "text-muted-foreground" : ""}`}>
            {balanceDisplay()}
          </span>
          {data && !error && (
            <span className="text-sm text-muted-foreground mb-0.5">{data.currency}</span>
          )}
          {data?.status && !error && (
            <span className={`mb-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${data.status === "active" ? "bg-emerald-500/15 text-emerald-400" : "bg-yellow-500/15 text-yellow-400"}`}>
              {data.status}
            </span>
          )}
        </div>
        {data && !error && data.availableBalance !== data.balance && data.balance != null && (
          <p className="text-xs text-muted-foreground mt-0.5">
            Total: {fmt(data.balance, data.currency ?? "INR")} &nbsp;·&nbsp; Available: {fmt(data.availableBalance, data.currency ?? "INR")}
          </p>
        )}
        {isLow && !error && (
          <div className="flex items-center gap-1.5 mt-2 text-xs text-orange-400">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            Balance below ₹{threshold.toLocaleString("en-IN")} threshold — top up the Vobiz account to avoid call failures.
          </div>
        )}
        {error && (
          <p className="text-xs text-muted-foreground mt-1">
            {String(error).includes("VOBIZ_AUTH") ? "VOBIZ_AUTH_ID / VOBIZ_AUTH_TOKEN not configured on server." : "Could not fetch balance from Vobiz API."}
          </p>
        )}

        <div className="mt-4 rounded-md bg-muted/40 border border-border p-3 space-y-1.5 text-xs text-muted-foreground">
          <p className="font-semibold text-foreground text-[11px] uppercase tracking-wider">Maintenance guide</p>
          <p>• Top up when balance drops below <strong className="text-foreground">₹10,000</strong> (~15,000 call-minutes at ₹0.65/min).</p>
          <p>• Enable low-balance alerts in your Vobiz account dashboard so you get an SMS/email warning.</p>
          <p>• The platform auto-limits each user call to their remaining wallet minutes so they can never overdraw the Vobiz balance.</p>
          <p>• Recharge at: <a className="text-primary underline" href="https://vobiz.ai" target="_blank" rel="noreferrer">vobiz.ai</a> → Billing.</p>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Main Page ────────────────────────────────────────────────────────────── */

export default function CallPricingPage() {
  const { data: rates = [], isLoading } = useMinuteRates();
  const upsert = useUpsertMinuteRate();
  const del    = useDeleteMinuteRate();
  const { toast } = useToast();

  const [editing, setEditing] = useState<MinuteRate | null>(null);
  const [open, setOpen]       = useState(false);

  const openNew  = () => { setEditing(null); setOpen(true); };
  const openEdit = (r: MinuteRate) => { setEditing(r); setOpen(true); };

  const handleSave = async (data: { category: string; providerName: string; rateCentsPerMin: number; label?: string }) => {
    try {
      await upsert.mutateAsync(data);
      setOpen(false);
      toast({ title: "Rate saved" });
    } catch (err) {
      toast({ title: "Save failed", description: formatApiError(err), variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this rate?")) return;
    try {
      await del.mutateAsync(id);
      toast({ title: "Rate deleted" });
    } catch (err) {
      toast({ title: "Delete failed", description: formatApiError(err), variant: "destructive" });
    }
  };

  // Group rates by category for display
  const grouped = CATEGORIES.map(cat => ({
    ...cat,
    rates: rates.filter(r => r.category === cat.value),
  }));

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto w-full">
      <SectionSubNav tabs={MONEY_TABS} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Call Pricing</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Set per-minute reseller rates by provider. These are charged to users and shown on their agent cards.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={openNew}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add rate
            </Button>
          </DialogTrigger>
          <RateDialog
            editing={editing}
            onSave={handleSave}
            saving={upsert.isPending}
          />
        </Dialog>
      </div>

      {/* Vobiz balance */}
      <VobizWalletCard />

      {/* Rate tables per category */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-4">
          {grouped.map(group => (
            <Card key={group.value}>
              <CardHeader className="py-3 px-4 border-b border-border">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Badge className={`${group.color} border-0 text-[11px]`}>{group.label}</Badge>
                  <span className="text-muted-foreground font-normal">
                    {group.rates.length === 0 ? "No rates configured" : `${group.rates.length} provider${group.rates.length !== 1 ? "s" : ""}`}
                  </span>
                </CardTitle>
              </CardHeader>
              {group.rates.length > 0 && (
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Provider</TableHead>
                        <TableHead>Label</TableHead>
                        <TableHead className="text-right">Rate / min</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.rates.map(rate => (
                        <TableRow key={rate.id}>
                          <TableCell className="font-mono text-sm">{rate.providerName}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">{rate.label ?? "—"}</TableCell>
                          <TableCell className="text-right font-semibold">
                            ₹{(rate.rateCentsPerMin / 100).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { openEdit(rate); }}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(rate.id)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}

      <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground space-y-1">
        <p className="font-semibold text-foreground">How billing works</p>
        <p>• Total per-min charge = LLM rate + ASR rate + TTS rate + Telephony rate for the agent's provider stack.</p>
        <p>• At call start, max duration = floor(user wallet / total rate) minutes — call auto-hangs up at that limit.</p>
        <p>• At call end, we debit per-second pro-rata: (seconds / 60) × rate. A 9s call @ ₹5/min is ₹0.75 — not a full minute. No-pickup / busy / failed calls are not charged.</p>
        <p>• Rates are in <strong className="text-foreground">paise (1/100 ₹)</strong>. 100 = ₹1.00/min.</p>
      </div>
    </div>
  );
}
