import { useState, useEffect } from "react";
import {
  useManagedPhoneNumbers,
  useSaveManagedPhoneNumbers,
  useManagedOutboundTrial,
  useSaveManagedOutboundTrial,
} from "@/hooks/use-admin-api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Save, Phone, RefreshCw, Plus, Trash2, Info } from "lucide-react";
import { SectionSubNav } from "@/components/section-subnav";
import { PRODUCT_TABS } from "@/lib/nav-config";

export default function ManagedNumbers() {
  const { data, isLoading, refetch } = useManagedPhoneNumbers();
  const { mutate: save, isPending } = useSaveManagedPhoneNumbers();
  const { data: trial, isLoading: trialLoading } = useManagedOutboundTrial();
  const { mutate: saveTrial, isPending: trialSaving } = useSaveManagedOutboundTrial();
  const { toast } = useToast();

  const [selected, setSelected] = useState<string[]>([]);
  const [manualInput, setManualInput] = useState("");
  const [dailyLimit, setDailyLimit] = useState(3);

  useEffect(() => {
    if (data) setSelected(data.selected);
  }, [data]);

  useEffect(() => {
    if (trial) setDailyLimit(trial.dailyLimit);
  }, [trial]);

  const toggle = (number: string) => {
    setSelected(prev =>
      prev.includes(number) ? prev.filter(n => n !== number) : [...prev, number],
    );
  };

  const addManual = () => {
    const num = manualInput.trim();
    if (!num) return;
    if (!selected.includes(num)) setSelected(prev => [...prev, num]);
    setManualInput("");
  };

  const remove = (number: string) => setSelected(prev => prev.filter(n => n !== number));

  const handleSave = () => {
    save(selected, {
      onSuccess: ({ saved }) => {
        toast({ title: "Saved", description: `${saved} managed number${saved !== 1 ? "s" : ""} configured.` });
      },
      onError: (err) => {
        toast({ title: "Error", description: (err as Error).message, variant: "destructive" });
      },
    });
  };

  const handleSaveTrial = () => {
    saveTrial(
      { dailyLimit: Math.max(0, Math.floor(dailyLimit)) },
      {
        onSuccess: (saved) => {
          toast({
            title: "Trial limit saved",
            description: `Default trial capped at ${saved.dailyLimit} outbound call${saved.dailyLimit === 1 ? "" : "s"}/day. Unlimited trial is granted per account on the Users page.`,
          });
        },
        onError: (err) => {
          toast({ title: "Error", description: (err as Error).message, variant: "destructive" });
        },
      },
    );
  };

  const available  = data?.available ?? [];
  const fetchError = data?.fetchError ?? null;
  const notInPool  = available.filter(n => !selected.includes(n.number));

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <SectionSubNav tabs={PRODUCT_TABS} />
      <div>
        <h1 className="text-2xl font-semibold">Managed Phone Numbers</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Numbers in this pool are used as the "from" number when users make calls via the
          managed telephony option (no personal number or KYC required).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Trial outbound limits
          </CardTitle>
          <CardDescription>
            Default daily cap for users without a purchased number. To give unlimited trial
            to a specific account, open that user and toggle Unlimited trial.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {trialLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="daily-limit">Daily trial call limit</Label>
                <Input
                  id="daily-limit"
                  type="number"
                  min={0}
                  className="max-w-[160px]"
                  value={dailyLimit}
                  onChange={(e) => setDailyLimit(Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Default is 3. Resets at midnight IST. Purchased numbers are always unlimited.
                </p>
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSaveTrial} disabled={trialSaving}>
                  {trialSaving ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                  Save trial limit
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Phone className="h-4 w-4" />
            Active Pool
          </CardTitle>
          <CardDescription>
            These numbers will be randomly selected for managed outbound calls.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {selected.length === 0 ? (
            <p className="text-sm text-muted-foreground">No numbers in pool. Add some below.</p>
          ) : (
            <div className="space-y-2">
              {selected.map(num => (
                <div key={num} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <span className="font-mono text-sm">{num}</span>
                  <Button size="sm" variant="ghost" onClick={() => remove(num)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Input
              placeholder="+91XXXXXXXXXX"
              value={manualInput}
              onChange={e => setManualInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addManual()}
              className="font-mono"
            />
            <Button variant="outline" onClick={addManual}>
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <RefreshCw className="h-4 w-4" />
            Available from Vobiz Master Account
          </CardTitle>
          <CardDescription>
            Phone numbers currently registered under the platform's master Vobiz account.
            Check the ones you want to add to the managed pool.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : available.length === 0 ? (
            <div className="flex items-start gap-2 text-sm py-2">
              <Info className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground">
                No numbers found via the Vobiz partner API.{" "}
                {fetchError && <span className="text-xs text-muted-foreground/70">({fetchError})</span>}
                {" "}If you have a Vobiz number, enter it manually in the <strong>Active Pool</strong> section above using the +&nbsp;Add field.
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              {available.map(n => {
                const inPool = selected.includes(n.number);
                return (
                  <div
                    key={n.number}
                    className="flex items-center gap-3 rounded-md border px-3 py-2 cursor-pointer hover:bg-accent"
                    onClick={() => toggle(n.number)}
                  >
                    <Checkbox
                      checked={inPool}
                      onCheckedChange={() => toggle(n.number)}
                      onClick={e => e.stopPropagation()}
                    />
                    <span className="font-mono text-sm flex-1">{n.number}</span>
                    {n.numberType && (
                      <Badge variant="outline" className="text-xs">{n.numberType}</Badge>
                    )}
                    {n.region && (
                      <span className="text-xs text-muted-foreground">{n.region}</span>
                    )}
                    {inPool && <Badge className="text-xs bg-emerald-600">In pool</Badge>}
                  </div>
                );
              })}
              {notInPool.length === 0 && available.length > 0 && (
                <p className="text-xs text-muted-foreground pt-1">All account numbers are in the pool.</p>
              )}
            </div>
          )}

          <div className="flex justify-end mt-4">
            <Button variant="ghost" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save Pool
        </Button>
      </div>
    </div>
  );
}
