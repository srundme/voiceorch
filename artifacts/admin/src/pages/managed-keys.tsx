import { useState } from "react";
import { useManagedKeys, useSaveManagedKeys } from "@/hooks/use-admin-api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Key, Save, RefreshCw, Loader2, Info } from "lucide-react";
import { formatApiError } from "@/lib/format-api-error";

const KEY_FIELDS = [
  {
    key: "managed_gemini_key",
    label: "Google Gemini API Key",
    description: "Used for LLM (all managed agents) and AI prompt generation",
    placeholder: "AIza...",
  },
  {
    key: "managed_deepgram_key",
    label: "Deepgram API Key",
    description: "Used for STT (Speech-to-Text) for English and non-Tamil languages",
    placeholder: "Token ...",
  },
  {
    key: "managed_sarvam_key",
    label: "Sarvam API Key",
    description: "Used for STT when Tamil language is selected",
    placeholder: "sk-...",
  },
  {
    key: "managed_cartesia_key",
    label: "Cartesia API Key",
    description: "Used for TTS (Text-to-Speech) for all managed agents and voice preview",
    placeholder: "sk-...",
  },
  {
    key: "managed_vobiz_auth_id",
    label: "VoBiz Auth ID",
    description: "Used for telephony — the platform VoBiz account ID",
    placeholder: "vobiz-auth-id",
  },
  {
    key: "managed_vobiz_auth_token",
    label: "VoBiz Auth Token",
    description: "Used for telephony — the platform VoBiz auth token",
    placeholder: "vobiz-auth-token",
  },
  {
    key: "managed_openai_key",
    label: "OpenAI API Key (optional)",
    description: "Fallback LLM key if needed",
    placeholder: "sk-...",
  },
];

export default function ManagedKeys() {
  const { data: currentKeys, isLoading, refetch } = useManagedKeys();
  const { mutate: saveKeys, isPending } = useSaveManagedKeys();
  const { toast } = useToast();
  const [formValues, setFormValues] = useState<Record<string, string>>({});

  function handleChange(key: string, value: string) {
    setFormValues(prev => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    saveKeys(formValues, {
      onSuccess: (data) => {
        toast({ title: `Saved ${(data as any).saved} key(s) successfully` });
        setFormValues({});
        refetch();
      },
      onError: (err) => toast({ title: "Save failed", description: formatApiError(err), variant: "destructive" }),
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Managed Stack Keys</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Master API keys used when customers choose the Managed AI stack. Keys are stored encrypted and never exposed to users.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      <div className="rounded-md border border-primary/20 bg-primary/5 p-4 flex items-start gap-3">
        <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <div className="text-sm text-muted-foreground">
          <strong className="text-foreground">Managed Stack:</strong> Tamil language agents use Sarvam STT + Gemini LLM + Cartesia TTS + VoBiz telephony. All other languages use Deepgram STT + Gemini LLM + Cartesia TTS + VoBiz telephony. To update a key, type the new value and click Save. Masked values (showing ••••) are already stored.
        </div>
      </div>

      <Card>
        <CardHeader className="border-b border-border pb-4">
          <CardTitle className="text-sm font-medium uppercase tracking-wider flex items-center gap-2">
            <Key className="h-4 w-4 text-primary" /> Provider API Keys
          </CardTitle>
          <CardDescription className="text-xs">
            Leave a field blank to keep the existing value. Enter a new value to overwrite.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6 space-y-6">
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading current keys...
            </div>
          ) : (
            <>
              {KEY_FIELDS.map(field => (
                <div key={field.key} className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-foreground/80">
                    {field.label}
                  </Label>
                  <p className="text-xs text-muted-foreground mb-2">{field.description}</p>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      placeholder={
                        currentKeys?.[field.key]
                          ? `Current: ${currentKeys[field.key]} (enter new value to replace)`
                          : `${field.placeholder} — not set`
                      }
                      value={formValues[field.key] ?? ""}
                      onChange={e => handleChange(field.key, e.target.value)}
                      className="font-mono text-xs bg-muted/30 border-border"
                    />
                    {currentKeys?.[field.key] && (
                      <div className="flex items-center px-3 rounded-md border border-border bg-muted/20 text-xs font-mono text-muted-foreground whitespace-nowrap">
                        {currentKeys[field.key]}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              <div className="pt-2">
                <Button
                  onClick={handleSave}
                  disabled={isPending || Object.values(formValues).every(v => !v?.trim())}
                  className="gap-2"
                >
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save Keys
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
