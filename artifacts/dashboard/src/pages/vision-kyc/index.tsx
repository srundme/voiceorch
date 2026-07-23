import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { AppPageHeader } from "@/components/app-page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ShieldCheck, Plus, Upload, Trash2,
  Eye, Download, Copy, User
} from "lucide-react";

interface VisionIdentity {
  id: string;
  name: string;
  phone: string;
  email?: string;
  panNumber?: string;
  panName?: string;
  panDob?: string;
  status: "enrolled" | "verified" | "rejected" | "pending";
  enrollmentSource: string;
  hasFacePhoto: boolean;
  hasPanCard: boolean;
  onboardingUrl?: string;
  createdAt: string;
}

interface VisionKycSession {
  id: string;
  callId?: number;
  callerPhone: string;
  status: "passed" | "failed" | "manual_review" | "pending";
  faceMatchScore: number;
  faceMatchPass: boolean;
  documentOcrName?: string;
  documentOcrNumber?: string;
  documentOcrDob?: string;
  documentAuthentic: boolean;
  documentAuthenticityScore: number;
  overallScore: number;
  summary?: string;
  createdAt: string;
}

export default function VisionKycPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("identities");

  // Modals
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  // Form states for single add
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    panNumber: "",
    notes: "",
  });

  // CSV paste state
  const [csvRaw, setCsvRaw] = useState("");

  // ── Queries ──
  const { data: identitiesData, isLoading: loadingIdentities } = useQuery<{ identities: VisionIdentity[] }>({
    queryKey: ["vision-identities"],
    queryFn: async () => {
      const res = (await customFetch("/api/vision-identities")) as Response;
      return res.json();
    },
  });

  const { data: sessionsData, isLoading: loadingSessions } = useQuery<{ sessions: VisionKycSession[] }>({
    queryKey: ["vision-kyc-sessions"],
    queryFn: async () => {
      const res = (await customFetch("/api/vision-kyc-sessions")) as Response;
      return res.json();
    },
  });

  const { data: sessionDetailData, isLoading: loadingDetail } = useQuery<{ session: any }>({
    queryKey: ["vision-kyc-session-detail", selectedSessionId],
    queryFn: async () => {
      if (!selectedSessionId) return { session: null };
      const res = (await customFetch(`/api/vision-kyc-sessions/${selectedSessionId}`)) as Response;
      return res.json();
    },
    enabled: !!selectedSessionId,
  });

  // ── Mutations ──
  const createIdentityMutation = useMutation({
    mutationFn: async (payload: typeof formData) => {
      const res = (await customFetch("/api/vision-identities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })) as Response;
      if (!res.ok) throw new Error("Failed to create identity record");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Customer Identity Record Created" });
      setAddModalOpen(false);
      setFormData({ name: "", phone: "", email: "", panNumber: "", notes: "" });
      queryClient.invalidateQueries({ queryKey: ["vision-identities"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (items: any[]) => {
      const res = (await customFetch("/api/vision-identities/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      })) as Response;
      if (!res.ok) throw new Error("Failed to import CSV");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: `Imported ${data.count} Customer Records` });
      setImportModalOpen(false);
      setCsvRaw("");
      queryClient.invalidateQueries({ queryKey: ["vision-identities"] });
    },
    onError: (err: Error) => {
      toast({ title: "Import Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = (await customFetch(`/api/vision-identities/${id}`, { method: "DELETE" })) as Response;
      if (!res.ok) throw new Error("Failed to delete record");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Record Deleted" });
      queryClient.invalidateQueries({ queryKey: ["vision-identities"] });
    },
  });

  const generateLinkMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = (await customFetch(`/api/vision-identities/${id}/generate-link`, { method: "POST" })) as Response;
      if (!res.ok) throw new Error("Failed to generate onboarding link");
      return res.json();
    },
    onSuccess: (data) => {
      navigator.clipboard.writeText(data.onboardingUrl);
      toast({ title: "Onboarding Link Copied to Clipboard!", description: data.onboardingUrl });
      queryClient.invalidateQueries({ queryKey: ["vision-identities"] });
    },
  });

  const handleCsvImportSubmit = () => {
    if (!csvRaw.trim()) return;
    const lines = csvRaw.trim().split("\n");
    const items = lines.map((line) => {
      const [name, phone, email, panNumber] = line.split(",").map((s) => s.trim());
      return { name, phone, email, panNumber };
    }).filter((item) => item.name && item.phone);

    if (items.length === 0) {
      toast({ title: "Invalid CSV format", description: "Format: Name, Phone, Email, PAN", variant: "destructive" });
      return;
    }

    importMutation.mutate(items);
  };

  const identities = identitiesData?.identities || [];
  const sessions = sessionsData?.sessions || [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <AppPageHeader
        title="Vision KYC & Visual Identity"
        description="AI-native Video KYC infrastructure. Verify customer identity, face match & document authenticity live during AI calls."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setImportModalOpen(true)}>
              <Upload className="h-4 w-4 mr-2" /> Bulk Import CSV
            </Button>
            <Button onClick={() => setAddModalOpen(true)}>
              <Plus className="h-4 w-4 mr-2" /> Add Identity
            </Button>
          </div>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="bg-card border border-border">
          <TabsTrigger value="identities" className="gap-2">
            <User className="h-4 w-4" /> Identity Records ({identities.length})
          </TabsTrigger>
          <TabsTrigger value="sessions" className="gap-2">
            <ShieldCheck className="h-4 w-4" /> KYC Audit Sessions ({sessions.length})
          </TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Identity Records Database ── */}
        <TabsContent value="identities" className="space-y-4">
          {loadingIdentities ? (
            <div className="p-12 text-center text-muted-foreground">Loading identity database...</div>
          ) : identities.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck className="h-6 w-6" />}
              title="No Identity Records"
              description="Add customers or send self-onboarding links so the AI agent can verify them on calls."
              action={{
                label: "Add First Customer",
                onClick: () => setAddModalOpen(true),
                icon: <Plus className="h-4 w-4" />,
              }}
            />
          ) : (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/40 border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="p-4">Customer</th>
                    <th className="p-4">Phone / Contact</th>
                    <th className="p-4">PAN / ID</th>
                    <th className="p-4">Assets</th>
                    <th className="p-4">Status</th>
                    <th className="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {identities.map((item) => (
                    <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                      <td className="p-4 font-medium text-foreground">
                        <div>{item.name}</div>
                        {item.email && <div className="text-xs text-muted-foreground">{item.email}</div>}
                      </td>
                      <td className="p-4 text-muted-foreground font-mono text-xs">{item.phone}</td>
                      <td className="p-4 font-mono text-xs">{item.panNumber || "—"}</td>
                      <td className="p-4">
                        <div className="flex items-center gap-1.5">
                          <Badge variant={item.hasFacePhoto ? "default" : "outline"} className="text-[10px]">
                            {item.hasFacePhoto ? "Face Photo" : "No Face"}
                          </Badge>
                          <Badge variant={item.hasPanCard ? "default" : "outline"} className="text-[10px]">
                            {item.hasPanCard ? "PAN Card" : "No PAN"}
                          </Badge>
                        </div>
                      </td>
                      <td className="p-4">
                        <Badge
                          variant="outline"
                          className={
                            item.status === "enrolled" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
                              : item.status === "verified" ? "bg-sky-500/10 text-sky-500 border-sky-500/30"
                              : "bg-amber-500/10 text-amber-500 border-amber-500/30"
                          }
                        >
                          {item.status.toUpperCase()}
                        </Badge>
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Copy Self-Onboarding Link"
                            onClick={() => generateLinkMutation.mutate(item.id)}
                          >
                            <Copy className="h-3.5 w-3.5 text-sky-400" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Delete"
                            onClick={() => deleteMutation.mutate(item.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* ── Tab 2: KYC Sessions Audit Log ── */}
        <TabsContent value="sessions" className="space-y-4">
          {loadingSessions ? (
            <div className="p-12 text-center text-muted-foreground">Loading KYC sessions...</div>
          ) : sessions.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck className="h-6 w-6" />}
              title="No KYC Sessions Yet"
              description="Verification sessions triggered by live AI agent calls will appear here."
            />
          ) : (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/40 border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="p-4">Timestamp</th>
                    <th className="p-4">Caller Phone</th>
                    <th className="p-4">Face Match</th>
                    <th className="p-4">Doc Authenticity</th>
                    <th className="p-4">Trust Score</th>
                    <th className="p-4">Status</th>
                    <th className="p-4 text-right">Certificate / Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sessions.map((s) => (
                    <tr key={s.id} className="hover:bg-muted/20 transition-colors">
                      <td className="p-4 text-xs text-muted-foreground">
                        {new Date(s.createdAt).toLocaleString()}
                      </td>
                      <td className="p-4 font-mono text-xs">{s.callerPhone}</td>
                      <td className="p-4 font-semibold">
                        {s.faceMatchScore}% ({s.faceMatchPass ? "PASS" : "FAIL"})
                      </td>
                      <td className="p-4 font-semibold">
                        {s.documentAuthenticityScore}%
                      </td>
                      <td className="p-4">
                        <span className="font-bold text-foreground">{s.overallScore}%</span>
                      </td>
                      <td className="p-4">
                        <Badge
                          variant="outline"
                          className={
                            s.status === "passed" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
                              : s.status === "manual_review" ? "bg-amber-500/10 text-amber-500 border-amber-500/30"
                              : "bg-red-500/10 text-red-500 border-red-500/30"
                          }
                        >
                          {s.status.toUpperCase()}
                        </Badge>
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedSessionId(s.id)}
                          >
                            <Eye className="h-3.5 w-3.5 mr-1" /> View Details
                          </Button>
                          <a
                            href={`/api/vision-kyc-sessions/${s.id}/certificate`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Button variant="ghost" size="sm">
                              <Download className="h-3.5 w-3.5 mr-1" /> PDF
                            </Button>
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Add Single Identity Modal */}
      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Customer Identity</DialogTitle>
            <DialogDescription>
              Create a baseline profile. Customer will complete verification on call or via onboarding link.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Full Name</Label>
              <Input
                placeholder="Rahul Sharma"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div>
              <Label>Phone Number</Label>
              <Input
                placeholder="+919876543210"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>
            <div>
              <Label>Email (Optional)</Label>
              <Input
                placeholder="rahul@example.com"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
            <div>
              <Label>PAN / Document Number (Optional)</Label>
              <Input
                placeholder="ABCDE1234F"
                value={formData.panNumber}
                onChange={(e) => setFormData({ ...formData, panNumber: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddModalOpen(false)}>Cancel</Button>
            <Button onClick={() => createIdentityMutation.mutate(formData)}>Save Identity</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Import CSV Modal */}
      <Dialog open={importModalOpen} onOpenChange={setImportModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Bulk Import Customers (CSV)</DialogTitle>
            <DialogDescription>
              Paste CSV rows in the format: <code>Name, Phone, Email, PAN</code>
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <textarea
              className="w-full h-40 p-3 rounded-lg border border-border bg-background font-mono text-xs leading-relaxed"
              placeholder={`Rahul Sharma, +919876543210, rahul@example.com, ABCDE1234F\nPriya Singh, +919812345678, priya@example.com, XYZ98765A`}
              value={csvRaw}
              onChange={(e) => setCsvRaw(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportModalOpen(false)}>Cancel</Button>
            <Button onClick={handleCsvImportSubmit}>Import Records</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Session Evidence Modal */}
      <Dialog open={!!selectedSessionId} onOpenChange={(open) => !open && setSelectedSessionId(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>KYC Verification Session Evidence</DialogTitle>
            <DialogDescription>
              Visual evidence frames captured during live call session.
            </DialogDescription>
          </DialogHeader>

          {loadingDetail || !sessionDetailData?.session ? (
            <div className="p-8 text-center text-muted-foreground">Loading evidence...</div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="border border-border rounded-xl p-3 bg-black/40 text-center space-y-2">
                  <span className="text-xs font-semibold text-muted-foreground">Live Face Frame</span>
                  {sessionDetailData.session.faceCaptureData ? (
                    <img
                      src={`data:image/jpeg;base64,${sessionDetailData.session.faceCaptureData}`}
                      alt="Face capture"
                      className="w-full h-40 object-cover rounded-lg"
                    />
                  ) : (
                    <div className="h-40 flex items-center justify-center text-xs text-muted-foreground bg-muted/20 rounded-lg">
                      No Face Frame Captured
                    </div>
                  )}
                  <div className="text-xs font-bold text-emerald-400">
                    Match Score: {sessionDetailData.session.faceMatchScore}%
                  </div>
                </div>

                <div className="border border-border rounded-xl p-3 bg-black/40 text-center space-y-2">
                  <span className="text-xs font-semibold text-muted-foreground">Document Frame</span>
                  {sessionDetailData.session.documentCaptureData ? (
                    <img
                      src={`data:image/jpeg;base64,${sessionDetailData.session.documentCaptureData}`}
                      alt="Document capture"
                      className="w-full h-40 object-cover rounded-lg"
                    />
                  ) : (
                    <div className="h-40 flex items-center justify-center text-xs text-muted-foreground bg-muted/20 rounded-lg">
                      No Document Frame Captured
                    </div>
                  )}
                  <div className="text-xs font-bold text-sky-400">
                    Authenticity: {sessionDetailData.session.documentAuthenticityScore}%
                  </div>
                </div>
              </div>

              <div className="p-3 bg-muted/30 rounded-xl border border-border text-xs space-y-1">
                <div><span className="font-bold text-foreground">Summary: </span>{sessionDetailData.session.summary}</div>
                <div><span className="font-bold text-foreground">OCR Extracted Name: </span>{sessionDetailData.session.documentOcrName || "N/A"}</div>
                <div><span className="font-bold text-foreground">OCR Document Number: </span>{sessionDetailData.session.documentOcrNumber || "N/A"}</div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedSessionId(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
