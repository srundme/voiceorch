import React, { useState } from "react";
import { Plus, Key, Lock, Settings2, Trash2, Edit2, AlertCircle } from "lucide-react";
import { 
  useListProviders, 
  useCreateProvider,
  useUpdateProvider,
  useDeleteProvider,
  getListProvidersQueryKey 
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";

const providerFormSchema = z.object({
  providerType: z.enum(["asr", "llm", "tts", "telephony"]),
  providerName: z.string().min(1, "Provider name is required"),
  apiKey: z.string().min(1, "API key is required"),
  extraConfig: z.string().optional(),
});

type ProviderFormValues = z.infer<typeof providerFormSchema>;

export default function ProvidersList() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [isAddOpen, setIsAddOpen] = useState(false);
  
  const { data: providers, isLoading } = useListProviders({
    query: { queryKey: getListProvidersQueryKey() }
  });
  
  const createProvider = useCreateProvider();
  const deleteProvider = useDeleteProvider();

  const form = useForm<ProviderFormValues>({
    resolver: zodResolver(providerFormSchema),
    defaultValues: {
      providerType: "llm",
      providerName: "",
      apiKey: "",
      extraConfig: "",
    },
  });

  const onSubmit = (data: ProviderFormValues) => {
    createProvider.mutate(
      { data },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProvidersQueryKey() });
          setIsAddOpen(false);
          form.reset();
          toast({
            title: "Provider added",
            description: "Your API key has been securely saved.",
          });
        },
        onError: () => {
          toast({
            title: "Error",
            description: "Failed to save provider.",
            variant: "destructive",
          });
        }
      }
    );
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this provider key? Any agents using this key will fail to connect.")) {
      deleteProvider.mutate(
        { id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListProvidersQueryKey() });
            toast({
              title: "Provider deleted",
              description: "The provider key has been removed.",
            });
          },
          onError: () => {
            toast({
              title: "Error",
              description: "Failed to delete provider.",
              variant: "destructive",
            });
          }
        }
      );
    }
  };

  const getProviderCategoryTitle = (type: string) => {
    switch(type) {
      case 'asr': return 'Speech-to-Text (ASR)';
      case 'llm': return 'Language Models (LLM)';
      case 'tts': return 'Text-to-Speech (TTS)';
      case 'telephony': return 'Telephony';
      default: return type.toUpperCase();
    }
  };

  // Group providers by type
  const groupedProviders = providers?.reduce((acc, provider) => {
    if (!acc[provider.providerType]) {
      acc[provider.providerType] = [];
    }
    acc[provider.providerType].push(provider);
    return acc;
  }, {} as Record<string, typeof providers>) || {};

  const providerTypes = ['asr', 'llm', 'tts', 'telephony'];

  return (
    <div className="flex-1 space-y-8 p-6 md:p-8 pt-6 max-w-6xl mx-auto h-full flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Providers</h2>
          <p className="text-muted-foreground">
            Manage your API keys for different voice AI services.
          </p>
        </div>
        <Button onClick={() => setIsAddOpen(true)} data-testid="button-add-provider">
          <Plus className="mr-2 h-4 w-4" /> Add Provider Key
        </Button>
      </div>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Add Provider Key</DialogTitle>
            <DialogDescription>
              Configure a new service provider. Your API key will be securely encrypted.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
              <FormField
                control={form.control}
                name="providerType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Service Category</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select service type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="asr">Speech-to-Text (ASR)</SelectItem>
                        <SelectItem value="llm">Language Model (LLM)</SelectItem>
                        <SelectItem value="tts">Text-to-Speech (TTS)</SelectItem>
                        <SelectItem value="telephony">Telephony Provider</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="providerName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Provider Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. openai, deepgram, twilio" {...field} />
                    </FormControl>
                    <FormDescription>
                      The specific service name (must match provider exactly)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="apiKey"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>API Key</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="sk-..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="extraConfig"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Extra Configuration (Optional)</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder='{"region": "us-east-1", "projectId": "123"}' 
                        className="font-mono text-xs" 
                        {...field} 
                      />
                    </FormControl>
                    <FormDescription>
                      JSON formatted extra config needed for some providers.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <DialogFooter className="pt-4">
                <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createProvider.isPending} data-testid="button-save-provider">
                  {createProvider.isPending ? "Saving..." : "Save Provider"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="grid gap-6 md:grid-cols-2">
            {[1, 2, 3, 4].map(i => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-6 w-[200px]" />
                </CardHeader>
                <CardContent className="space-y-4">
                  <Skeleton className="h-20 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : providers?.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center bg-card rounded-lg border border-dashed">
            <Key className="h-12 w-12 text-muted-foreground opacity-20 mb-4" />
            <h3 className="text-lg font-medium mb-2">No providers configured</h3>
            <p className="text-sm text-muted-foreground max-w-sm mb-6">
              You need to configure API keys for ASR, LLM, TTS, and Telephony before creating agents.
            </p>
            <Button onClick={() => setIsAddOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Add Provider Key
            </Button>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {providerTypes.map(type => (
              <Card key={type} className="flex flex-col">
                <CardHeader className="pb-3 border-b border-border/50">
                  <CardTitle className="text-lg font-semibold flex items-center gap-2">
                    <Settings2 className="h-5 w-5 text-primary" />
                    {getProviderCategoryTitle(type)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4 flex-1 flex flex-col gap-3">
                  {groupedProviders[type] && groupedProviders[type].length > 0 ? (
                    groupedProviders[type].map(provider => (
                      <div key={provider.id} className="flex items-center justify-between p-3 rounded-md bg-muted/40 border border-border/50">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{provider.providerName}</span>
                            {provider.isActive && <Badge variant="outline" className="text-[10px] h-4 bg-primary/10 text-primary border-primary/20">Active</Badge>}
                          </div>
                          <div className="flex items-center text-xs text-muted-foreground gap-1 font-mono">
                            <Lock className="h-3 w-3" />
                            •••• {provider.apiKeyHint || "••••"}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => handleDelete(provider.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="flex flex-col items-center justify-center py-6 text-center h-full">
                      <AlertCircle className="h-8 w-8 text-muted-foreground opacity-20 mb-2" />
                      <p className="text-sm text-muted-foreground">No {type.toUpperCase()} providers configured.</p>
                      <Button variant="link" className="text-xs h-auto p-0 mt-1" onClick={() => {
                        form.setValue("providerType", type as any);
                        setIsAddOpen(true);
                      }}>
                        Add one now
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
