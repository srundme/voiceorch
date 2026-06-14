import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Terminal, Database, ArrowRight, Layers, FileJson } from "lucide-react";

export default function Docs() {
  return (
    <div className="space-y-10 max-w-4xl pb-16">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Documentation</h1>
        <p className="text-muted-foreground mt-2 text-lg">
          Integrate the Pendrive memory layer into any AI voice agent pipeline.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="bg-card/50">
          <CardHeader className="pb-3">
            <Database className="h-6 w-6 text-primary mb-2" />
            <CardTitle className="text-lg">L0: Facts</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Atomic, discrete facts extracted across all conversations. High confidence state that represents long-term knowledge (e.g. "User lives in New York", "Prefers morning calls").
          </CardContent>
        </Card>
        
        <Card className="bg-card/50">
          <CardHeader className="pb-3">
            <Layers className="h-6 w-6 text-primary mb-2" />
            <CardTitle className="text-lg">L1: Episodes</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Chronological summaries of past interactions. Provides narrative context to the LLM about what happened in previous calls to avoid repeating conversations.
          </CardContent>
        </Card>
        
        <Card className="bg-card/50">
          <CardHeader className="pb-3">
            <FileJson className="h-6 w-6 text-primary mb-2" />
            <CardTitle className="text-lg">L2: Sentences</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Raw, semantic search over actual call transcripts via vector embeddings. Automatically injected when the caller asks "What exactly did I say about..."
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold border-b pb-2 mb-4">1. Fetch Context Before Routing</h2>
          <p className="text-muted-foreground mb-4">
            Before handing an incoming call to your LLM, fetch the unified memory block for that phone number. 
            Inject the resulting <code>memoryBlock</code> string into your system prompt.
          </p>

          <Card className="bg-[#0A0A0A] border-border/50 text-gray-300 font-mono text-sm overflow-hidden">
            <div className="border-b border-white/10 px-4 py-2 flex items-center gap-2 bg-black/40">
              <Terminal className="h-4 w-4" />
              <span>Node.js / fetch</span>
            </div>
            <CardContent className="p-4 overflow-x-auto">
<pre><code><span className="text-[#c678dd]">const</span> response <span className="text-[#56b6c2]">= await</span> fetch(<span className="text-[#98c379]">"https://api.pendrive.dev/v1/context?phone=+1234567890"</span>, {'{'}
  headers: {'{'}
    <span className="text-[#98c379]">"Authorization"</span>: <span className="text-[#98c379]">"Bearer pd_prod_..."</span>
  {'}'}
{'}'});

<span className="text-[#c678dd]">const</span> data <span className="text-[#56b6c2]">= await</span> response.json();
<span className="text-[#7f848e]">{`/* \nReturns:\n{\n  "memoryBlock": "CALLER MEMORY:\\nFacts:\\n- Name: John\\n...\\nRecent Episodes:\\n- Last week: called about billing...",\n  "facts": [...],\n  ...\n}\n*/`}</span>

<span className="text-[#c678dd]">const</span> systemPrompt <span className="text-[#56b6c2]">=</span> <span className="text-[#98c379]">{`\`
You are a helpful AI assistant.
Here is what you know about the caller:
\${data.memoryBlock}
\``}</span>;</code></pre>
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-2xl font-semibold border-b pb-2 mb-4 mt-12">2. Archive Call Transcript</h2>
          <p className="text-muted-foreground mb-4">
            When a call completes, post the raw transcript to the archive endpoint. 
            Pendrive automatically runs background orchestration to extract facts (L0) and generate episode summaries (L1).
          </p>

          <Card className="bg-[#0A0A0A] border-border/50 text-gray-300 font-mono text-sm overflow-hidden">
            <div className="border-b border-white/10 px-4 py-2 flex items-center gap-2 bg-black/40">
              <Terminal className="h-4 w-4" />
              <span>cURL</span>
            </div>
            <CardContent className="p-4 overflow-x-auto">
<pre><code><span className="text-[#e06c75]">curl</span> -X POST https://api.pendrive.dev/v1/archive \
  -H <span className="text-[#98c379]">"Authorization: Bearer pd_prod_..."</span> \
  -H <span className="text-[#98c379]">"Content-Type: application/json"</span> \
  -d <span className="text-[#98c379]">'{'{'}
    "phoneNumber": "+1234567890",
    "agentId": "agent_abc123",
    "durationSeconds": 145,
    "transcript": "Agent: Hello.\\nCaller: Hi, my name is John and my account number is 5544.\\nAgent: Thanks John..."
  {'}'}'</span></code></pre>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
