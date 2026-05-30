import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { useCreateAgent, getListAgentsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { formatApiError } from "@/lib/format-api-error";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (id: number) => void;
}

export function CreateAgentDialog({ open, onClose, onCreated }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createAgent = useCreateAgent();
  const [name, setName] = useState("");

  function handleClose() {
    setName("");
    onClose();
  }

  function handleCreate() {
    if (!name.trim() || createAgent.isPending) return;
    createAgent.mutate(
      {
        data: {
          name: name.trim(),
          agentMode:         "managed",
          asrProvider:       "deepgram",
          asrModel:          "nova-3",
          llmProvider:       "google",
          llmModel:          "gemini-2.5-flash",
          ttsProvider:       "cartesia",
          ttsModel:          "sonic-3",
          telephonyProvider: "vobiz",
          systemPrompt:      "You are a helpful AI voice assistant.",
          maxDuration:       600,
        } as any,
      },
      {
        onSuccess: (agent) => {
          queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
          toast({ title: `"${agent.name}" created` });
          handleClose();
          onCreated(agent.id);
        },
        onError: (err: unknown) => {
          toast({ title: "Failed to create assistant", description: formatApiError(err), variant: "destructive" });
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-4">
          <DialogTitle className="text-[15px] font-semibold">New assistant</DialogTitle>
          <DialogDescription className="text-[12px] text-muted-foreground">
            Give your assistant a name to get started.
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 pb-5 space-y-4">
          <Input
            placeholder="e.g. Sales Assistant"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleCreate(); }}
            autoFocus
            className="h-9 text-sm"
          />

          <Button
            className="w-full h-9"
            onClick={handleCreate}
            disabled={!name.trim() || createAgent.isPending}
          >
            {createAgent.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : "Create assistant"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
