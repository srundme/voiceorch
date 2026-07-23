import { useState } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { ShieldCheck, Camera, CheckCircle2, Loader2, Upload, AlertCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function VisionOnboardingPage() {
  const [, params] = useRoute("/vision-onboarding/:token");
  const token = params?.token;

  const [faceBase64, setFaceBase64] = useState<string | null>(null);
  const [panBase64, setPanBase64] = useState<string | null>(null);
  const [panNumber, setPanNumber] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch Identity Stub Metadata
  const { data, isLoading, isError } = useQuery<{ identity: { name: string; phone: string; status: string } }>({
    queryKey: ["vision-onboarding-stub", token],
    queryFn: async () => {
      if (!token) throw new Error("Missing token");
      const res = await fetch(`/api/vision-onboarding/${token}`);
      if (!res.ok) throw new Error("Invalid or expired link");
      return res.json();
    },
    enabled: !!token,
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/vision-onboarding/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facePhotoData: faceBase64,
          panCardData: panBase64,
          panNumber: panNumber || undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed to submit verification photos");
      return res.json();
    },
    onSuccess: () => {
      setSubmitted(true);
    },
    onError: (err: Error) => {
      setError(err.message || "Failed to submit verification");
    },
  });

  const handleFileUpload = (file: File, setter: (b64: string) => void) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      const b64 = result.split(",")[1];
      if (b64) setter(b64);
    };
    reader.readAsDataURL(file);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-sky-400 mb-4" />
        <p className="text-sm text-gray-400">Loading identity verification portal...</p>
      </div>
    );
  }

  if (isError || !data?.identity) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 text-center space-y-4">
        <AlertCircle className="h-12 w-12 text-red-400" />
        <h1 className="text-xl font-bold">Invalid or Expired Link</h1>
        <p className="text-sm text-gray-400 max-w-sm">
          This verification link is invalid or has expired. Please request a new verification link.
        </p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 text-center space-y-4 max-w-md mx-auto">
        <div className="h-16 w-16 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/40 mb-2">
          <CheckCircle2 className="h-10 w-10" />
        </div>
        <h1 className="text-2xl font-bold">Verification Submitted!</h1>
        <p className="text-sm text-gray-300 leading-relaxed">
          Thank you, <span className="font-semibold text-white">{data.identity.name}</span>. Your facial selfie and ID card photos have been securely enrolled for AI Video KYC verification.
        </p>
        <p className="text-xs text-gray-500 pt-4">You can now close this tab.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col p-4 sm:p-6 max-w-md mx-auto justify-between">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
          <div className="h-10 w-10 rounded-xl bg-sky-500/20 border border-sky-500/40 flex items-center justify-center text-sky-400 shrink-0">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-base font-bold">Identity Self-Onboarding</h1>
            <p className="text-xs text-slate-400">Secure Video KYC Setup for {data.identity.name}</p>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-400 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {/* Step 1: Selfie Photo */}
        <div className="space-y-3 p-4 bg-slate-900/60 border border-slate-800 rounded-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
              <Camera className="h-4 w-4 text-sky-400" /> Step 1: Take Face Selfie
            </div>
            {faceBase64 && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
          </div>
          <p className="text-xs text-slate-400">
            Look straight at the camera in clear light. No glasses or hats.
          </p>

          {faceBase64 ? (
            <div className="relative rounded-xl overflow-hidden border border-slate-700 max-h-48">
              <img src={`data:image/jpeg;base64,${faceBase64}`} alt="Face selfie" className="w-full h-48 object-cover" />
              <button
                type="button"
                onClick={() => setFaceBase64(null)}
                className="absolute top-2 right-2 text-xs bg-black/80 px-2 py-1 rounded text-white"
              >
                Retake
              </button>
            </div>
          ) : (
            <label className="block p-6 border-2 border-dashed border-slate-700 hover:border-sky-500 rounded-xl text-center cursor-pointer transition-colors">
              <Camera className="h-8 w-8 text-sky-400 mx-auto mb-2" />
              <span className="text-xs font-semibold text-slate-300">Tap to Take Selfie Photo</span>
              <input
                type="file"
                accept="image/*"
                capture="user"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileUpload(f, setFaceBase64);
                }}
              />
            </label>
          )}
        </div>

        {/* Step 2: ID / PAN Card Photo */}
        <div className="space-y-3 p-4 bg-slate-900/60 border border-slate-800 rounded-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
              <Upload className="h-4 w-4 text-sky-400" /> Step 2: Photo of PAN Card / ID
            </div>
            {panBase64 && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
          </div>
          <p className="text-xs text-slate-400">
            Capture a clear front photo of your PAN card or official ID document.
          </p>

          {panBase64 ? (
            <div className="relative rounded-xl overflow-hidden border border-slate-700 max-h-48">
              <img src={`data:image/jpeg;base64,${panBase64}`} alt="PAN card" className="w-full h-48 object-cover" />
              <button
                type="button"
                onClick={() => setPanBase64(null)}
                className="absolute top-2 right-2 text-xs bg-black/80 px-2 py-1 rounded text-white"
              >
                Retake
              </button>
            </div>
          ) : (
            <label className="block p-6 border-2 border-dashed border-slate-700 hover:border-sky-500 rounded-xl text-center cursor-pointer transition-colors">
              <Upload className="h-8 w-8 text-sky-400 mx-auto mb-2" />
              <span className="text-xs font-semibold text-slate-300">Tap to Capture PAN / ID Card</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileUpload(f, setPanBase64);
                }}
              />
            </label>
          )}

          <div>
            <label className="text-xs text-slate-400 block mb-1">PAN Card Number (Optional)</label>
            <input
              type="text"
              placeholder="e.g. ABCDE1234F"
              value={panNumber}
              onChange={(e) => setPanNumber(e.target.value.toUpperCase())}
              className="w-full p-2.5 rounded-xl border border-slate-800 bg-slate-950 text-xs text-white uppercase font-mono"
            />
          </div>
        </div>
      </div>

      {/* Submit Button */}
      <div className="pt-6">
        <Button
          className="w-full h-12 rounded-xl text-sm font-semibold bg-sky-500 hover:bg-sky-600 text-white gap-2"
          disabled={!faceBase64 || submitMutation.isPending}
          onClick={() => submitMutation.mutate()}
        >
          {submitMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          Submit Verification Data
        </Button>
      </div>
    </div>
  );
}
