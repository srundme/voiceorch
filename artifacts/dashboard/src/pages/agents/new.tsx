import React from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, Save, Bot } from "lucide-react";
import { useCreateAgent, getListAgentsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";

const agentFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  asrProvider: z.string().min(1, "ASR Provider is required"),
  asrModel: z.string().optional(),
  llmProvider: z.string().min(1, "LLM Provider is required"),
  llmModel: z.string().optional(),
  ttsProvider: z.string().min(1, "TTS Provider is required"),
  ttsVoice: z.string().optional(),
  telephonyProvider: z.string().min(1, "Telephony Provider is required"),
  systemPrompt: z.string().min(1, "System prompt is required"),
  temperature: z.number().min(0).max(2).optional(),
  maxDuration: z.number().min(10).max(3600).optional(),
});

type AgentFormValues = z.infer<typeof agentFormSchema>;

export default function AgentNew() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createAgent = useCreateAgent();

  const form = useForm<AgentFormValues>({
    resolver: zodResolver(agentFormSchema),
    defaultValues: {
      name: "",
      description: "",
      asrProvider: "azure",
      asrModel: "en-US-standard",
      llmProvider: "openai",
      llmModel: "gpt-4o-mini",
      ttsProvider: "elevenlabs",
      ttsVoice: "",
      telephonyProvider: "twilio",
      systemPrompt: "You are a helpful AI voice assistant.",
      temperature: 0.7,
      maxDuration: 600,
    },
  });

  const onSubmit = (data: AgentFormValues) => {
    createAgent.mutate(
      { data },
      {
        onSuccess: (agent) => {
          queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
          toast({
            title: "Agent Created",
            description: "Your new voice agent has been successfully created.",
          });
          setLocation(`/agents/${agent.id}`);
        },
        onError: () => {
          toast({
            title: "Error",
            description: "Failed to create agent. Please try again.",
            variant: "destructive",
          });
        }
      }
    );
  };

  return (
    <div className="flex-1 space-y-6 p-6 md:p-8 pt-6 max-w-5xl mx-auto h-full flex flex-col">
      <div className="flex items-center gap-4">
        <Link href="/agents">
          <Button variant="outline" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" />
            Create Agent
          </h2>
          <p className="text-muted-foreground">
            Configure a new AI voice agent pipeline.
          </p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pb-20">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>General Information</CardTitle>
                <CardDescription>Basic details about your agent.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Agent Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Sales Assistant" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description (Optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Handles inbound sales inquiries" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>AI Behavior</CardTitle>
                <CardDescription>Configure how the agent responds.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="systemPrompt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>System Prompt</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="You are a helpful assistant..." 
                          className="min-h-[150px] font-mono text-sm" 
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="temperature"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex justify-between items-center mb-2">
                        <FormLabel>Temperature: {field.value}</FormLabel>
                      </div>
                      <FormControl>
                        <Slider
                          min={0}
                          max={2}
                          step={0.1}
                          defaultValue={[field.value || 0.7]}
                          onValueChange={(vals) => field.onChange(vals[0])}
                        />
                      </FormControl>
                      <FormDescription>
                        Higher values make output more random, lower makes it more deterministic.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Pipeline Configuration</CardTitle>
                <CardDescription>Select the providers for each stage of the voice pipeline.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {/* ASR Stage */}
                  <div className="space-y-4 p-4 border rounded-md bg-muted/20 relative">
                    <div className="absolute top-0 right-0 -mt-3 -mr-3 bg-card border rounded-full px-2 py-0.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Step 1</div>
                    <h4 className="font-medium flex items-center border-b pb-2">Speech-to-Text</h4>
                    <FormField
                      control={form.control}
                      name="asrProvider"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Provider</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select ASR" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="azure">Azure Speech</SelectItem>
                              <SelectItem value="assemblyai">AssemblyAI</SelectItem>
                              <SelectItem value="sarvam">Sarvam (Saarika)</SelectItem>
                              <SelectItem value="cartesia">Cartesia</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="asrModel"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Model</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. nova-2" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* LLM Stage */}
                  <div className="space-y-4 p-4 border rounded-md bg-muted/20 relative">
                     <div className="absolute top-0 right-0 -mt-3 -mr-3 bg-card border rounded-full px-2 py-0.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Step 2</div>
                    <h4 className="font-medium flex items-center border-b pb-2">Language Model</h4>
                    <FormField
                      control={form.control}
                      name="llmProvider"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Provider</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select LLM" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="openai">OpenAI</SelectItem>
                              <SelectItem value="google">Google Gemini</SelectItem>
                              <SelectItem value="groq">Groq</SelectItem>
                              <SelectItem value="sarvam">Sarvam</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="llmModel"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Model</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. gpt-4-turbo" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* TTS Stage */}
                  <div className="space-y-4 p-4 border rounded-md bg-muted/20 relative">
                     <div className="absolute top-0 right-0 -mt-3 -mr-3 bg-card border rounded-full px-2 py-0.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Step 3</div>
                    <h4 className="font-medium flex items-center border-b pb-2">Text-to-Speech</h4>
                    <FormField
                      control={form.control}
                      name="ttsProvider"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Provider</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select TTS" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="elevenlabs">ElevenLabs</SelectItem>
                              <SelectItem value="cartesia">Cartesia (Sonic)</SelectItem>
                              <SelectItem value="sarvam">Sarvam (Bulbul)</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="ttsVoice"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Voice ID</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. rachel" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Telephony Stage */}
                  <div className="space-y-4 p-4 border rounded-md bg-muted/20 relative">
                     <div className="absolute top-0 right-0 -mt-3 -mr-3 bg-card border rounded-full px-2 py-0.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Step 4</div>
                    <h4 className="font-medium flex items-center border-b pb-2">Telephony</h4>
                    <FormField
                      control={form.control}
                      name="telephonyProvider"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Provider</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select Telephony" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="twilio">Twilio</SelectItem>
                              <SelectItem value="plivo">Plivo</SelectItem>
                              <SelectItem value="vobiz">Vobiz</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="maxDuration"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs">Max Duration (seconds)</FormLabel>
                          <FormControl>
                            <Input 
                              type="number" 
                              placeholder="e.g. 600" 
                              {...field} 
                              onChange={(e) => field.onChange(parseInt(e.target.value, 10))}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
          
          <div className="fixed bottom-0 left-0 md:left-64 right-0 p-4 bg-background/80 backdrop-blur-sm border-t border-border flex justify-end z-10">
            <div className="max-w-5xl mx-auto w-full flex justify-end gap-4">
              <Link href="/agents">
                <Button type="button" variant="outline">Cancel</Button>
              </Link>
              <Button type="submit" disabled={createAgent.isPending} data-testid="button-save-agent">
                <Save className="mr-2 h-4 w-4" />
                {createAgent.isPending ? "Creating..." : "Create Agent"}
              </Button>
            </div>
          </div>
        </form>
      </Form>
    </div>
  );
}
