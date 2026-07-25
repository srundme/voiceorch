import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Phone } from "lucide-react";

export interface NewAgentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateAgent: (data: { name: string }) => void;
}

export function NewAgentModal({ open, onOpenChange, onCreateAgent }: NewAgentModalProps) {
  const [agentName, setAgentName] = useState("New AI Agent");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentName.trim()) return;
    onCreateAgent({ name: agentName.trim() });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-slate-950 border-slate-800 text-slate-100">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Create New AI Agent</DialogTitle>
          <DialogDescription className="text-slate-400 text-xs">
            Name your voice agent to load the optimal pipeline defaults and capabilities.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 py-2">
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-slate-300">Agent Name</Label>
            <Input
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder="e.g. Customer Service Representative"
              className="bg-slate-900 border-slate-800 text-slate-100 focus:border-sky-500"
            />
          </div>

          <div className="p-4 rounded-xl border border-sky-500 bg-sky-950/40 text-slate-100 shadow-md shadow-sky-950/20">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 rounded-lg bg-sky-500/10 text-sky-400">
                <Phone className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-100">Voice Agent</h4>
                <p className="text-[10px] text-slate-400">Telephony & WebCall Voice</p>
              </div>
            </div>
            <ul className="text-[11px] space-y-1 text-slate-400 leading-tight">
              <li>• Inbound/Outbound PSTN (VoBiz)</li>
              <li>• Sarvam / Deepgram Streaming STT</li>
              <li>• Cartesia Sonic High-Speed TTS</li>
              <li>• Telephony Voicemail & AMD</li>
            </ul>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-slate-800 text-slate-400 hover:bg-slate-900"
            >
              Cancel
            </Button>
            <Button type="submit" className="bg-sky-500 text-slate-950 hover:bg-sky-400 font-semibold">
              Create Agent
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
